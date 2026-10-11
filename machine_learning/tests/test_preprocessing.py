import numpy as np
import pandas as pd
import pytest

from src.config import NUMERIC_COLS, SENSOR_COLS, TYPE_COL
from src.data import labelset_key, mode_targets
from src.preprocessing import SensorCleaner, normalize_header, to_number

CLEAN = pd.DataFrame({
    "Type": ["L", "M", "H"],
    "Air temperature [K]": [298.1, 300.0, 302.5],
    "Process temperature [K]": [308.6, 310.2, 311.9],
    "Rotational speed [rpm]": [1551, 1408, 2100],
    "Torque [Nm]": [42.8, 46.3, 25.0],
    "Tool wear [min]": [0, 120, 230],
})


def fitted():
    return SensorCleaner().fit(CLEAN)


def test_headers_with_units_and_case_map_to_clean_names():
    assert normalize_header(" Rotational speed [rpm] ") == "rotational_speed"
    assert normalize_header("TORQUE (Nm)") == "torque"


def test_text_numbers_are_parsed_and_garbage_becomes_missing():
    values = to_number(pd.Series(["1,551 rpm", " 42.8Nm", "N/A", "", "error", "inf", 7]))
    assert values.tolist()[:2] == [1551, 42.8]
    assert values.iloc[2:6].isna().all()
    assert values.iloc[6] == 7


def test_recoverable_mess_gives_identical_output():
    messy = pd.DataFrame({
        " TYPE ": [" low", "Medium ", "h"],
        "air temperature": ["24.95 C", 300.0, "302.5 K"],          # Celsius and units
        "Process Temp": [35.45, "310.2", 311.9],                   # Celsius as a number
        "rpm": ["1,551", 1408, "2100 rpm"],
        "Torque [Nm]": ["42.8", 46.3, 25.0],
        "wear": [0, "120 min", 230],
    })
    pd.testing.assert_frame_equal(fitted().transform(messy), fitted().transform(CLEAN), atol=1e-6)


def test_glitches_and_missing_columns_are_filled_with_training_medians():
    cleaner = fitted()
    bad = pd.DataFrame({"Type": ["??"], "Air temperature [K]": [-999], "Torque [Nm]": [99999]})
    out = cleaner.transform(bad)
    assert not out[NUMERIC_COLS].isna().any().any()
    assert out.loc[0, "air_temp_k"] == cleaner.medians_["air_temp_k"]
    assert out.loc[0, "torque_nm"] == cleaner.medians_["torque_nm"]
    assert out.loc[0, TYPE_COL] == cleaner.type_mode_


def test_engineered_features():
    out = fitted().transform(CLEAN)
    assert out.loc[0, "temp_diff_k"] == pytest.approx(10.5)
    assert out.loc[0, "power_w"] == pytest.approx(42.8 * 1551 * 2 * np.pi / 60)
    assert set(SENSOR_COLS) <= set(out.columns)


def test_mode_targets_are_multilabel_and_only_count_real_failures():
    rows = pd.DataFrame({
        "Machine failure": [0, 1, 1, 1, 0],
        "TWF": [0, 1, 0, 0, 0], "HDF": [0, 0, 1, 0, 0], "PWF": [0, 0, 1, 0, 0],
        "OSF": [0, 0, 0, 0, 0], "RNF": [0, 0, 0, 0, 1],
    })
    Y = mode_targets(rows)
    assert Y.loc[2, ["HDF", "PWF"]].tolist() == [1, 1]  # two modes at once are both kept
    assert Y.loc[3].sum() == 0                          # failed, no mode flagged
    assert Y.loc[4, "RNF"] == 0                         # flag on a row that did not fail is ignored


def test_rare_label_combinations_are_pooled_for_cv():
    Y = pd.DataFrame({"A": [1] * 6 + [0] * 6 + [1, 1], "B": [0] * 6 + [1] * 6 + [1, 1]})
    key = labelset_key(Y, min_count=5)
    assert key.value_counts().min() >= 5
