"""Train, compare, calibrate and evaluate both models, then save the deployable bundle.

Run from the machine_learning folder:  python -m src.train

Leakage rules followed here:
- the 20% test split is used only after every choice (model, hyperparameters,
  calibration, threshold) has been made on the training split
- preprocessing and class weights are fit inside each training fold (they are pipeline steps)
"""
import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import shap
import sklearn
import xgboost
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, f1_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_predict, cross_validate

from src import figures, report
from src.config import (
    BUNDLE_PATH, CV_FOLDS, FAILURE_COL, FAILURE_MODES, FEATURES, FIGURES, ISOTONIC_MIN_GAIN, MIN_MODE_POSITIVES,
    MODE_THRESHOLD,
    MODELS, REPORTS, SEED,
)
from src.data import features, labelset_key, load_dataset, mode_targets, split
from src.evaluation import CV_SCORERS, best_f1_threshold, binary_metrics, multilabel_scores
from src.explain import explain, make_explainer
from src.messy import make_messy
from src.models import detector_candidates, diagnosis_candidates


def cv_splitter(seed=SEED):
    return StratifiedKFold(CV_FOLDS, shuffle=True, random_state=seed)


# ---------------------------------------------------------------- Model 1: failure detection

def compare_detectors(X, y):
    """Tune each candidate with 5-fold CV on the training split; keep its best setting."""
    results, fitted = {}, {}
    for name, pipe, grid in detector_candidates():
        search = GridSearchCV(pipe, grid, scoring=CV_SCORERS, refit="pr_auc", cv=cv_splitter(), n_jobs=-1)
        search.fit(X, y)
        cv, i = search.cv_results_, search.best_index_
        sign = {m: -1 if m == "brier" else 1 for m in CV_SCORERS}
        results[name] = {
            "best_params": {k.split("__")[-1]: v for k, v in search.best_params_.items()},
            "mean": {m: float(sign[m] * cv[f"mean_test_{m}"][i]) for m in CV_SCORERS},
            "std": {m: float(cv[f"std_test_{m}"][i]) for m in CV_SCORERS},
        }
        fitted[name] = search.best_estimator_
        print(f"  {name:38s} PR-AUC {results[name]['mean']['pr_auc']:.3f} ± {results[name]['std']['pr_auc']:.3f}")
    return results, fitted


def calibrated(pipe, method):
    if method == "none":
        return clone(pipe)
    # ensemble=False: one model trained on all data, calibrator fit on its out-of-fold predictions
    return CalibratedClassifierCV(clone(pipe), method=method, cv=cv_splitter(SEED + 1), ensemble=False)


def choose_calibration(pipe, X, y):
    """Out-of-fold probabilities on the training split for each calibration option.
    Lowest Brier wins, but isotonic must beat the smooth options by ISOTONIC_MIN_GAIN."""
    oof = {
        method: cross_val_predict(calibrated(pipe, method), X, y, cv=cv_splitter(),
                                  method="predict_proba", n_jobs=-1)[:, 1]
        for method in ("none", "sigmoid", "isotonic")
    }
    briers = {m: float(brier_score_loss(y, p)) for m, p in oof.items()}
    smooth = min(("none", "sigmoid"), key=briers.get)
    best = "isotonic" if briers["isotonic"] < (1 - ISOTONIC_MIN_GAIN) * briers[smooth] else smooth
    return best, briers, oof


# ---------------------------------------------------------------- Model 2: failure-mode diagnosis

def mode_proba(model, X):
    return np.column_stack([p[:, 1] for p in model.predict_proba(X)])


def label_distribution(df, train):
    fail = df[df[FAILURE_COL] == 1]
    combos = fail[FAILURE_MODES].astype(str).agg("".join, axis=1)
    named = combos.map(lambda s: "+".join(m for m, bit in zip(FAILURE_MODES, s) if bit == "1") or "(no mode flagged)")
    return {
        "all_rows": df[FAILURE_MODES].sum().astype(int).to_dict(),
        "failed_rows": fail[FAILURE_MODES].sum().astype(int).to_dict(),
        "train_failed_rows": mode_targets(train[train[FAILURE_COL] == 1]).sum().astype(int).to_dict(),
        "failures": int(len(fail)),
        "multi_mode_failures": int((fail[FAILURE_MODES].sum(axis=1) > 1).sum()),
        "combinations": named.value_counts().to_dict(),
        "flag_without_failure": {m: int(((df[m] == 1) & (df[FAILURE_COL] == 0)).sum()) for m in FAILURE_MODES},
    }


