# File structure

```
machine_learning/
├── README.md                    # overview, results, run commands, API and hardware usage
├── STRUCTURE.md                 # this file
├── requirements.txt             # scikit-learn, xgboost, shap, pandas, ...
├── pytest.ini                   # lets tests import src/
├── .gitignore                   # .venv, caches, train.log
├── .vscode/settings.json        # interpreter, pytest, notebook root
├── dataset/
│   └── Predicive_Maintenance_Dataset.xlsx   # UCI AI4I 2020, 10,000 readings
├── src/
│   ├── config.py                # paths, the six features, valid ranges, label rules, seeds
│   ├── data.py                  # load, 80/20 stratified split, multilabel mode targets
│   ├── preprocessing.py         # SensorCleaner: messy values -> clean inputs, derived features
│   ├── models.py                # LR / RF / XGBoost pipelines, weighted + unweighted, grids
│   ├── evaluation.py            # metrics, CV scorers, threshold selection
│   ├── explain.py               # SHAP on the six inputs, in calibrated-risk units
│   ├── figures.py               # the 10 evaluation charts
│   ├── report.py                # writes reports/model_evaluation.md from measured numbers
│   ├── messy.py                 # corrupts data like a live feed (robustness check)
│   ├── train.py                 # full training + evaluation run
│   ├── predict.py               # predict(reading) -> JSON dict; held-out example
│   ├── input_builder.py         # Arduino readings + replay/simulated values -> six inputs
│   └── maintenance.py           # rule-based alert levels and actions (not ML)
├── models/                      # powerguard_bundle.joblib (committed; rebuilt by train.py)
├── reports/
│   ├── model_evaluation.md      # method, results, limitations
│   ├── metrics.json             # every measured number
│   ├── example_prediction.json  # API output for a held-out test record
│   └── figures/                 # 01_model_comparison.png ... 10_failure_type_results.png
├── notebooks/                   # exploration
└── tests/
    ├── test_preprocessing.py    # cleaning, derived features, label rules
    └── test_inference.py        # feature validation, input builder, JSON output, SHAP additivity
```

## Flow

```
dataset -> data.split (80/20) -> train.py
             training split: GridSearchCV (5-fold) -> pick model -> calibration -> threshold
             test split:     scored once at the end
          -> models/powerguard_bundle.joblib + reports/

live reading (6 features) -> predict.py -> bundle -> JSON (inputs / model_output / rule_based)
Arduino payload -> input_builder.py ----^
```

## The bundle (`models/powerguard_bundle.joblib`)
`detector` (calibrated pipeline), `threshold`, `diagnosis` (multilabel pipeline), `modes`, `background`
(100 training rows for SHAP), `training_ranges`, version info. Every model inside is a full pipeline, so raw
readings go straight in.

## Changing things
- Model candidates or grids: `ALGORITHMS` in `src/models.py`.
- Alert levels and actions: `src/maintenance.py` (no retraining needed).
- New header spellings or valid ranges: `COLUMN_ALIASES`, `VALID_RANGES` in `src/config.py`.
