"""Feature validation, input builder and end-to-end inference.

Inference tests need a trained bundle (python -m src.train) and are skipped without one.
"""
import json

import pytest

from src.config import BUNDLE_PATH, FEATURES
from src.data import features, load_dataset, split
from src.input_builder import build_model_input
from src.maintenance import alert_level, recommendation
from src.predict import predict, validate

READING = {
    "Type": "L", "Air temperature [K]": 298.1, "Process temperature [K]": 308.6,
    "Rotational speed [rpm]": 1551, "Torque [Nm]": 42.8, "Tool wear [min]": 0,
}

needs_bundle = pytest.mark.skipif(not BUNDLE_PATH.exists(), reason="no trained bundle; run python -m src.train")


# ---- feature validation

def test_valid_reading_passes():
    validate(READING)


def test_missing_feature_is_rejected():
    reading = {k: v for k, v in READING.items() if k != "Torque [Nm]"}
    with pytest.raises(ValueError, match="Missing: \\['Torque \\[Nm\\]'\\]"):
        validate(reading)


def test_target_column_cannot_be_sent_as_input():
    with pytest.raises(ValueError, match="Unexpected: \\['Machine failure'\\]"):
        validate({**READING, "Machine failure": 0})


def test_non_dict_is_rejected():
    with pytest.raises(TypeError):
        validate([READING])


def test_unknown_source_is_rejected():
    with pytest.raises(ValueError, match="Unknown input source"):
        predict(READING, "GT-01", sources={"Type": "guess"}, bundle={})


# ---- rule-based maintenance

def test_alert_levels():
    assert alert_level(0.05, 0.6) == "Normal"
    assert alert_level(0.35, 0.6) == "Watch"
    assert alert_level(0.65, 0.6) == "Alert"
    assert alert_level(0.95, 0.6) == "Critical"


def test_recommendation_only_dispatches_on_alert():
    assert recommendation("Watch", ["HDF"])["dispatch_maintenance"] is False
    assert recommendation("Alert", [])["dispatch_maintenance"] is True


# ---- input builder (Arduino + replay)

def test_builder_keeps_six_features_and_labels_sources():
    arduino = {"temperature_c": 24.0, "pressure_hpa": 1012.0, "light_raw": 2800, "air_quality_raw": 300}
    feats, sources, context = build_model_input(READING, arduino=arduino, use_measured_air_temp=True)
    assert list(feats) == FEATURES
    assert feats["Air temperature [K]"] == pytest.approx(297.15)
    assert sources["Air temperature [K]"] == "measured"
    assert sources["Process temperature [K]"] == "simulated"
    # air/process gap from the replay record is kept
    assert feats["Process temperature [K]"] - feats["Air temperature [K]"] == pytest.approx(10.5)
    assert sources["Torque [Nm]"] == "dataset_replay"
    assert context["pressure_hpa"]["model_input"] is False


def test_builder_ignores_measured_temperature_unless_asked():
    feats, sources, context = build_model_input(READING, arduino={"temperature_c": 24.0})
    assert feats == READING
    assert set(sources.values()) == {"dataset_replay"}
    assert context["temperature_c"]["model_input"] is False


# ---- end-to-end inference

@needs_bundle
def test_prediction_is_json_with_required_fields():
    result = predict(READING, "GT-01", sources={f: "manual" for f in FEATURES})
    json.dumps(result)  # serialisable
    out = result["model_output"]
    assert result["equipment_id"] == "GT-01" and result["timestamp"]
    assert set(result["inputs"]) == set(FEATURES)
    assert out["failure_class"] in (0, 1)
    assert 0.0 <= out["failure_risk"] <= 1.0
    assert len(out["explanation"]["top_features"]) == 3
    assert {t["direction"] for t in out["explanation"]["top_features"]} <= {"increased risk", "decreased risk"}
    assert result["rule_based"]["alert_level"] in {"Normal", "Watch", "Alert", "Critical"}


@needs_bundle
def test_shap_contributions_add_up_to_risk():
    from src.explain import explain
    from src.predict import _clean_six, _explainer, load_bundle

    bundle = load_bundle()
    clean, _ = _clean_six(READING, bundle["detector"])
    exp = explain(_explainer(bundle), clean)[0]
    risk = bundle["detector"].predict_proba(clean)[0, 1]
    assert exp.base_values + exp.values.sum() == pytest.approx(risk, abs=1e-6)


@needs_bundle
def test_messy_values_are_flagged_not_crashed():
    messy = {**READING, "Torque [Nm]": "N/A", "Air temperature [K]": "25.0 C"}
    result = predict(messy, "GT-01")
    assert result["data_quality"]["imputed_features"] == ["Torque [Nm]"]
    assert result["inputs"]["Air temperature [K]"]["value"] == pytest.approx(298.15)


@needs_bundle
def test_heldout_record_without_labels():
    _, test = split(load_dataset())
    reading = features(test).iloc[0].to_dict()
    assert set(reading) == set(FEATURES)
    assert predict(reading, "DEMO")["model_output"]["failure_class"] in (0, 1)
