# Firmware (Anthony, cptnomar)

Read the sensors on the ESP32 and POST them to the server once a second.

## What to send
The board is GT-08's sensor package. The other seven turbines replay the AI4I 2020 dataset, so GT-08 sends the same six features in the same units:

| Field | Unit | Typical range in the data | Suggested sensor |
|---|---|---|---|
| `type` | L, M or H | quality grade, fixed per machine | set in firmware |
| `air_temp_k` | kelvin | 295 to 305 | ambient temperature sensor (°C + 273.15) |
| `process_temp_k` | kelvin | 305 to 314 | probe on the motor or a second temperature sensor |
| `rpm` | rpm | 1,170 to 2,890 | Hall sensor or IR tachometer on the spinning part |
| `torque_nm` | newton metres | 4 to 77 | motor current mapped to torque |
| `tool_wear_min` | minutes | 0 to 250 | minutes the "tool" has run since its last change |

```
POST <SERVER_URL>/api/ingest
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json

{
  "device": "plant-sensor-1",
  "seq": 1042,
  "uptime_ms": 1042331,
  "readings": {
    "type": "M",
    "air_temp_k": 299.1,
    "process_temp_k": 309.6,
    "rpm": 1480,
    "torque_nm": 43.2,
    "tool_wear_min": 12
  }
}
```

- Send once a second. `seq` goes up by one every send.
- Leave a reading out if the sensor fails. Never send 0 or -1 as a fake value.
- GT-08 trips on the dataset's own failure rules, so you can demo each one live:
  - Overstrain: tool wear × torque above 11,000 (type L), 12,000 (M) or 13,000 (H).
  - Heat dissipation: process minus air temperature below 8.6 K while speed is under 1,380 rpm.
  - Power: torque × speed (rad/s) outside 3,500 to 9,000 W.
- The server rejects readings outside the physical ranges in `server/src/protocol.ts`.

## Secrets
Wi-Fi password, `SERVER_URL` and `DEVICE_TOKEN` go in `secrets.h`, which git ignores. Commit `secrets.example.h` with blank values instead.

## Until the server is up
Print the JSON to Serial Monitor at 115200 baud, one line per reading. The laptop can forward that line over USB if the venue Wi-Fi blocks the board, so keep the serial output in the same JSON even after POST works.

## Branch
Anthony works on `anthony/firmware`, cptnomar on `cptnomar/firmware`. Only touch this folder.
