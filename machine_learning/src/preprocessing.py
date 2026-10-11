"""Cleaning for messy, real-world sensor readings.

`SensorCleaner` is the first step of every model pipeline, so the exact same
cleaning runs inside each CV fold, at final training and on every live prediction.
It handles:

- headers with different spellings, units or casing ("Torque [Nm]", "torque", "TORQUE ")
- numbers sent as text, with units or thousands separators ("1,551 rpm", " 42.8Nm")
- garbage values ("N/A", "error", "", inf)
- temperatures sent in Celsius instead of Kelvin
- readings outside physical limits (sensor glitches like -999 or 99999)
- missing readings (filled with the median learned on the training fold)
- product type written as "low", " m ", "High", or unknown

After cleaning it adds three features derived from the six inputs, matching how
these machines fail. They live inside the pipeline; callers only ever send the six inputs.
"""
import re

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from src.config import (
    CELSIUS_RANGE, COLUMN_ALIASES, NUMERIC_COLS, SENSOR_COLS, TYPE_COL, VALID_RANGES, VALID_TYPES,
)

_NUMBER = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


def normalize_header(name):
    """'Rotational speed [rpm]' -> 'rotational_speed'."""
    name = re.sub(r"[\[\(].*?[\]\)]", "", str(name).lower())
    return re.sub(r"[^a-z0-9]+", "_", name).strip("_")


def to_number(values):
    """Pull the first number out of each value; anything unreadable becomes NaN."""
    if pd.api.types.is_numeric_dtype(values):
        out = values.astype(float)
    else:
        text = values.astype("string").str.replace(",", "", regex=False)
        out = pd.to_numeric(text.str.extract(f"({_NUMBER.pattern})", expand=False), errors="coerce")
    return out.astype("float64").replace([np.inf, -np.inf], np.nan)


def clean_type(values):
    return values.astype("string").str.strip().str.upper().map(VALID_TYPES)


def clean_raw(X):
    """Parse and validate readings without filling gaps. Unusable values come back as NaN."""
    X = pd.DataFrame(X).copy()
    X.columns = [COLUMN_ALIASES.get(normalize_header(c), normalize_header(c)) for c in X.columns]
    X = X.loc[:, ~X.columns.duplicated()]

    out = pd.DataFrame(index=X.index)
    for col in SENSOR_COLS:
        out[col] = to_number(X[col]) if col in X else np.nan

    for col in ("air_temp_k", "process_temp_k"):
        is_celsius = out[col].between(*CELSIUS_RANGE)
        out.loc[is_celsius, col] += 273.15

    for col, (low, high) in VALID_RANGES.items():
        out.loc[~out[col].between(low, high), col] = np.nan

    out[TYPE_COL] = clean_type(X[TYPE_COL]) if TYPE_COL in X else pd.NA
    return out


class SensorCleaner(BaseEstimator, TransformerMixin):
    """Turn raw readings into clean, complete model inputs. Learns fill values on fit."""

    def fit(self, X, y=None):
        clean = clean_raw(X)
        self.medians_ = clean[SENSOR_COLS].median()
        self.type_mode_ = clean[TYPE_COL].mode().iloc[0]
        return self

    def transform(self, X):
        clean = clean_raw(X)
        clean[SENSOR_COLS] = clean[SENSOR_COLS].fillna(self.medians_)
        clean[TYPE_COL] = clean[TYPE_COL].fillna(self.type_mode_)
        return add_features(clean)


def add_features(df):
    """Features tied to the failure mechanisms in this kind of equipment."""
    df = df.copy()
    df["temp_diff_k"] = df["process_temp_k"] - df["air_temp_k"]  # heat dissipation
    df["power_w"] = df["torque_nm"] * df["rotational_speed_rpm"] * 2 * np.pi / 60  # power failure
    df["wear_x_torque"] = df["tool_wear_min"] * df["torque_nm"]  # overstrain
    return df


def build_preprocessor():
    """Clean, then scale numbers and one-hot the product type."""
    encode = ColumnTransformer([
        ("num", StandardScaler(), NUMERIC_COLS),
        ("type", OneHotEncoder(handle_unknown="ignore"), [TYPE_COL]),
    ])
    return [("clean", SensorCleaner()), ("encode", encode)]
