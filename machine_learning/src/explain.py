"""SHAP explanations on the six input features.

The explainer wraps the whole deployed pipeline (cleaning, derived features, encoding,
classifier and calibration), so contributions are attributed to the six inputs a caller
actually sends, in the same units as the dashboard risk score: calibrated failure
probability. For each prediction, baseline risk + sum of contributions = predicted risk.

Exact SHAP with an interventional background (100 training rows). Six features means
2^6 coalitions, so exact values are cheap. Contributions describe how the model uses
each input, not physical cause and effect.
"""
import numpy as np
import pandas as pd
import shap

from src.config import FEATURES

TYPE_CODES = {"L": 0, "M": 1, "H": 2}
TYPE_LETTERS = {v: k for k, v in TYPE_CODES.items()}


def encode(df):
    """Six features -> numeric array (Type as 0/1/2) so SHAP can mask it."""
    out = df[FEATURES].copy()
    out["Type"] = out["Type"].map(TYPE_CODES)
    return out.astype(float).to_numpy()


def decode(array):
    df = pd.DataFrame(array, columns=FEATURES)
    df["Type"] = df["Type"].round().astype(int).map(TYPE_LETTERS)
    return df


def make_explainer(detector, background):
    """`background` must be clean six-feature rows from the training set."""
    def risk(array):
        return detector.predict_proba(decode(array))[:, 1]

    masker = shap.maskers.Independent(encode(background), max_samples=len(background))
    return shap.explainers.Exact(risk, masker, feature_names=FEATURES)


def explain(explainer, rows):
    """SHAP Explanation for clean six-feature rows, with readable Type letters for plots."""
    exp = explainer(encode(rows), silent=True)
    exp.display_data = rows[FEATURES].to_numpy(dtype=object)
    return exp


def top_features(exp_row, k=3):
    order = np.argsort(-np.abs(exp_row.values))[:k]
    return [{
        "feature": FEATURES[i],
        "value": exp_row.display_data[i],
        "contribution": round(float(exp_row.values[i]), 4),
        "direction": "increased risk" if exp_row.values[i] > 0 else "decreased risk",
    } for i in order]
