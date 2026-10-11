# Power Guard 360

Catches gas turbine failures in sensor data before or as they happen, and sends a maintenance engineer to fix them. The plant manager works from the website (3D plant, dashboard, maintenance board, Gemini copilot). The engineer gets the job on an Android app, walks to the asset with GPS and does the repair. Both stay in sync through the plant server.

| Folder | What it is |
|---|---|
| `web/` | Website (Vite, React, three.js). Also holds the plant engine in `web/src/sim/` that the server and app share. |
| `server/` | Plant server: runs the plant, takes sensor readings and ML forecasts, pushes live state to every screen. |
| `mobile/` | Engineer app (Expo, Android). |
| `ml/` | What the ML laptop sends to the server. |
| `firmware/` | What the sensor board sends to the server, and the board simulator. |
| `data/` | AI4I 2020 dataset and the script that trains the decision tree. |

## Running the demo

One laptop hosts everything. Everyone joins the same phone hotspot, which also gives internet for the copilot and avoids venue Wi-Fi.

```
                 Phone hotspot (internet for Gemini)
        ┌──────────────────┬──────────────────┬───────────────────┐
        │                  │                  │                   │
  HOST LAPTOP           ML LAPTOP        ENGINEER PHONE       JUDGE / extra screen
  plant server :8787    reads sensor     Expo app             browser
  website      :5180    data, sends      (USB to host, or     http://<host-ip>:5180
  board sim             predictions      Wi-Fi to :8787)
```

### 1. Host laptop

Join the hotspot and find the laptop's address:

```
ip -4 addr | grep inet
```

If a firewall is on, open the ports:

```
sudo ufw allow 8787/tcp
sudo ufw allow 5180/tcp
```

Start each in its own terminal:

```
cd server && npx tsx --env-file=.env src/server.ts     # plant server, port 8787
cd web && npx vite --host --port 5180                  # website
cd server && npm run board -- HDF                      # sensor board simulator
```

`server/.env` holds `DEVICE_TOKEN`, `MODEL_TOKEN` and `GEMINI_API_KEY`. It is not in git; get it from Wali.

The board simulator sends real AI4I rows once a second in the board's format. `npm run board` gives steady readings; `-- HDF`, `-- OSF`, `-- PWF` or `-- TWF` runs 40 seconds into a recorded failure. To also send each reading to the ML laptop:

```
ML_URL=http://<ml-ip>:<port>/<path> npm run board -- HDF
```

### 2. Website

- On the host: http://localhost:5180
- Any device on the hotspot: `http://<host-ip>:5180`

The top bar shows "Live: plant server" once it is connected.

### 3. Engineer phone

USB (most reliable):

```
cd mobile && npx expo start --lan
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
```

Then open the app in Expo Go.

Wi-Fi only:

```
cd mobile && EXPO_PUBLIC_WS_URL=ws://<host-ip>:8787/ws npx expo start --lan
```

Scan the QR code in Expo Go. The phone giving the hotspot can be the engineer phone too.

### 4. ML laptop

Sends forecasts to `http://<host-ip>:8787/api/prediction` with `MODEL_TOKEN`. Format in `ml/README.md`.

### 5. Sensor board (Arduino / ESP32)

The board joins the same hotspot and POSTs GT-08's six readings to the host once a second. Use it in place of `npm run board`.

```
POST http://<host-ip>:8787/api/ingest
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json

{"device":"plant-sensor-1","seq":1042,"uptime_ms":1042331,
 "readings":{"type":"M","air_temp_k":299.1,"process_temp_k":309.6,"rpm":1480,"torque_nm":43.2,"tool_wear_min":12}}
```

- `seq` goes up by one each send. Leave out a reading if its sensor fails; never send 0 or -1 as a fake value.
- Units and ranges for each field are in `firmware/README.md`. Out-of-range readings get a 400.
- 200 means accepted, 401 means the token is wrong.

Check the server takes readings before flashing the board:

```
curl -X POST http://<host-ip>:8787/api/ingest \
  -H "Authorization: Bearer <DEVICE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"device":"test","seq":1,"uptime_ms":1,"readings":{"type":"M","air_temp_k":299.1,"process_temp_k":309.6,"rpm":1480,"torque_nm":43.2,"tool_wear_min":12}}'
```

ESP32 sketch (Arduino IDE, ESP32 board package). Put the Wi-Fi details, server address and token in `secrets.h`, which git ignores:

```cpp
// secrets.h
#define WIFI_SSID   "hotspot-name"
#define WIFI_PASS   "hotspot-password"
#define SERVER_URL  "http://<host-ip>:8787/api/ingest"
#define DEVICE_TOKEN "<DEVICE_TOKEN>"
```

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h"

uint32_t seq = 0;
float toolWearMin = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
}

void loop() {
  // Replace with real sensor reads.
  float airK = 25.0 + 273.15;
  float processK = 35.5 + 273.15;
  float rpm = 1480;
  float torqueNm = 43.2;
  toolWearMin += 1.0 / 60.0;

  char body[256];
  snprintf(body, sizeof body,
    "{\"device\":\"plant-sensor-1\",\"seq\":%lu,\"uptime_ms\":%lu,"
    "\"readings\":{\"type\":\"M\",\"air_temp_k\":%.1f,\"process_temp_k\":%.1f,"
    "\"rpm\":%.0f,\"torque_nm\":%.1f,\"tool_wear_min\":%.0f}}",
    (unsigned long)seq++, (unsigned long)millis(), airK, processK, rpm, torqueNm, toolWearMin);
  Serial.println(body);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.setTimeout(2000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
    int code = http.POST(body);
    if (code != 200) Serial.printf("server replied %d\n", code);
    http.end();
  } else {
    WiFi.reconnect();
  }
  delay(1000);
}
```

If the ML laptop needs the readings too, add a second `http.begin(...)` / `POST` to its address in the same loop.

When it works, GT-08 shows "Live sensor" on the website within a second, and it trips on the dataset's own failure rules (see `firmware/README.md`).

### Before judging

- Plug in the host laptop and the hotspot phone. A hotspot drains a battery fast.
- The host's address can change if the hotspot restarts. Check `ip -4 addr` again and update the Wi-Fi phone.
- Do one full run: board simulator, GT-08 alert on the phone, Accept, walk, website updates, repair.
- Backup: the Vercel link runs a local simulation when no server is reachable, so the 3D plant and dashboard still work without the hotspot.

### Showing it to someone off the hotspot

```
cloudflared tunnel --url http://localhost:8787
```

Open the website with `?ws=wss://<tunnel-host>/ws` added to the address. The tunnel address changes every run.

## Tests

```
cd web && npx vitest run && npx tsc -b
cd server && npx vitest run && npx tsc --noEmit
cd mobile && npx tsc --noEmit
```
