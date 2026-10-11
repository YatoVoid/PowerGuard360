"""Paths, feature names, label rules and settings shared by every module."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "dataset" / "Predicive_Maintenance_Dataset.xlsx"
MODELS = ROOT / "models"
BUNDLE_PATH = MODELS / "powerguard_bundle.joblib"
REPORTS = ROOT / "reports"
FIGURES = REPORTS / "figures"

SEED = 42
TEST_SIZE = 0.2
CV_FOLDS = 5

# ---- Prediction interface: exactly these six AI4I inputs, under their dataset names ----
FEATURES = [
    "Type",
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]

# Internal clean names used inside the pipeline
TYPE_COL = "type"
SENSOR_COLS = ["air_temp_k", "process_temp_k", "rotational_speed_rpm", "torque_nm", "tool_wear_min"]
FEATURE_TO_CLEAN = dict(zip(FEATURES, [TYPE_COL] + SENSOR_COLS))
# Derived inside the pipeline from the six inputs (never supplied by the caller)
ENGINEERED_COLS = ["temp_diff_k", "power_w", "wear_x_torque"]
NUMERIC_COLS = SENSOR_COLS + ENGINEERED_COLS

# Raw header (lower-cased, units and punctuation stripped) -> clean name, for messy batch feeds
COLUMN_ALIASES = {
    "type": TYPE_COL, "product_type": TYPE_COL, "quality": TYPE_COL,
    "air_temperature": "air_temp_k", "air_temp": "air_temp_k", "ambient_temp": "air_temp_k",
    "process_temperature": "process_temp_k", "process_temp": "process_temp_k",
    "rotational_speed": "rotational_speed_rpm", "speed": "rotational_speed_rpm", "rpm": "rotational_speed_rpm",
    "torque": "torque_nm",
    "tool_wear": "tool_wear_min", "wear": "tool_wear_min",
}

# Physically plausible ranges. Anything outside is a sensor glitch and becomes missing.
VALID_RANGES = {
    "air_temp_k": (250, 350),
    "process_temp_k": (250, 375),
    "rotational_speed_rpm": (1, 5000),
    "torque_nm": (0, 150),
    "tool_wear_min": (0, 400),
}
# Temperature readings in this range are taken to be Celsius and converted to Kelvin
CELSIUS_RANGE = (-60, 150)
VALID_TYPES = {"L": "L", "LOW": "L", "M": "M", "MEDIUM": "M", "H": "H", "HIGH": "H"}

# ---- Targets ----
ID_COLS = ["UDI", "Product ID"]
FAILURE_COL = "Machine failure"
FAILURE_MODES = ["TWF", "HDF", "PWF", "OSF", "RNF"]
# A failure mode needs at least this many positive training failures to be modelled
MIN_MODE_POSITIVES = 10

FAILURE_NAMES = {
    "TWF": "Tool wear failure",
    "HDF": "Heat dissipation failure",
    "PWF": "Power failure",
    "OSF": "Overstrain failure",
    "RNF": "Random failure",
}

# Probability at or above which the diagnosis model reports a failure mode
MODE_THRESHOLD = 0.5

# ---- Input sources (every input value is labelled with one of these) ----
INPUT_SOURCES = {"measured", "simulated", "dataset_replay", "manual", "unspecified"}

# Calibration: isotonic only wins if its out-of-fold Brier is at least this much (relative) better
# than the best smooth option. Isotonic outputs a few flat steps (e.g. exactly 1.0), which ties
# rankings and overstates certainty on a dashboard; a marginal Brier gain doesn't justify that.
ISOTONIC_MIN_GAIN = 0.05