def compare_diagnosis(X, Y, modes):
    """5-fold CV stratified on label combinations, on training failures only."""
    folds = list(cv_splitter().split(X, labelset_key(Y, CV_FOLDS)))
    results, oofs = {}, {}
    for algo, pipe in diagnosis_candidates():
        oof = np.zeros(Y.shape)
        macro, micro = [], []
        for tr, va in folds:
            model = clone(pipe).fit(X.iloc[tr], Y.iloc[tr])
            oof[va] = mode_proba(model, X.iloc[va])
            pred = (oof[va] >= MODE_THRESHOLD).astype(int)
            macro.append(f1_score(Y.iloc[va], pred, average="macro", zero_division=0))
            micro.append(f1_score(Y.iloc[va], pred, average="micro", zero_division=0))
        results[algo] = {
            "macro_f1": float(np.mean(macro)), "macro_f1_std": float(np.std(macro)),
            "micro_f1": float(np.mean(micro)), "micro_f1_std": float(np.std(micro)),
            "per_label_oof": multilabel_scores(Y, oof >= MODE_THRESHOLD, modes),
        }
        oofs[algo] = oof
        print(f"  {algo:20s} macro-F1 {results[algo]['macro_f1']:.3f} ± {results[algo]['macro_f1_std']:.3f}")
    return results


def rnf_check(pipe, train):
    """Can RNF be predicted from the six inputs at all? CV on all training rows."""
    y = train["RNF"].astype(int)
    scores = cross_validate(clone(pipe), features(train), y, cv=cv_splitter(),
                            scoring=["roc_auc", "average_precision"], n_jobs=-1)
    return {
        "positives": int(y.sum()), "rows": int(len(y)), "prevalence": float(y.mean()),
        "roc_auc": float(scores["test_roc_auc"].mean()), "roc_auc_std": float(scores["test_roc_auc"].std()),
        "pr_auc": float(scores["test_average_precision"].mean()),
    }


# ---------------------------------------------------------------- main

