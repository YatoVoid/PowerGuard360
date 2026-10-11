# ML laptop

The sensor board sends GT-08's six readings to both the plant server and this laptop. This laptop forecasts where the readings are heading and posts the result to the plant server, which shows it on the website and the phone in place of the built-in decision tree.

## What to send

```
POST <SERVER_URL>/api/prediction
Authorization: Bearer <MODEL_TOKEN>
Content-Type: application/json

{
  "unit": "GT-08",
  "probability": 0.72,
  "mode": "HDF",
  "minutes_to_failure": 4,
  "detail": "Process and air temperature converging",
  "model": "Team ML"
}
```

| Field | Required | Meaning |
|---|---|---|
| `unit` | yes | Turbine the forecast is for, `GT-01` to `GT-08`. The board feeds `GT-08`. |
| `probability` | yes | Chance of failure, 0 to 1. At 0.5 or above the unit goes on watch and an engineer is requested. |
| `mode` | no | Expected failure: `TWF` tool wear, `HDF` heat dissipation, `PWF` power, `OSF` overstrain, `RNF` random. `null` if unknown. |
| `minutes_to_failure` | no | Minutes until the failure is expected. At 2 or less a preventive request is raised. |
| `detail` | no | One sentence shown to the manager, up to 160 characters. Without it the server writes one from the fields above. |
| `model` | no | Name shown next to the forecast, up to 40 characters. Defaults to "ML laptop". |

- Post after every reading you score, at least every 15 seconds. If nothing arrives for 15 seconds the server goes back to its own decision tree.
- A 200 means it was accepted. A 400 lists what was wrong with the body. A 401 means the token is wrong.
- `MODEL_TOKEN` is a different token from the sensor board's. Get it privately from Wali, never commit it.

## Example

```python
import requests

requests.post(
    f"{SERVER_URL}/api/prediction",
    headers={"Authorization": f"Bearer {MODEL_TOKEN}"},
    json={"unit": "GT-08", "probability": 0.72, "mode": "HDF", "minutes_to_failure": 4, "model": "Team ML"},
    timeout=3,
)
```
