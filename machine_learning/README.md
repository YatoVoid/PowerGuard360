# PowerGuard 360: predictive maintenance ML

Two-stage system on the UCI AI4I 2020 Predictive Maintenance dataset (10,000 readings):

1. **Model 1, failure detection**: will this equipment fail? Gives a 0/1 class and a calibrated risk score (0–1).
2. **Model 2, failure-type diagnosis**: if a failure is predicted, which failure mode(s)? Multilabel: TWF, HDF, PWF, OSF.

Every prediction includes the three inputs that pushed the risk up or down the most (SHAP). A separate rule layer
turns the model output into an alert level and a maintenance action.

```
6 inputs -> clean -> Model 1 (risk, class) --class 0--> Normal / Watch, no dispatch
                         |
                      class 1 -> Model 2 (failure modes) -> rules -> Alert / Critical + suggested action
                         |
                       SHAP -> top 3 inputs and their direction
```

Full method, all measured numbers and limitations: **[reports/model_evaluation.md](reports/model_evaluation.md)**.
Charts: `reports/figures/`. Example API output: `reports/example_prediction.json`.

## Results (held-out 20% test set: 2,000 readings, 68 failures)

**Model 1: Random Forest**, sigmoid-calibrated, alert threshold 0.614. Model, calibration and threshold were all
chosen on the training split only.

| Metric | Value | Plain meaning |
|---|---|---|
| Precision | 0.964 | 53 of 55 alerts were real failures |
| Recall | 0.779 | caught 53 of 68 real failures |
| F1 | 0.862 | balance of the two |
| PR-AUC | 0.899 | ranking quality on rare failures (no-skill = 0.034) |
| ROC-AUC | 0.983 | |
| Brier | 0.0070 | error of the risk score as a probability (lower is better) |

Confusion matrix: 1,930 true negatives, **2 false alerts**, **15 missed failures**, 53 caught.

Baseline logistic regression in CV: PR-AUC 0.50 vs. 0.90 for Random Forest; its best F1 was 0.38.
XGBoost came close (PR-AUC 0.88–0.89).

**Model 2: Random Forest, multilabel.** On true test failures: macro-F1 0.93 (HDF 1.00, PWF 1.00, OSF 0.94, TWF 0.78).
In the full two-stage pipeline: macro-F1 0.72, because Model 1 misses tool-wear failures, so TWF is never diagnosed (F1 0.00).

## Key limitations
- **Tool-wear failures (TWF) are mostly missed by Model 1.** In this dataset a tool fails at a random point between
  200 and 240 min of wear, so readings that fail and readings that don't look the same.
- **RNF (random failure) is not predicted.** It appears on 1 failure in the whole dataset; a check model scores
  ROC-AUC 0.55 ± 0.17, about a coin flip.
- **Synthetic data.** AI4I is a simulated milling machine, not a turbine. Real deployment needs retraining on real equipment data.
- **Only 68 test failures**, so each extra catch or miss moves recall by ~1.5 points.
- **SHAP explains the model, not the machine.**

## Setup (VS Code, Windows)

Open the `machine_learning` folder in VS Code, then in the terminal:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run (from the `machine_learning` folder)

```powershell
python -m src.train     # ~2.5 min: CV comparison, calibration, threshold, test evaluation,
                        # SHAP, figures, reports/model_evaluation.md, models/powerguard_bundle.joblib
python -m src.predict   # held-out record + an Arduino/replay example, printed as JSON
pytest                  # 20 tests: cleaning, feature validation, input builder, inference, SHAP additivity
```

Training is reproducible: fixed seeds; two runs give identical `metrics.json`.
The trained bundle `models/powerguard_bundle.joblib` is committed, so `predict` works right after cloning.
It was saved with scikit-learn 1.9.1, xgboost 3.2.0 and shap 0.51.0; if your versions differ and loading fails,
run `python -m src.train` to rebuild it.

## Using it from the backend (FastAPI)

```python
from src.predict import predict

reading = {
    "Type": "L",
    "Air temperature [K]": 298.1,
    "Process temperature [K]": 308.6,
    "Rotational speed [rpm]": 1551,
    "Torque [Nm]": 42.8,
    "Tool wear [min]": 0,
}
result = predict(reading, equipment_id="GT-01",
                 sources={f: "dataset_replay" for f in reading})   # measured / simulated / dataset_replay / manual
```

- `reading` must have **exactly** the six AI4I keys. Missing or extra keys (e.g. `Machine failure`) raise `ValueError`.
- Messy values (`"25 C"`, `"1,551 rpm"`, `"N/A"`, `-999`) are cleaned. Anything unusable is filled with the training
  median and listed in `data_quality.imputed_features`. Values outside the training range are listed in `data_quality.warnings`.
- The response has separate sections: `inputs` (value, raw value, source), `model_output` (class, risk, threshold,
  failure types, SHAP top 3) and `rule_based` (alert level, dispatch yes/no, suggested action). See
  `reports/example_prediction.json`.

Alert levels (rules in `src/maintenance.py`, not learned): Normal < threshold/2 ≤ Watch < threshold ≤ Alert < 0.80 ≤ Critical.

## Arduino and digital twin

`src/input_builder.py` combines Arduino readings (firmware payload: `temperature_c`, `pressure_hpa`, `light_raw`,
`air_quality_raw`) with a dataset-replay or simulated record:

```python
from src.input_builder import build_model_input
feats, sources, context = build_model_input(replay_record, arduino=payload["readings"], use_measured_air_temp=True)
result = predict(feats, "GT-01", sources=sources, context=context)
```

- Only the Grove temperature maps to an AI4I input (Air temperature). It is used only when you opt in, and is labelled `measured`.
  Process temperature is then shifted to keep the record's air/process gap, labelled `simulated`.
- Pressure, light and air quality have no AI4I counterpart. They are returned as `context_readings` with `model_input: false`.
- The model input stays the same six features. Miniature-hardware readings do not represent industrial operating conditions.

## Branch
Work on `sakina/docs`.
