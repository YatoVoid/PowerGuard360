# Firmware (Anthony, cptnomar)

Read the sensors on the ESP32 and POST them to the server once a second.

## Sensors
The board is GT-08's sensor package. The other seven turbines run on simulated sensors.

| Sensor | Field | What it means for GT-08 |
|---|---|---|
| Barometer | `pressure_hpa`, `temperature_c` | Inlet air. Lower pressure or hotter air cuts GT-08's capacity |
| Air quality | `air_quality_raw` | Emissions near the stack |
| Light | `light_raw` | Flame detector. Below 300 the unit trips, so covering it is the live demo |

## Send format

```
POST <SERVER_URL>/api/ingest
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json

{
  "device": "plant-sensor-1",
  "seq": 1042,
  "uptime_ms": 1042331,
  "readings": {
    "air_quality_raw": 312,
    "pressure_hpa": 1012.4,
    "temperature_c": 23.8,
    "light_raw": 2870
  }
}
```

- `seq` goes up by one every send, so the server can spot dropped packets.
- No timestamp needed. The server stamps it.
- Leave a reading out if the sensor fails to read. Don't send 0 or -1 as a fake value.
- Raw values are fine. Calibration happens on the server.
- If you add or rename a field, tell Wali first. The server and both apps read this exact shape.

## Secrets
Wi-Fi password, `SERVER_URL` and `DEVICE_TOKEN` go in `secrets.h`, which git ignores. Commit `secrets.example.h` with blank values instead.

## Until the server is up
Print the JSON to Serial Monitor at 115200 baud, one line per reading. The laptop can forward that line over USB if the venue Wi-Fi blocks the board, so keep the serial output in the same JSON even after POST works.

## Branch
Anthony works on `anthony/firmware`, cptnomar on `cptnomar/firmware`. Only touch this folder.
