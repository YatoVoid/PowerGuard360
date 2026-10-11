"""API-friendly inference: one reading in, one JSON-ready dict out.

    from src.predict import predict
    result = predict(reading, equipment_id="GT-02", sources={...})

`reading` must hold exactly the six AI4I features (see config.FEATURES).
The response keeps three things apart: the inputs (with their source), what the models
output, and what the maintenance rules recommend.

Run from the machine_learning folder:  python -m src.predict
"""
import json
from datetime import datetime, timezone
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from src.config import (
    BUNDLE_PATH, FAILURE_COL, FAILURE_MODES, FAILURE_NAMES, FEATURE_TO_CLEAN, FEATURES, INPUT_SOURCES,
    MODE_THRESHOLD,
)
from src.explain import explain, make_explainer, top_features
from src.maintenance import alert_level, recommendation
from src.preprocessing import clean_raw


@lru_cache(maxsize=1)
def load_bundle(path=BUNDLE_PATH):
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Train first: python -m src.train")
    return joblib.load(path)


_EXPLAINERS = {}


def _explainer(bundle):
    """Build the SHAP explainer once per loaded bundle."""
    if id(bundle) not in _EXPLAINERS:
        _EXPLAINERS[id(bundle)] = make_explainer(bundle["detector"], bundle["background"])
    return _EXPLAINERS[id(bundle)]


def validate(reading):
    """Exactly the six AI4I features: no missing keys, no extra keys (targets can't sneak in)."""
    if not isinstance(reading, dict):
        raise TypeError("reading must be a dict of the six AI4I features")
    missing = [f for f in FEATURES if f not in reading]
    extra = [k for k in reading if k not in FEATURES]
    if missing or extra:
        raise ValueError(f"reading must contain exactly {FEATURES}. Missing: {missing}. Unexpected: {extra}.")


def _base_pipeline(detector):
    """The fitted pipeline inside the calibration wrapper (or the pipeline itself)."""
    return detector.calibrated_classifiers_[0].estimator if hasattr(detector, "calibrated_classifiers_") else detector


def _clean_six(reading, detector):
    """Cleaned values under the six AI4I names, plus which inputs were unusable and got filled."""
    raw = pd.DataFrame([reading])[FEATURES]
    parsed = clean_raw(raw)
    filled = _base_pipeline(detector).named_steps["clean"].transform(raw)
    clean = pd.DataFrame({f: filled[FEATURE_TO_CLEAN[f]] for f in FEATURES})
    imputed = [f for f in FEATURES if pd.isna(parsed[FEATURE_TO_CLEAN[f]].iloc[0])]
    return clean, imputed


def _py(value):
    return value.item() if isinstance(value, np.generic) else value


def predict(reading, equipment_id, sources=None, context=None, bundle=None):
    validate(reading)
    sources = {f: (sources or {}).get(f, "unspecified") for f in FEATURES}
    bad = {f: s for f, s in sources.items() if s not in INPUT_SOURCES}
    if bad:
        raise ValueError(f"Unknown input source(s) {bad}. Use one of {sorted(INPUT_SOURCES)}.")

    bundle = bundle or load_bundle()
    detector, threshold = bundle["detector"], bundle["threshold"]

    clean, imputed = _clean_six(reading, detector)
    risk = float(detector.predict_proba(clean)[0, 1])
    failure_class = int(risk >= threshold)

    warnings = [f"{f}: value unusable, replaced with training median/mode" for f in imputed]
    for f, (low, high) in bundle["training_ranges"].items():
        v = float(clean[f].iloc[0])
        if f not in imputed and not low <= v <= high:
            warnings.append(f"{f}: {v} is outside the training range [{low}, {high}]; prediction is extrapolated")

    if failure_class:
        probs = np.column_stack([p[:, 1] for p in bundle["diagnosis"].predict_proba(clean)])[0]
        predicted = [m for m, p in zip(bundle["modes"], probs) if p >= MODE_THRESHOLD]
        failure_types = {
            "predicted": [{"code": m, "name": FAILURE_NAMES[m]} for m in predicted],
            "probabilities": {m: round(float(p), 4) for m, p in zip(bundle["modes"], probs)},
            "not_modelled": [m for m in FAILURE_MODES if m not in bundle["modes"]],
            "note": None if predicted else "Failure risk is high but no single failure mode is above "
                                          f"{MODE_THRESHOLD}; see probabilities.",
        }
    else:
        predicted, failure_types = [], None

    exp_row = explain(_explainer(bundle), clean)[0]
    level = alert_level(risk, threshold)

    return {
        "equipment_id": equipment_id,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "inputs": {
            f: {"value": _py(clean[f].iloc[0]), "raw": _py(reading[f]), "source": sources[f]} for f in FEATURES
        },
        "context_readings": context or {},
        "data_quality": {"imputed_features": imputed, "warnings": warnings},
        "model_output": {
            "label": "MODEL OUTPUT",
            "failure_class": failure_class,
            "failure_risk": round(risk, 4),
            "decision_threshold": round(threshold, 4),
            "failure_types": failure_types,
            "explanation": {
                "method": "SHAP (exact, interventional) on the six inputs, in calibrated-risk units",
                "baseline_risk": round(float(exp_row.base_values), 4),
                "top_features": [{**t, "value": _py(t["value"])} for t in top_features(exp_row)],
                "caveat": "Shows how the model used each input, not proof of physical cause.",
            },
            "model": {"detector": bundle["selected_model"], "calibration": bundle["calibration"],
                      "diagnosis": bundle["diagnosis_algorithm"], "trained_at": bundle["trained_at"]},
        },
        "rule_based": {
            "label": "RULE-BASED RECOMMENDATION (not a model output)",
            "alert_level": level,
            **recommendation(level, predicted),
        },
    }


def heldout_example(bundle, test, row_position=None):
    """Predict on a held-out test record. Only the six features are sent; the true
    labels are attached afterwards, outside the input, for reference."""
    if row_position is None:
        row_position = int(np.flatnonzero(test[FAILURE_COL].to_numpy() == 1)[0])
    row = test.iloc[row_position]
    reading = {f: _py(row[f]) for f in FEATURES}
    result = predict(reading, equipment_id="DEMO-HELDOUT",
                     sources={f: "dataset_replay" for f in FEATURES}, bundle=bundle)
    return {
        "input_sent": reading,
        "prediction": result,
        "actual_labels_for_reference_only": {c: int(row[c]) for c in [FAILURE_COL] + FAILURE_MODES},
    }


if __name__ == "__main__":
    from src.data import load_dataset, split
    from src.input_builder import build_model_input

    bundle = load_bundle()
    _, test = split(load_dataset())
    print("== Held-out test record (dataset replay)")
    print(json.dumps(heldout_example(bundle, test), indent=2))

    print("\n== Arduino + replay (Grove temperature used as air temperature)")
    replay = {f: _py(test.iloc[0][f]) for f in FEATURES}
    arduino = {"temperature_c": 24.6, "pressure_hpa": 1011.8, "light_raw": 2870, "air_quality_raw": 312}
    feats, sources, context = build_model_input(replay, arduino=arduino, use_measured_air_temp=True)
    print(json.dumps(predict(feats, "GT-01", sources=sources, context=context, bundle=bundle), indent=2))
