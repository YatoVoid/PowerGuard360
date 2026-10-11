"""Build the six-feature model input from Arduino readings plus replayed or simulated values.

The model was trained on AI4I 2020 milling-machine data. Our miniature hardware does not
measure an industrial machine, so the builder never pretends it does:

- Only the Grove temperature has an AI4I counterpart (Air temperature). It is used only
  when the caller opts in, and is labelled "measured".
- Process temperature is shifted by the same amount so the air/process gap from the
  replay record is kept (the model relies on that gap). It is labelled "simulated".
- Pressure, light and air quality have no AI4I counterpart. They are passed through as
  context and are NOT model inputs.
- Every other input comes from the replay/simulated record and keeps that label.
"""
from src.config import FEATURES

AIR, PROCESS = "Air temperature [K]", "Process temperature [K]"
CONTEXT_ONLY = ["pressure_hpa", "light_raw", "air_quality_raw"]


def build_model_input(base_record, base_source="dataset_replay", arduino=None, use_measured_air_temp=False):
    """Return (features, sources, context).

    base_record: dict with the six AI4I features (a dataset replay row or simulator output).
    arduino: firmware payload "readings" dict, e.g. {"temperature_c": 23.8, "pressure_hpa": 1012.4, ...}.
    """
    missing = [f for f in FEATURES if f not in base_record]
    if missing:
        raise ValueError(f"base_record is missing {missing}")

    feats = {f: base_record[f] for f in FEATURES}
    sources = {f: base_source for f in FEATURES}
    arduino = arduino or {}
    context = {k: {"value": arduino[k], "source": "measured", "model_input": False}
               for k in CONTEXT_ONLY if k in arduino}

    if use_measured_air_temp and arduino.get("temperature_c") is not None:
        measured_k = round(float(arduino["temperature_c"]) + 273.15, 2)
        gap = float(base_record[PROCESS]) - float(base_record[AIR])
        feats[AIR], sources[AIR] = measured_k, "measured"
        feats[PROCESS], sources[PROCESS] = round(measured_k + gap, 2), "simulated"
        context["temperature_c"] = {"value": arduino["temperature_c"], "source": "measured",
                                    "model_input": True, "used_as": AIR}
    elif "temperature_c" in arduino:
        context["temperature_c"] = {"value": arduino["temperature_c"], "source": "measured", "model_input": False}

    return feats, sources, context
