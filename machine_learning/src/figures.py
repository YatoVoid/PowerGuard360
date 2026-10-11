"""Evaluation charts. Every chart is drawn from numbers measured in src/train.py."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shap  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402
from sklearn.metrics import brier_score_loss, precision_recall_curve, roc_curve  # noqa: E402

RED, GREY, BLUE, GREEN, AMBER = "#C8102E", "#5B5B63", "#0B4A8B", "#17613A", "#B26A00"
COLORS = [GREY, BLUE, GREEN, AMBER, RED]
plt.rcParams.update({"font.family": "Segoe UI", "axes.spines.top": False, "axes.spines.right": False,
                     "figure.dpi": 130, "axes.titleweight": "bold"})


def _save(fig, path):
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def model_comparison(comparison, path):
    metrics = [("pr_auc", "PR-AUC"), ("roc_auc", "ROC-AUC"), ("f1", "F1 (failure)"),
               ("precision", "Precision"), ("recall", "Recall")]
    names = list(comparison)
    y = np.arange(len(names))
    h = 0.8 / len(metrics)
    fig, ax = plt.subplots(figsize=(10, 6.5))
    for k, ((key, label), color) in enumerate(zip(metrics, COLORS)):
        means = [comparison[n]["mean"][key] for n in names]
        stds = [comparison[n]["std"][key] for n in names]
        ax.barh(y + (k - 2) * h, means, h, xerr=stds, label=label, color=color, capsize=2)
    ax.set_yticks(y, names)
    ax.invert_yaxis()
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("Score (5-fold CV on training split, mean ± std; label metrics at 0.5)")
    ax.set_title("Model 1: failure detection, model comparison")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.09), ncol=len(metrics), frameon=False)
    _save(fig, path)


def confusion(m, name, path):
    cm = np.array([[m["tn"], m["fp"]], [m["fn"], m["tp"]]])
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    ax.imshow(cm, cmap="Blues")
    labels = [["True negative", "False positive\n(false alert)"], ["False negative\n(missed failure)", "True positive"]]
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i, j]}\n{labels[i][j]}", ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "#141416", fontsize=10)
    ax.set_xticks([0, 1], ["No failure", "Failure"])
    ax.set_yticks([0, 1], ["No failure", "Failure"])
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(f"Test set confusion matrix\n{name}, threshold {m['threshold']:.3f}", fontsize=11)
    _save(fig, path)


def pr_curves(y, curves, risk, m, selected, path):
    fig, ax = plt.subplots(figsize=(6.5, 5))
    for (name, proba), color in zip(curves.items(), [GREY, BLUE, GREEN]):
        if name == selected:  # same ranking as the calibrated final model, drawn below in red
            continue
        p, r, _ = precision_recall_curve(y, proba)
        ax.plot(r, p, color=color, label=name)
    p, r, _ = precision_recall_curve(y, risk)
    ax.plot(r, p, color=RED, lw=2, label=f"Final: {selected}, calibrated (AP {m['pr_auc']:.3f})")
    ax.scatter([m["recall"]], [m["precision"]], color=RED, zorder=5, s=60,
               label=f"Operating point (threshold {m['threshold']:.3f})")
    ax.axhline(np.mean(y), color=GREY, ls=":", lw=1, label=f"No-skill ({np.mean(y):.3f})")
    ax.set_xlabel("Recall (share of real failures caught)")
    ax.set_ylabel("Precision (share of alerts that are real)")
    ax.set_title("Precision-recall curve (test set)")
    ax.legend(fontsize=8, frameon=False, loc="lower left", bbox_to_anchor=(0, 0.07))
    _save(fig, path)


def roc_curves(y, curves, risk, m, selected, path):
    fig, ax = plt.subplots(figsize=(6.5, 5))
    for (name, proba), color in zip(curves.items(), [GREY, BLUE, GREEN]):
        if name == selected:  # same ranking as the calibrated final model, drawn below in red
            continue
        fpr, tpr, _ = roc_curve(y, proba)
        ax.plot(fpr, tpr, color=color, label=name)
    fpr, tpr, _ = roc_curve(y, risk)
    ax.plot(fpr, tpr, color=RED, lw=2, label=f"Final: {selected}, calibrated (AUC {m['roc_auc']:.3f})")
    ax.plot([0, 1], [0, 1], color=GREY, ls=":", lw=1)
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate (recall)")
    ax.set_title("ROC curve (test set)")
    ax.legend(fontsize=8, frameon=False, loc="lower right")
    _save(fig, path)


def importance(imp, path):
    items = sorted(imp.items(), key=lambda kv: kv[1]["mean"])
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.barh([k for k, _ in items], [v["mean"] for _, v in items], xerr=[v["std"] for _, v in items],
            color=BLUE, capsize=3)
    ax.set_xlabel("Drop in PR-AUC when the feature is shuffled (test set, 10 repeats)")
    ax.set_title("Permutation feature importance (final model)")
    _save(fig, path)


def shap_summary(exp, path):
    plt.figure()
    shap.plots.beeswarm(exp, show=False, max_display=6, color_bar_label="Feature value (Type: L=0, M=1, H=2)")
    fig = plt.gcf()
    fig.set_size_inches(8, 4.5)
    plt.gca().set_xlabel("SHAP value (change in calibrated failure risk)")
    plt.title("SHAP summary: how each input moves the failure risk")
    _save(fig, path)


def shap_waterfall(exp_row, title, path):
    plt.figure()
    shap.plots.waterfall(exp_row, show=False, max_display=6)
    fig = plt.gcf()
    fig.set_size_inches(8, 4.5)
    plt.title(f"{title}\nRisk = baseline {exp_row.base_values:.3f} + contributions "
              f"= {exp_row.base_values + exp_row.values.sum():.3f}", fontsize=10)
    _save(fig, path)


def calibration(y, raw, calibrated, method, path):
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.plot([0, 1], [0, 1], color=GREY, ls=":", lw=1, label="Perfect calibration")
    for proba, label, color in [(raw, "Before calibration", GREY), (calibrated, f"After ({method})", RED)]:
        frac, mean = calibration_curve(y, proba, n_bins=10, strategy="uniform")
        ax.plot(mean, frac, "o-", color=color, label=f"{label}, Brier {brier_score_loss(y, proba):.4f}")
    counts, edges = np.histogram(calibrated, bins=10, range=(0, 1))
    for c, lo in zip(counts, edges[:-1]):
        if c:
            ax.text(lo + 0.05, -0.07, str(c), ha="center", fontsize=7, color=GREY)
    ax.set_ylim(-0.1, 1.05)
    ax.set_xlabel("Predicted failure risk  (grey numbers: test readings per bin, after calibration)")
    ax.set_ylabel("Observed failure rate")
    ax.set_title("Reliability curve (test set, 10 equal-width bins)")
    ax.legend(fontsize=8, frameon=False)
    _save(fig, path)


def diagnosis(m2, path):
    modes = m2["modes"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.3), sharey=True)
    for ax, key, title in [(axes[0], "test_standalone", "Diagnosis on true failures (standalone)"),
                           (axes[1], "test_two_stage", "Full two-stage pipeline (all test rows)")]:
        scores = m2[key]
        x = np.arange(len(modes))
        for k, (metric, color) in enumerate([("precision", BLUE), ("recall", GREEN), ("f1", RED)]):
            vals = [scores[mo][metric] for mo in modes]
            bars = ax.bar(x + (k - 1) * 0.27, vals, 0.27, label=metric.capitalize(), color=color)
            ax.bar_label(bars, fmt="%.2f", fontsize=7, padding=1)
        ax.set_xticks(x, [f"{mo}\n(n={scores[mo]['support']})" for mo in modes])
        ax.set_ylim(0, 1.12)
        ax.set_title(f"{title}\nmacro-F1 {scores['macro avg']['f1']:.2f}, micro-F1 {scores['micro avg']['f1']:.2f}", fontsize=10)
    axes[0].legend(frameon=False, fontsize=8)
    fig.suptitle(f"Model 2: failure-type diagnosis ({m2['selected']}, multilabel); "
                 f"not modelled: {', '.join(m2['excluded_modes']) or 'none'}", fontsize=11, fontweight="bold")
    _save(fig, path)
