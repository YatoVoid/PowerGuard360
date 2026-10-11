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

### 5. Sensor board (Arduino UNO R4 WiFi)

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

Sketch for the **Arduino UNO R4 WiFi** (the R4 Minima has no Wi-Fi). In the Arduino IDE install the "Arduino UNO R4 Boards" package; `WiFiS3` comes with it, so no extra libraries are needed. Keep the sketch in `firmware/` and put the Wi-Fi details, the host address and the token in `secrets.h` next to it; git ignores `secrets.h` in that folder:

```cpp
// secrets.h
#define WIFI_SSID    "hotspot-name"
#define WIFI_PASS    "hotspot-password"
#define SERVER_HOST  "192.168.x.x"   // host laptop, from ip -4 addr
#define SERVER_PORT  8787
#define DEVICE_TOKEN "<DEVICE_TOKEN>"
```

```cpp
#include <WiFiS3.h>
#include "secrets.h"

unsigned long seq = 0;
float toolWearMin = 0;

void connectWifi() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.println("Joining Wi-Fi...");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    delay(3000);
  }
  Serial.print("Connected, board IP ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);
  connectWifi();
}

void loop() {
  // Replace with real sensor reads. Temperatures go in kelvin (Celsius + 273.15).
  float airK = 25.0 + 273.15;
  float processK = 35.5 + 273.15;
  float rpm = 1480;
  float torqueNm = 43.2;
  toolWearMin += 1.0 / 60.0;

  String body = String("{\"device\":\"plant-sensor-1\",\"seq\":") + seq++ +
    ",\"uptime_ms\":" + millis() +
    ",\"readings\":{\"type\":\"M\"" +
    ",\"air_temp_k\":" + String(airK, 1) +
    ",\"process_temp_k\":" + String(processK, 1) +
    ",\"rpm\":" + String(rpm, 0) +
    ",\"torque_nm\":" + String(torqueNm, 1) +
    ",\"tool_wear_min\":" + String(toolWearMin, 0) + "}}";
  Serial.println(body);

  if (WiFi.status() != WL_CONNECTED) connectWifi();

  WiFiClient client;
  client.setConnectionTimeout(2000);
  if (client.connect(SERVER_HOST, SERVER_PORT)) {
    client.println("POST /api/ingest HTTP/1.1");
    client.print("Host: "); client.println(SERVER_HOST);
    client.println("Content-Type: application/json");
    client.print("Authorization: Bearer "); client.println(DEVICE_TOKEN);
    client.print("Content-Length: "); client.println(body.length());
    client.println("Connection: close");
    client.println();
    client.print(body);

    // First line of the reply, e.g. "HTTP/1.1 200 OK". 401 means a wrong token, 400 a reading out of range.
    unsigned long start = millis();
    while (!client.available() && millis() - start < 2000) delay(10);
    if (client.available()) Serial.println(client.readStringUntil('\n'));
    client.stop();
  } else {
    Serial.println("Can't reach the server. Check SERVER_HOST and that the server is running.");
  }

  delay(1000);
}
```

Open Serial Monitor at 115200 baud: each second it prints the JSON and `HTTP/1.1 200 OK`. If the ML laptop needs the readings too, repeat the `client.connect(...)` block with its address and path.

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