def main():
    MODELS.mkdir(exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)
    out = {}

    df = load_dataset()
    train, test = split(df)
    X_train, y_train = features(train), train[FAILURE_COL]
    X_test, y_test = features(test), test[FAILURE_COL]
    out["data"] = {
        "rows": len(df), "train_rows": len(train), "test_rows": len(test),
        "train_failures": int(y_train.sum()), "test_failures": int(y_test.sum()),
    }
    print(f"Train {len(train):,} rows ({y_train.sum()} failures), test {len(test):,} ({y_test.sum()} failures)")

    # ---- Model 1: compare, select, calibrate, threshold (training split only)
    print("\nModel 1: 5-fold CV comparison")
    comparison, fitted = compare_detectors(X_train, y_train)
    selected = max(comparison, key=lambda n: comparison[n]["mean"]["pr_auc"])
    print(f"Selected: {selected}")

    method, briers, oof = choose_calibration(fitted[selected], X_train, y_train)
    threshold = best_f1_threshold(y_train, oof[method])
    print(f"Calibration: {method} (OOF Brier {briers}), threshold {threshold:.3f}")

    detector = calibrated(fitted[selected], method).fit(X_train, y_train)
    out["model1"] = {
        "comparison": comparison, "selected": selected, "selection_rule": "highest mean CV PR-AUC",
        "calibration": method, "calibration_brier_oof": briers, "isotonic_min_gain": ISOTONIC_MIN_GAIN, "threshold": threshold,
        "threshold_rule": "maximises failure-class F1 on out-of-fold training predictions",
        "oof_at_threshold": binary_metrics(y_train, oof[method], threshold),
    }

    # ---- Model 1: final test evaluation (first and only use of the test split for Model 1)
    risk_test = detector.predict_proba(X_test)[:, 1]
    out["model1"]["test"] = binary_metrics(y_test, risk_test, threshold)
    out["model1"]["test_uncalibrated"] = binary_metrics(
        y_test, fitted[selected].predict_proba(X_test)[:, 1], threshold)
    print(f"Test: {out['model1']['test']}")

    best_per_algo = {}
    for name in comparison:
        algo = name.split(" (")[0]
        if algo not in best_per_algo or comparison[name]["mean"]["pr_auc"] > comparison[best_per_algo[algo]]["mean"]["pr_auc"]:
            best_per_algo[algo] = name
    curves = {name: fitted[name].predict_proba(X_test)[:, 1] for name in best_per_algo.values()}

    # ---- Model 2: failure-mode diagnosis
    print("\nModel 2: failure-mode diagnosis")
    out["labels"] = label_distribution(df, train)
    fail_train, fail_test = train[train[FAILURE_COL] == 1], test[test[FAILURE_COL] == 1]
    positives = mode_targets(fail_train).sum()
    modes = [m for m in FAILURE_MODES if positives[m] >= MIN_MODE_POSITIVES]
    excluded = [m for m in FAILURE_MODES if m not in modes]
    X_ft, Y_ft = features(fail_train), mode_targets(fail_train)[modes]

    diag_cv = compare_diagnosis(X_ft, Y_ft, modes)
    diag_algo = max(diag_cv, key=lambda a: diag_cv[a]["macro_f1"])
    diag_pipe = dict(diagnosis_candidates())[diag_algo]
    diagnosis = clone(diag_pipe).fit(X_ft, Y_ft)

    Y_fte = mode_targets(fail_test)[modes]
    standalone_pred = (mode_proba(diagnosis, features(fail_test)) >= MODE_THRESHOLD).astype(int)
    flagged = risk_test >= threshold
    two_stage_pred = np.zeros((len(test), len(modes)), dtype=int)
    if flagged.any():
        two_stage_pred[flagged] = (mode_proba(diagnosis, X_test[flagged]) >= MODE_THRESHOLD).astype(int)

    out["model2"] = {
        "modes": modes, "excluded_modes": excluded, "min_positives": MIN_MODE_POSITIVES,
        "cv": diag_cv, "selected": diag_algo, "selection_rule": "highest mean CV macro-F1",
        "test_standalone": multilabel_scores(Y_fte, standalone_pred, modes),
        "test_two_stage": multilabel_scores(mode_targets(test)[modes], two_stage_pred, modes),
        "excluded_in_test_failures": {m: int(mode_targets(fail_test)[m].sum()) for m in excluded},
        "rnf_check": rnf_check(fitted[selected], train),
    }
    print(f"Selected: {diag_algo}; RNF check {out['model2']['rnf_check']}")

    # ---- Explainability and importance (selected detector, six inputs)
    print("\nSHAP and permutation importance")
    background = X_train.sample(100, random_state=SEED)
    explainer = make_explainer(detector, background)
    summary_rows = pd.concat([X_test.sample(300, random_state=SEED), X_test[y_test == 1]]).drop_duplicates()
    shap_summary = explain(explainer, summary_rows)

    pred_test = (risk_test >= threshold).astype(int)
    tn_idx = np.where((pred_test == 0) & (y_test.to_numpy() == 0))[0]
    tp_idx = np.where((pred_test == 1) & (y_test.to_numpy() == 1))[0]
    pick = lambda idx: idx[np.argsort(risk_test[idx])[len(idx) // 2]]  # median-risk example
    normal_i, failure_i = pick(tn_idx), pick(tp_idx)
    shap_normal = explain(explainer, X_test.iloc[[normal_i]])[0]
    shap_failure = explain(explainer, X_test.iloc[[failure_i]])[0]

    perm = permutation_importance(detector, X_test, y_test, scoring="average_precision",
                                  n_repeats=10, random_state=SEED, n_jobs=-1)
    out["importance"] = {f: {"mean": float(m), "std": float(s)}
                         for f, m, s in zip(FEATURES, perm.importances_mean, perm.importances_std)}
    out["shap_mean_abs"] = dict(zip(FEATURES, np.abs(shap_summary.values).mean(axis=0).round(4).tolist()))
    out["shap_examples"] = {
        "normal": {"risk": float(risk_test[normal_i]), "base": float(shap_normal.base_values)},
        "failure": {"risk": float(risk_test[failure_i]), "base": float(shap_failure.base_values)},
    }

    # ---- Robustness to messy sensor values (reporting only)
    out["robustness"] = {
        "clean": binary_metrics(y_test, risk_test, threshold),
        "messy": binary_metrics(y_test, detector.predict_proba(make_messy(X_test))[:, 1], threshold),
    }

    # ---- Figures, report, bundle
    figures.model_comparison(comparison, FIGURES / "01_model_comparison.png")
    figures.confusion(out["model1"]["test"], selected, FIGURES / "02_confusion_matrix.png")
    figures.pr_curves(y_test, curves, risk_test, out["model1"]["test"], selected, FIGURES / "03_precision_recall_curve.png")
    figures.roc_curves(y_test, curves, risk_test, out["model1"]["test"], selected, FIGURES / "04_roc_curve.png")
    figures.importance(out["importance"], FIGURES / "05_feature_importance.png")
    figures.shap_summary(shap_summary, FIGURES / "06_shap_summary.png")
    figures.shap_waterfall(shap_normal, "Normal example (correctly predicted no failure)", FIGURES / "07_shap_normal_example.png")
    figures.shap_waterfall(shap_failure, "Failure example (correctly detected)", FIGURES / "08_shap_failure_example.png")
    figures.calibration(y_test, fitted[selected].predict_proba(X_test)[:, 1], risk_test, method, FIGURES / "09_calibration.png")
    figures.diagnosis(out["model2"], FIGURES / "10_failure_type_results.png")

    bundle = {
        "detector": detector, "threshold": threshold, "calibration": method, "selected_model": selected,
        "diagnosis": diagnosis, "diagnosis_algorithm": diag_algo, "modes": modes,
        "background": background,
        "training_ranges": {f: [float(X_train[f].min()), float(X_train[f].max())] for f in FEATURES[1:]},
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "versions": {"scikit-learn": sklearn.__version__, "xgboost": xgboost.__version__, "shap": shap.__version__},
    }
    joblib.dump(bundle, BUNDLE_PATH)

    from src.predict import heldout_example  # after the bundle exists
    example = heldout_example(bundle, test)
    (REPORTS / "example_prediction.json").write_text(json.dumps(example, indent=2))

    (REPORTS / "metrics.json").write_text(json.dumps(out, indent=2, default=float))
    report.write(out, REPORTS / "model_evaluation.md")
    print(f"\nSaved bundle to {BUNDLE_PATH}\nReports in {REPORTS}")


if __name__ == "__main__":
    main()
