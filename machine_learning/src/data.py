"""Load the dataset, build targets and make the train/test split."""
import pandas as pd
from sklearn.model_selection import train_test_split

from src.config import DATASET, FAILURE_COL, FAILURE_MODES, FEATURES, ID_COLS, SEED, TEST_SIZE


def load_dataset(path=DATASET):
    df = pd.read_excel(path) if str(path).endswith((".xlsx", ".xls")) else pd.read_csv(path)
    df = df.drop(columns=[c for c in ID_COLS if c in df])
    df = df.dropna(subset=[FAILURE_COL]).reset_index(drop=True)
    df[FAILURE_COL] = df[FAILURE_COL].astype(int)
    return df


def split(df):
    """80/20 split, stratified on Machine failure. The test part is not touched until final evaluation."""
    return train_test_split(df, test_size=TEST_SIZE, stratify=df[FAILURE_COL], random_state=SEED)


def features(df):
    """Only the six model inputs. Targets and IDs can never leak in."""
    return df[FEATURES].copy()


def mode_targets(df, modes=FAILURE_MODES):
    """Failure-mode labels (multilabel). A mode only counts on a row that actually failed."""
    return df[modes].astype(int).mul(df[FAILURE_COL], axis=0)


def labelset_key(Y, min_count):
    """One string per row describing its label combination, for stratified multilabel CV.
    Combinations rarer than `min_count` are pooled so every fold can contain them."""
    key = Y.astype(str).agg("".join, axis=1)
    key = key.where(key.map(key.value_counts()) >= min_count, "rare")
    if (key == "rare").sum() < min_count:  # pool still too small: fold it into the largest group
        key = key.replace("rare", key.value_counts().idxmax())
    return key
