# PowerGuard 360: model evaluation

All numbers below were produced by `python -m src.train` on the UCI AI4I 2020 dataset
(10,000 rows). Nothing is hand-entered. Raw values are in `metrics.json`; charts in `figures/`.

## 1. Method

**Inputs (both models):** Type, Air temperature [K], Process temperature [K], Rotational speed [rpm],
Torque [Nm], Tool wear [min]. UDI, Product ID, Machine failure and the five mode flags are never inputs.
Inside the pipeline three values are derived from the six inputs (process−air temperature gap,
mechanical power, tool wear × torque); callers still send only the six.

**Split:** 80% train (8,000 rows, 271 failures) / 20% test
(2,000 rows, 68 failures), stratified on Machine failure, `random_state=42`.
The test split was used once, after every choice below was fixed.

**Leakage control:** cleaning, imputation, scaling, one-hot encoding and class weights are pipeline steps,
so they are re-fit inside every training fold. Hyperparameters, model choice, calibration method and
decision threshold were all chosen from 5-fold stratified CV on the training split.

**Model 1 steps**
1. Six candidates: Logistic Regression (baseline), Random Forest, XGBoost, each unweighted and class-weighted.
   Small hyperparameter grid per candidate, 5-fold CV, best setting by PR-AUC.
2. Selection rule: highest mean CV PR-AUC → **Random Forest (unweighted)**.
3. Calibration: none / sigmoid / isotonic compared by out-of-fold Brier score on the training split →
   **sigmoid** (Brier: none 0.0075, sigmoid 0.0067, isotonic 0.0067).
4. Decision threshold: maximises failure-class F1 on out-of-fold training predictions → **0.614**.
5. Final model refit on the whole training split, then scored once on the test split.

## 2. What the metrics mean

| Metric | Plain meaning |
|---|---|
| Accuracy | Share of all readings classified correctly. Misleading here: always saying "no failure" scores ~96.6%. |
| Precision (failure) | Of the maintenance alerts raised, how many were real failures. Low precision = crews chasing false alarms. |
| Recall (failure) | Of the real failures, how many the model caught. Low recall = missed breakdowns. |
| F1 (failure) | One number balancing precision and recall (their harmonic mean). |
| Macro-F1 | Average of the F1 for "failure" and "no failure", so the rare class counts equally. |
| ROC-AUC | How well the risk score ranks failures above non-failures (1 = perfect, 0.5 = coin flip). Can look good even when alerts are mostly false, because non-failures dominate. |
| PR-AUC / Average Precision | Precision averaged over all recall levels. The most honest single score for rare failures; no-skill = failure rate (0.034). |
| Brier score | Mean squared error of the risk score as a probability (0 = perfect). Lower = the "% risk" on the dashboard is more trustworthy. |
| Reliability curve | Predicted risk vs. how often failures actually happened. On the diagonal = calibrated. With ~68 test failures, most mid-range bins hold 1-2 readings, so the curve is noisy there; Brier is the steadier number. |
| False positive / negative | False alert / missed failure. |

## 3. Model 1: failure detection

### Cross-validation comparison (training split, mean ± std over 5 folds; label metrics at 0.5)

