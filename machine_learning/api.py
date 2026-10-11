"""HTTP service for the plant server: failure detection, failure-type diagnosis and the rule-based action.

Run from the machine_learning folder:
    .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8790

POST /score    every running turbine in one call (the plant server sends this once a second)
POST /predict  one reading in the six AI4I names, full src.predict output
GET  /health
"""
from collections import OrderedDict
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.config import FAILURE_NAMES, FEATURE_TO_CLEAN, FEATURES, MODE_THRESHOLD
from src.explain import explain, top_features
from src.maintenance import alert_level, recommendation
from src.predict import _base_pipeline, _explainer, _py, load_bundle, predict
from src.preprocessing import clean_raw

# SHAP costs ~170 ms a row, so only the riskiest units get an explanation each call.
MAX_EXPLAINED = 3
# Simulated units hold each reading for several seconds, so the same row is explained once, not every call.
_explained_cache: OrderedDict = OrderedDict()
_CACHE_SIZE = 256

bundle = load_bundle()
# Building the SHAP explainer and its first run take a few seconds; do it before the first request, not during it.
explain(_explainer(bundle), bundle["background"].head(1))
app = FastAPI(title="PowerGuard 360 ML", docs_url=None, redoc_url=None, openapi_url=None)


class Features(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["L", "M", "H"]
    air_temp_k: float = Field(ge=250, le=350)
    process_temp_k: float = Field(ge=250, le=400)
    rpm: float = Field(ge=0, le=5000)
    torque_nm: float = Field(ge=0, le=200)
    tool_wear_min: float = Field(ge=0, le=500)


class Unit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit: str = Field(pattern=r"^GT-0[1-8]$")
    features: Features


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    units: list[Unit] = Field(min_length=1, max_length=8)


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    equipment_id: str = Field(max_length=40)
    reading: dict[str, str | float | int | None]
    sources: dict[str, str] | None = None


def _six(f: Features):
    return {
        "Type": f.type, "Air temperature [K]": f.air_temp_k, "Process temperature [K]": f.process_temp_k,
        "Rotational speed [rpm]": f.rpm, "Torque [Nm]": f.torque_nm, "Tool wear [min]": f.tool_wear_min,
    }


def score(units):
    """Same steps as src.predict.predict, batched: clean, Model 1 risk, Model 2 types on flagged rows, SHAP, rules."""
    detector, threshold, modes = bundle["detector"], bundle["threshold"], bundle["modes"]
    raw = pd.DataFrame([_six(u.features) for u in units])[FEATURES]
    parsed = clean_raw(raw)
    filled = _base_pipeline(detector).named_steps["clean"].transform(raw)
    clean = pd.DataFrame({f: filled[FEATURE_TO_CLEAN[f]].to_numpy() for f in FEATURES})

    risk = detector.predict_proba(clean)[:, 1]
    failing = risk >= threshold
    mode_probs = np.zeros((len(units), len(modes)))
    if failing.any():
        mode_probs[failing] = np.column_stack([p[:, 1] for p in bundle["diagnosis"].predict_proba(clean[failing])])

    explained = {}
    worth = [int(i) for i in np.argsort(-risk) if risk[i] >= threshold / 2][:MAX_EXPLAINED]
    keys = {i: tuple(_py(v) for v in clean.iloc[i]) for i in worth}
    for i in worth:
        if keys[i] in _explained_cache:
            _explained_cache.move_to_end(keys[i])
            explained[i] = _explained_cache[keys[i]]
    todo = [i for i in worth if i not in explained]
    if todo:
        exp = explain(_explainer(bundle), clean.iloc[todo].reset_index(drop=True))
        for k, i in enumerate(todo):
            explained[i] = _explained_cache[keys[i]] = [{**t, "value": _py(t["value"])} for t in top_features(exp[k])]
        while len(_explained_cache) > _CACHE_SIZE:
            _explained_cache.popitem(last=False)

    out = []
    for i, u in enumerate(units):
        r = float(risk[i])
        predicted = [m for m, p in zip(modes, mode_probs[i]) if failing[i] and p >= MODE_THRESHOLD]
        level = alert_level(r, threshold)
        out.append({
            "unit": u.unit,
            "failure_risk": round(r, 4),
            "failure_class": int(failing[i]),
            "failure_types": [{"code": m, "name": FAILURE_NAMES[m], "probability": round(float(mode_probs[i][modes.index(m)]), 4)}
                              for m in sorted(predicted, key=lambda m: -mode_probs[i][modes.index(m)])],
            "mode_probabilities": {m: round(float(p), 4) for m, p in zip(modes, mode_probs[i])} if failing[i] else None,
            "top_features": explained.get(i),
            "imputed_features": [f for f in FEATURES if pd.isna(parsed[FEATURE_TO_CLEAN[f]].iloc[i])],
            "alert_level": level,
            **recommendation(level, predicted),
        })
    return out


@app.get("/health")
def health():
    return {"ok": True, "detector": bundle["selected_model"], "diagnosis": bundle["diagnosis_algorithm"],
            "threshold": round(bundle["threshold"], 4), "modes": bundle["modes"], "trained_at": bundle["trained_at"]}


@app.post("/score")
def score_units(body: ScoreRequest):
    return {"threshold": round(bundle["threshold"], 4), "model": bundle["selected_model"], "units": score(body.units)}


@app.post("/predict")
def predict_one(body: PredictRequest):
    try:
        return predict(body.reading, body.equipment_id, sources=body.sources, bundle=bundle)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e))
