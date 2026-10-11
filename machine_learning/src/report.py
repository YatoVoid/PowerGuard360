"""Write reports/model_evaluation.md from the numbers measured in src/train.py."""


def _f(x, d=3):
    return f"{x:.{d}f}"


def _ms(r, key, d=3):
    return f"{r['mean'][key]:.{d}f} ± {r['std'][key]:.{d}f}"


def _ml_table(scores, labels):
    rows = ["| Label | Precision | Recall | F1 | Support |", "|---|---|---|---|---|"]
    for label in list(labels) + ["micro avg", "macro avg"]:
        s = scores[label]
        rows.append(f"| {label} | {_f(s['precision'])} | {_f(s['recall'])} | {_f(s['f1'])} | {s['support']} |")
    return "\n".join(rows)


def write(out, path):
    d, m1, m2, lab = out["data"], out["model1"], out["model2"], out["labels"]
    t, oof = m1["test"], m1["oof_at_threshold"]
    sel = m1["comparison"][m1["selected"]]
    rnf = m2["rnf_check"]

    comp = ["| Model | Best params | PR-AUC | ROC-AUC | F1 | Precision | Recall | Macro-F1 | Accuracy | Brier | FP / fold | FN / fold |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for name, r in m1["comparison"].items():
        params = ", ".join(f"{k}={v}" for k, v in r["best_params"].items())
        comp.append(f"| {'**' + name + '**' if name == m1['selected'] else name} | {params} | {_ms(r, 'pr_auc')} | "
                    f"{_ms(r, 'roc_auc')} | {_ms(r, 'f1')} | {_ms(r, 'precision')} | {_ms(r, 'recall')} | "
                    f"{_ms(r, 'macro_f1')} | {_ms(r, 'accuracy')} | {_ms(r, 'brier', 4)} | "
                    f"{r['mean']['false_positives']:.1f} | {r['mean']['false_negatives']:.1f} |")

    diag = ["| Algorithm | Macro-F1 (CV) | Micro-F1 (CV) |", "|---|---|---|"]
    for algo, r in m2["cv"].items():
        name = f"**{algo}**" if algo == m2["selected"] else algo
        diag.append(f"| {name} | {_f(r['macro_f1'])} ± {_f(r['macro_f1_std'])} | {_f(r['micro_f1'])} ± {_f(r['micro_f1_std'])} |")

    combos = "\n".join(f"| {k} | {v} |" for k, v in lab["combinations"].items())
    imp = sorted(out["importance"].items(), key=lambda kv: -kv[1]["mean"])
    imp_rows = "\n".join(f"| {k} | {_f(v['mean'])} ± {_f(v['std'])} | {_f(out['shap_mean_abs'][k], 4)} |" for k, v in imp)
    rob_c, rob_m = out["robustness"]["clean"], out["robustness"]["messy"]
    weak = [mo for mo in m2["modes"] if m2["test_two_stage"][mo]["recall"] < 0.5]

    md = f"""# PowerGuard 360: model evaluation

All numbers below were produced by `python -m src.train` on the UCI AI4I 2020 dataset
({d['rows']:,} rows). Nothing is hand-entered. Raw values are in `metrics.json`; charts in `figures/`.

## 1. Method

**Inputs (both models):** Type, Air temperature [K], Process temperature [K], Rotational speed [rpm],
Torque [Nm], Tool wear [min]. UDI, Product ID, Machine failure and the five mode flags are never inputs.
Inside the pipeline three values are derived from the six inputs (process−air temperature gap,
mechanical power, tool wear × torque); callers still send only the six.

**Split:** 80% train ({d['train_rows']:,} rows, {d['train_failures']} failures) / 20% test
({d['test_rows']:,} rows, {d['test_failures']} failures), stratified on Machine failure, `random_state=42`.
The test split was used once, after every choice below was fixed.

**Leakage control:** cleaning, imputation, scaling, one-hot encoding and class weights are pipeline steps,
so they are re-fit inside every training fold. Hyperparameters, model choice, calibration method and
decision threshold were all chosen from 5-fold stratified CV on the training split.

**Model 1 steps**
1. Six candidates: Logistic Regression (baseline), Random Forest, XGBoost, each unweighted and class-weighted.
   Small hyperparameter grid per candidate, 5-fold CV, best setting by PR-AUC.
2. Selection rule: {m1['selection_rule']} → **{m1['selected']}**.
3. Calibration: none / sigmoid / isotonic compared by out-of-fold Brier score on the training split →
   **{m1['calibration']}** (Brier: {", ".join(f"{k} {_f(v, 4)}" for k, v in m1['calibration_brier_oof'].items())}).
4. Decision threshold: {m1['threshold_rule']} → **{_f(m1['threshold'])}**.
5. Final model refit on the whole training split, then scored once on the test split.

## 2. What the metrics mean

| Metric | Plain meaning |
|---|---|
| Accuracy | Share of all readings classified correctly. Misleading here: always saying "no failure" scores ~96.6%. |
| Precision (failure) | Of the maintenance alerts raised, how many were real failures. Low precision = crews chasing false alarms. |
| Recall (failure) | Of the real failures, how many the model caught. Low recall = missed breakdowns. |
| F1 (failure) | One number balancing precision and recall (their harmonic mean). |
| Macro-F1 | Average of the F1 for "failure" and "no failure", so the rare class counts equally. |
| ROC-AUC | How well the risk score ranks failures above non-failures (1 = perfect, 0.5 = coin flip). Can look good even when alerts are mostly false, because non-failures dominate. |
| PR-AUC / Average Precision | Precision averaged over all recall levels. The most honest single score for rare failures; no-skill = failure rate ({_f(d['test_failures'] / d['test_rows'])}). |
| Brier score | Mean squared error of the risk score as a probability (0 = perfect). Lower = the "% risk" on the dashboard is more trustworthy. |
| Reliability curve | Predicted risk vs. how often failures actually happened. On the diagonal = calibrated. With ~68 test failures, most mid-range bins hold 1-2 readings, so the curve is noisy there; Brier is the steadier number. |
| False positive / negative | False alert / missed failure. |

## 3. Model 1: failure detection

### Cross-validation comparison (training split, mean ± std over 5 folds; label metrics at 0.5)

{chr(10).join(comp)}

Weighted models push their probabilities up for the rare class, which raises recall at 0.5 but hurts
Brier; that is why the final model is calibrated and the threshold is tuned separately.

### Training-only estimate at the chosen threshold (out-of-fold, calibrated)
Precision {_f(oof['precision'])}, recall {_f(oof['recall'])}, F1 {_f(oof['f1'])},
{oof['fp']} false alerts and {oof['fn']} missed failures over {d['train_rows']:,} training rows.

### Final test result ({m1['selected']}, {m1['calibration']} calibration, threshold {_f(t['threshold'])})

| Metric | Test |
|---|---|
| Accuracy | {_f(t['accuracy'])} |
| Precision (failure) | {_f(t['precision'])} |
| Recall (failure) | {_f(t['recall'])} |
| F1 (failure) | {_f(t['f1'])} |
| Macro-F1 | {_f(t['macro_f1'])} |
| ROC-AUC | {_f(t['roc_auc'])} |
| PR-AUC | {_f(t['pr_auc'])} |
| Brier (calibrated) | {_f(t['brier'], 4)} (uncalibrated: {_f(m1['test_uncalibrated']['brier'], 4)}) |

|  | Predicted no failure | Predicted failure |
|---|---|---|
| **Actual no failure** | {t['tn']} | {t['fp']} (false alerts) |
| **Actual failure** | {t['fn']} (missed) | {t['tp']} |

In plain words: out of {t['tp'] + t['fn']} real failures in the test set the model caught {t['tp']} and missed {t['fn']};
it raised {t['tp'] + t['fp']} alerts, of which {t['fp']} were false.

## 4. Model 2: failure-type diagnosis

### Label investigation (full dataset)

- {lab['failures']} failures. {lab['multi_mode_failures']} of them carry more than one mode flag, so modes are
  **not mutually exclusive** → Model 2 is **multilabel** (one weighted binary classifier per mode).
- Mode flags on failed rows: {", ".join(f"{k} {v}" for k, v in lab['failed_rows'].items())}.
- Flags on rows that did **not** fail (dataset inconsistency, ignored): {", ".join(f"{k} {v}" for k, v in lab['flag_without_failure'].items())}.
- Positive training failures per mode: {", ".join(f"{k} {v}" for k, v in lab['train_failed_rows'].items())}.
  Modes with fewer than {m2['min_positives']} are not modelled: **{", ".join(m2['excluded_modes']) or "none"}**.

| Mode combination on failed rows | Count |
|---|---|
{combos}

**Training data:** training-split failures only (diagnosis is conditional on a failure, matching the two-stage design).
**Validation:** 5-fold CV stratified on label combination (rare combinations pooled). Mode threshold 0.5.

{chr(10).join(diag)}

Selected: **{m2['selected']}** ({m2['selection_rule']}).

### Standalone diagnosis (test failures only, true failure known)
{_ml_table(m2['test_standalone'], m2['modes'])}

### Full two-stage pipeline (all {d['test_rows']:,} test rows: Model 1 at its threshold, then Model 2 on flagged rows)
{_ml_table(m2['test_two_stage'], m2['modes'])}

### RNF (random failure)
RNF appears on {lab['failed_rows']['RNF']} failed row(s) in the whole dataset, so it cannot be trained as a
diagnosis label. As an extra check, a model was trained to predict the raw RNF flag on all training rows
({rnf['positives']} positives out of {rnf['rows']:,}): CV ROC-AUC {_f(rnf['roc_auc'])} ± {_f(rnf['roc_auc_std'])},
PR-AUC {_f(rnf['pr_auc'], 4)} vs. a no-skill level of {_f(rnf['prevalence'], 4)}. This is consistent with RNF being
random with respect to the six inputs; the system makes no RNF predictions.

## 5. Explainability

- **SHAP** (exact, interventional, 100 training rows as background) is computed on the whole deployed pipeline,
  so contributions are attributed to the six inputs, in calibrated-risk units: baseline risk + contributions = predicted risk.
- **Permutation importance**: drop in test PR-AUC when one input is shuffled.

| Feature | Permutation importance (PR-AUC drop) | Mean abs SHAP |
|---|---|---|
{imp_rows}

SHAP shows how the model uses an input, not physical cause and effect. Correlated inputs (air and process
temperature) can share or trade credit.

## 6. Robustness to messy sensor values (test split, reporting only)

Test inputs corrupted with missing values, text like "N/A", glitch values (-999), units in the text,
Celsius instead of Kelvin and renamed headers (`src/messy.py`):
F1 {_f(rob_c['f1'])} → {_f(rob_m['f1'])}, recall {_f(rob_c['recall'])} → {_f(rob_m['recall'])},
precision {_f(rob_c['precision'])} → {_f(rob_m['precision'])}. Recoverable formats are repaired exactly (see tests);
the drop comes from values that are truly lost and get replaced by the training median.

## 7. Limitations

- **Small failure count.** {d['test_failures']} test failures: one more or one fewer catch moves recall by
  ~{_f(100 / d['test_failures'], 1)} points. Treat test metrics as estimates with real uncertainty (see CV std).
- **Synthetic source data.** AI4I 2020 is a synthetic dataset modelled on a milling machine, with failure rules
  that are close to deterministic functions of the inputs. Scores here will not transfer to real Chevron turbines
  without retraining on real equipment data.
- **Weak modes in the full pipeline:** {", ".join(weak) or "none"} (two-stage recall < 0.5). For TWF, the dataset
  triggers tool failure at a random tool-wear point between 200 and 240 min, so many identical-looking readings do not fail.
- **RNF is not predicted** (see above).
- **Hardware inputs.** Our Arduino sensors do not measure an industrial machine. Only the Grove temperature has an
  AI4I counterpart; any measured value outside the training range is flagged in the API response.
- **SHAP** explains the model, not the machine.
- The decision threshold balances precision and recall (max F1). If missed failures cost much more than false
  alerts, lower it and re-check the false-alert count.

## 8. Figures

| # | File |
|---|---|
| 1 | `figures/01_model_comparison.png` |
| 2 | `figures/02_confusion_matrix.png` |
| 3 | `figures/03_precision_recall_curve.png` |
| 4 | `figures/04_roc_curve.png` |
| 5 | `figures/05_feature_importance.png` |
| 6 | `figures/06_shap_summary.png` |
| 7 | `figures/07_shap_normal_example.png` |
| 8 | `figures/08_shap_failure_example.png` |
| 9 | `figures/09_calibration.png` |
| 10 | `figures/10_failure_type_results.png` |
"""
    path.write_text(md, encoding="utf-8")
