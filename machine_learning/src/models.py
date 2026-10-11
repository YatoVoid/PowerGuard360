"""Model definitions. Every model is a full pipeline: clean -> encode -> classifier."""
import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.multioutput import MultiOutputClassifier
from sklearn.pipeline import Pipeline
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

from src.config import SEED
from src.preprocessing import build_preprocessor


class Weighted(ClassifierMixin, BaseEstimator):
    """Wrap a classifier so class weighting is computed from whatever data it is fit on.

    Inside cross-validation that means each training fold only, so the weights never see
    validation or test rows. `balanced=False` trains the same model unweighted.
    """

    def __init__(self, estimator, balanced=True):
        self.estimator = estimator
        self.balanced = balanced

    def fit(self, X, y):
        weights = compute_sample_weight("balanced", y) if self.balanced else None
        self.estimator_ = clone(self.estimator).fit(X, y, sample_weight=weights)
        self.classes_ = self.estimator_.classes_
        return self

    def predict_proba(self, X):
        return self.estimator_.predict_proba(X)

    def predict(self, X):
        return self.classes_[np.argmax(self.predict_proba(X), axis=1)]


def pipeline(estimator, balanced):
    return Pipeline(build_preprocessor() + [("model", Weighted(estimator, balanced))])


ALGORITHMS = {
    "Logistic Regression": (
        LogisticRegression(max_iter=5000, random_state=SEED),
        {"model__estimator__C": [0.01, 0.1, 1, 10]},
    ),
    "Random Forest": (
        RandomForestClassifier(n_estimators=300, n_jobs=1, random_state=SEED),
        {"model__estimator__max_depth": [None, 12], "model__estimator__min_samples_leaf": [1, 3]},
    ),
    "XGBoost": (
        XGBClassifier(n_estimators=300, subsample=0.8, colsample_bytree=0.8, eval_metric="logloss",
                      n_jobs=1, random_state=SEED),
        {"model__estimator__max_depth": [3, 5], "model__estimator__learning_rate": [0.05, 0.1]},
    ),
}


def detector_candidates():
    """(name, pipeline, hyperparameter grid) for every algorithm, weighted and unweighted."""
    for algo, (estimator, grid) in ALGORITHMS.items():
        for balanced in (False, True):
            name = f"{algo} ({'weighted' if balanced else 'unweighted'})"
            yield name, pipeline(estimator, balanced), grid


def diagnosis_candidates():
    """Multilabel models: one class-weighted binary classifier per failure mode."""
    for algo, (estimator, _) in ALGORITHMS.items():
        yield algo, Pipeline(build_preprocessor() + [
            ("model", MultiOutputClassifier(Weighted(estimator, balanced=True))),
        ])
