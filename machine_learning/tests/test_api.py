"""The HTTP service must give the same answers as src.predict.predict, just batched."""
import pytest

from src.config import BUNDLE_PATH, FAILURE_COL, FEATURES

pytestmark = pytest.mark.skipif(not BUNDLE_PATH.exists(), reason="no trained bundle; run python -m src.train")

KEYS = ["type", "air_temp_k", "process_temp_k", "rpm", "torque_nm", "tool_wear_min"]


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from api import app
    return TestClient(app)


@pytest.fixture(scope="module")
def rows():
    import pandas as pd
    from src.data import load_dataset, split
    _, test = split(load_dataset())
    failed = test[test[FAILURE_COL] == 1].head(5)
    normal = test[test[FAILURE_COL] == 0].head(3)
    return [{f: (r[f].item() if hasattr(r[f], "item") else r[f]) for f in FEATURES} for _, r in pd.concat([failed, normal]).iterrows()]


def body(batch):
    return {"units": [{"unit": f"GT-0{i + 1}", "features": dict(zip(KEYS, (r[f] for f in FEATURES)))} for i, r in enumerate(batch)]}


def test_score_matches_single_prediction(client, rows):
    from src.predict import predict
    res = client.post("/score", json=body(rows)).json()["units"]
    explained = 0
    for r, got in zip(rows, res):
        want = predict(r, "x")
        mo, rb = want["model_output"], want["rule_based"]
        assert got["failure_risk"] == mo["failure_risk"]
        assert got["failure_class"] == mo["failure_class"]
        assert got["alert_level"] == rb["alert_level"]
        assert got["dispatch_maintenance"] == rb["dispatch_maintenance"]
        assert got["suggested_action"] == rb["suggested_action"]
        want_types = [t["code"] for t in mo["failure_types"]["predicted"]] if mo["failure_types"] else []
        assert sorted(t["code"] for t in got["failure_types"]) == sorted(want_types)
        if got["top_features"] is not None:
            explained += 1
            assert got["top_features"] == mo["explanation"]["top_features"]
    assert sum(u["failure_class"] for u in res) >= 1
    assert explained >= 1


def test_out_of_range_reading_is_rejected(client, rows):
    b = body(rows[:1])
    b["units"][0]["features"]["rpm"] = 99999
    assert client.post("/score", json=b).status_code == 422


def test_unknown_field_is_rejected(client, rows):
    b = body(rows[:1])
    b["units"][0]["features"]["Machine failure"] = 1
    assert client.post("/score", json=b).status_code == 422


def test_predict_passes_through(client, rows):
    res = client.post("/predict", json={"equipment_id": "GT-08", "reading": rows[0]})
    assert res.status_code == 200
    assert res.json()["model_output"]["failure_class"] in (0, 1)
    bad = client.post("/predict", json={"equipment_id": "GT-08", "reading": {**rows[0], "Machine failure": 1}})
    assert bad.status_code == 422
