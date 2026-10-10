# Plant data

`ai4i2020.xlsx` is the AI4I 2020 Predictive Maintenance Dataset (UCI Machine Learning Repository, CC BY 4.0): 10,000 rows of type, air temperature, process temperature, rotational speed, torque and tool wear, with labelled failures.

`prepare.py` turns it into the files the apps read:

- `web/src/data/ai4i.json`: every row, plus the tool life each turbine replays.
- `web/src/data/model.json`: a decision tree trained on 7,500 rows and scored on the other 2,500.

```
python -m venv .venv && .venv/bin/pip install openpyxl scikit-learn
.venv/bin/python data/prepare.py
```

How the plant uses it:

- GT-01 to GT-07 each replay one real tool life from the data, one row every 5 seconds. Failures happen exactly where the data records them.
- GT-03's tool life ends in an overstrain failure. The forecast sees tool wear times torque approaching the limit and raises a maintenance request before it happens.
- GT-08 reads the six features live from the sensor board when it is connected, and replays the data when it is not.
- Power demand and turbine output are modelled, since the dataset has no power-plant load.
