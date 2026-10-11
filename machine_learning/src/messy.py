"""Make clean readings look like a messy live sensor feed, to test the preprocessing."""
import numpy as np
import pandas as pd

from src.config import SEED


def make_messy(df, rate=0.05, seed=SEED):
    """Corrupt roughly `rate` of the values in each way a real feed goes wrong."""
    rng = np.random.default_rng(seed)
    out = df.copy().astype(object)
    out.columns = [f" {c.upper()} " for c in df.columns]  # header spelling drifts too

    def pick():
        return rng.random(len(out)) < rate

    for col, orig in zip(out.columns, df.columns):
        if orig.lower() == "type":
            out.loc[pick(), col] = out.loc[:, col].map({"L": " low", "M": "Medium ", "H": "h"})
            out.loc[pick(), col] = None
            continue
        out.loc[pick(), col] = np.nan                                       # dropped reading
        out.loc[pick(), col] = rng.choice(["N/A", "error", "", "--"])        # garbage text
        out.loc[pick(), col] = rng.choice([-999, 99999])                    # glitch value
        units = pick()
        out.loc[units, col] = [f"{v} units" for v in out.loc[units, col]]   # number with units
        if "temperature" in orig.lower():
            celsius = pick() & pd.to_numeric(out[col], errors="coerce").between(250, 350)
            out.loc[celsius, col] = pd.to_numeric(out.loc[celsius, col]) - 273.15  # sent in Celsius
    return out