| Model | Best params | PR-AUC | ROC-AUC | F1 | Precision | Recall | Macro-F1 | Accuracy | Brier | FP / fold | FN / fold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Logistic Regression (unweighted) | C=1 | 0.501 ± 0.031 | 0.914 ± 0.016 | 0.378 ± 0.048 | 0.774 ± 0.088 | 0.251 ± 0.035 | 0.682 ± 0.024 | 0.972 ± 0.002 | 0.0229 ± 0.0008 | 4.0 | 40.6 |
| Logistic Regression (weighted) | C=0.1 | 0.486 ± 0.026 | 0.916 ± 0.014 | 0.267 ± 0.013 | 0.159 ± 0.008 | 0.838 ± 0.046 | 0.590 ± 0.008 | 0.844 ± 0.009 | 0.1127 ± 0.0055 | 241.2 | 8.8 |
| **Random Forest (unweighted)** | max_depth=None, min_samples_leaf=3 | 0.902 ± 0.024 | 0.980 ± 0.012 | 0.883 ± 0.024 | 0.970 ± 0.022 | 0.812 ± 0.043 | 0.940 ± 0.012 | 0.993 ± 0.001 | 0.0075 ± 0.0011 | 1.4 | 10.2 |
| Random Forest (weighted) | max_depth=12, min_samples_leaf=1 | 0.891 ± 0.023 | 0.980 ± 0.013 | 0.836 ± 0.034 | 0.851 ± 0.052 | 0.823 ± 0.038 | 0.915 ± 0.017 | 0.989 ± 0.002 | 0.0113 ± 0.0010 | 8.0 | 9.6 |
| XGBoost (unweighted) | learning_rate=0.05, max_depth=3 | 0.880 ± 0.023 | 0.982 ± 0.011 | 0.854 ± 0.023 | 0.920 ± 0.030 | 0.797 ± 0.024 | 0.924 ± 0.012 | 0.991 ± 0.001 | 0.0085 ± 0.0009 | 3.8 | 11.0 |
| XGBoost (weighted) | learning_rate=0.05, max_depth=5 | 0.888 ± 0.021 | 0.978 ± 0.013 | 0.840 ± 0.018 | 0.856 ± 0.024 | 0.826 ± 0.035 | 0.917 ± 0.009 | 0.989 ± 0.001 | 0.0093 ± 0.0009 | 7.6 | 9.4 |

Weighted models push their probabilities up for the rare class, which raises recall at 0.5 but hurts
Brier; that is why the final model is calibrated and the threshold is tuned separately.

### Training-only estimate at the chosen threshold (out-of-fold, calibrated)
Precision 0.969, recall 0.815, F1 0.886,
7 false alerts and 50 missed failures over 8,000 training rows.

### Final test result (Random Forest (unweighted), sigmoid calibration, threshold 0.614)

| Metric | Test |
|---|---|
| Accuracy | 0.992 |
| Precision (failure) | 0.964 |
| Recall (failure) | 0.779 |
| F1 (failure) | 0.862 |
| Macro-F1 | 0.929 |
| ROC-AUC | 0.983 |
| PR-AUC | 0.899 |
| Brier (calibrated) | 0.0070 (uncalibrated: 0.0078) |

|  | Predicted no failure | Predicted failure |
|---|---|---|
| **Actual no failure** | 1930 | 2 (false alerts) |
| **Actual failure** | 15 (missed) | 53 |

In plain words: out of 68 real failures in the test set the model caught 53 and missed 15;
it raised 55 alerts, of which 2 were false.

## 4. Model 2: failure-type diagnosis

### Label investigation (full dataset)

- 339 failures. 24 of them carry more than one mode flag, so modes are
  **not mutually exclusive** → Model 2 is **multilabel** (one weighted binary classifier per mode).
- Mode flags on failed rows: TWF 46, HDF 115, PWF 95, OSF 98, RNF 1.
- Flags on rows that did **not** fail (dataset inconsistency, ignored): TWF 0, HDF 0, PWF 0, OSF 0, RNF 18.
- Positive training failures per mode: TWF 36, HDF 86, PWF 82, OSF 82, RNF 1.
  Modes with fewer than 10 are not modelled: **RNF**.

| Mode combination on failed rows | Count |
|---|---|
| HDF | 106 |
| PWF | 80 |
| OSF | 78 |
| TWF | 42 |
| PWF+OSF | 11 |
| (no mode flagged) | 9 |
| HDF+OSF | 6 |
| HDF+PWF | 3 |
| TWF+OSF | 2 |
| TWF+RNF | 1 |
| TWF+PWF+OSF | 1 |

**Training data:** training-split failures only (diagnosis is conditional on a failure, matching the two-stage design).
**Validation:** 5-fold CV stratified on label combination (rare combinations pooled). Mode threshold 0.5.

| Algorithm | Macro-F1 (CV) | Micro-F1 (CV) |
|---|---|---|
| Logistic Regression | 0.889 ± 0.015 | 0.903 ± 0.013 |
| **Random Forest** | 0.961 ± 0.027 | 0.973 ± 0.021 |
| XGBoost | 0.952 ± 0.014 | 0.967 ± 0.010 |

Selected: **Random Forest** (highest mean CV macro-F1).

