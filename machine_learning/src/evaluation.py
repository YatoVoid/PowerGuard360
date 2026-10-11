"""Metric helpers and threshold selection."""
import numpy as np
from sklearn.metrics import (
    accuracy_score, average_precision_score, brier_score_loss, confusion_matrix, f1_score,
    make_scorer, precision_recall_curve, precision_score, recall_score, roc_auc_score,
)


def _fp(y, pred):
    return int(((pred == 1) & (y == 0)).sum())


def _fn(y, pred):
    return int(((pred == 0) & (y == 1)).sum())


# Scorers used in cross-validation (threshold 0.5 for the label-based ones)
CV_SCORERS = {
    "accuracy": "accuracy",
    "precision": make_scorer(precision_score, zero_division=0),
    "recall": "recall",
    "f1": "f1",
    "macro_f1": "f1_macro",
    "roc_auc": "roc_auc",
    "pr_auc": "average_precision",
    "brier": "neg_brier_score",
    "false_positives": make_scorer(_fp),
    "false_negatives": make_scorer(_fn),
}


def binary_metrics(y, proba, threshold):
    y = np.asarray(y)
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "accuracy": accuracy_score(y, pred),
        "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred),
        "f1": f1_score(y, pred),
        "macro_f1": f1_score(y, pred, average="macro"),
        "roc_auc": roc_auc_score(y, proba),
        "pr_auc": average_precision_score(y, proba),
        "brier": brier_score_loss(y, proba),
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
    }


def best_f1_threshold(y, proba):
    """Threshold that maximises failure-class F1: the balance between catching
    failures (recall) and not raising false alerts (precision)."""
    precision, recall, thresholds = precision_recall_curve(y, proba)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    best = int(np.nanargmax(f1[:-1]))  # last point has no threshold
    return float(thresholds[best])


def multilabel_scores(Y, pred, labels):
    """Per-label precision/recall/F1/support plus micro and macro averages."""
    Y, pred = np.asarray(Y), np.asarray(pred)
    rows = {}
    for i, label in enumerate(labels):
        rows[label] = {
            "precision": precision_score(Y[:, i], pred[:, i], zero_division=0),
            "recall": recall_score(Y[:, i], pred[:, i], zero_division=0),
            "f1": f1_score(Y[:, i], pred[:, i], zero_division=0),
            "support": int(Y[:, i].sum()),
        }
    for avg in ("micro", "macro"):
        rows[f"{avg} avg"] = {
            "precision": precision_score(Y, pred, average=avg, zero_division=0),
            "recall": recall_score(Y, pred, average=avg, zero_division=0),
            "f1": f1_score(Y, pred, average=avg, zero_division=0),
            "support": int(Y.sum()),
        }
    return rows