### Standalone diagnosis (test failures only, true failure known)
| Label | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| TWF | 0.875 | 0.700 | 0.778 | 10 |
| HDF | 1.000 | 1.000 | 1.000 | 29 |
| PWF | 1.000 | 1.000 | 1.000 | 13 |
| OSF | 0.889 | 1.000 | 0.941 | 16 |
| micro avg | 0.956 | 0.956 | 0.956 | 68 |
| macro avg | 0.941 | 0.925 | 0.930 | 68 |

### Full two-stage pipeline (all 2,000 test rows: Model 1 at its threshold, then Model 2 on flagged rows)
| Label | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| TWF | 0.000 | 0.000 | 0.000 | 10 |
| HDF | 0.926 | 0.862 | 0.893 | 29 |
| PWF | 1.000 | 1.000 | 1.000 | 13 |
| OSF | 0.941 | 1.000 | 0.970 | 16 |
| micro avg | 0.931 | 0.794 | 0.857 | 68 |
| macro avg | 0.717 | 0.716 | 0.716 | 68 |

### RNF (random failure)
RNF appears on 1 failed row(s) in the whole dataset, so it cannot be trained as a
diagnosis label. As an extra check, a model was trained to predict the raw RNF flag on all training rows
(15 positives out of 8,000): CV ROC-AUC 0.546 ± 0.169,
PR-AUC 0.0039 vs. a no-skill level of 0.0019. This is consistent with RNF being
random with respect to the six inputs; the system makes no RNF predictions.

## 5. Explainability

- **SHAP** (exact, interventional, 100 training rows as background) is computed on the whole deployed pipeline,
  so contributions are attributed to the six inputs, in calibrated-risk units: baseline risk + contributions = predicted risk.
- **Permutation importance**: drop in test PR-AUC when one input is shuffled.

| Feature | Permutation importance (PR-AUC drop) | Mean abs SHAP |
|---|---|---|
| Torque [Nm] | 0.765 ± 0.007 | 0.1237 |
| Rotational speed [rpm] | 0.555 ± 0.020 | 0.0608 |
| Air temperature [K] | 0.414 ± 0.032 | 0.0538 |
| Tool wear [min] | 0.372 ± 0.033 | 0.0287 |
| Process temperature [K] | 0.200 ± 0.021 | 0.0270 |
| Type | 0.035 ± 0.016 | 0.0068 |

SHAP shows how the model uses an input, not physical cause and effect. Correlated inputs (air and process
temperature) can share or trade credit.

## 6. Robustness to messy sensor values (test split, reporting only)

Test inputs corrupted with missing values, text like "N/A", glitch values (-999), units in the text,
Celsius instead of Kelvin and renamed headers (`src/messy.py`):
F1 0.862 → 0.672, recall 0.779 → 0.647,
precision 0.964 → 0.698. Recoverable formats are repaired exactly (see tests);
the drop comes from values that are truly lost and get replaced by the training median.

## 7. Limitations

- **Small failure count.** 68 test failures: one more or one fewer catch moves recall by
  ~1.5 points. Treat test metrics as estimates with real uncertainty (see CV std).
- **Synthetic source data.** AI4I 2020 is a synthetic dataset modelled on a milling machine, with failure rules
  that are close to deterministic functions of the inputs. Scores here will not transfer to real Chevron turbines
  without retraining on real equipment data.
- **Weak modes in the full pipeline:** TWF (two-stage recall < 0.5). For TWF, the dataset
  triggers tool failure at a random tool-wear point between 200 and 240 min, so many identical-looking readings do not fail.
- **RNF is not predicted** (see above).
- **Hardware inputs.** Our Arduino sensors do not measure an industrial machine. Only the Grove temperature has an
  AI4I counterpart; any measured value outside the training range is flagged in the API response.
- **SHAP** explains the model, not the machine.
- The decision threshold balances precision and recall (max F1). If missed failures cost much more than false
  alerts, lower it and re-check the false-alert count.

## 8. Figures

| # | File |
|---|---|
| 1 | `figures/01_model_comparison.png` |
| 2 | `figures/02_confusion_matrix.png` |
| 3 | `figures/03_precision_recall_curve.png` |
| 4 | `figures/04_roc_curve.png` |
| 5 | `figures/05_feature_importance.png` |
| 6 | `figures/06_shap_summary.png` |
| 7 | `figures/07_shap_normal_example.png` |
| 8 | `figures/08_shap_failure_example.png` |
| 9 | `figures/09_calibration.png` |
| 10 | `figures/10_failure_type_results.png` |
