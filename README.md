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

// One connection is opened once and reused for every post. Opening a new one each
// time takes the R4 seconds, and a failed connect can freeze the loop.
WiFiClient client;
unsigned long seq = 0;
float toolWearMin = 0;
unsigned long lastSend = 0;

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("Joining Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) delay(200);
}

bool ensureServer() {
  if (client.connected()) return true;
  client.stop();
  client.setConnectionTimeout(1500);
  return client.connect(SERVER_HOST, SERVER_PORT);
}

// Reads the whole reply so the next post on the same connection starts clean. Returns the status code.
int readReply() {
  unsigned long start = millis();
  int status = 0;
  long length = 0;
  while (millis() - start < 1500) {
    if (!client.available()) { delay(2); continue; }
    String line = client.readStringUntil('\n');
    if (status == 0 && line.startsWith("HTTP/1.1 ")) status = line.substring(9, 12).toInt();
    if (line.startsWith("Content-Length:") || line.startsWith("content-length:")) length = line.substring(15).toInt();
    if (line == "\r") break;
  }
  while (length > 0 && millis() - start < 1500) {
    if (client.available()) { client.read(); length--; } else delay(2);
  }
  return status;
}

void setup() {
  Serial.begin(115200);
  ensureWifi();
}

void loop() {
  if (millis() - lastSend < 500) return;
  lastSend = millis();

  // Replace with real sensor reads. Temperatures in kelvin (Celsius + 273.15).
  float airK = 25.0 + 273.15;
  float processK = 35.5 + 273.15;
  float rpm = 1480;
  float torqueNm = 43.2;
  toolWearMin += 0.5 / 60.0;

  String body = String("{\"device\":\"plant-sensor-1\",\"seq\":") + seq++ +
    ",\"uptime_ms\":" + millis() +
    ",\"readings\":{\"type\":\"M\"" +
    ",\"air_temp_k\":" + String(airK, 1) +
    ",\"process_temp_k\":" + String(processK, 1) +
    ",\"rpm\":" + String(rpm, 0) +
    ",\"torque_nm\":" + String(torqueNm, 1) +
    ",\"tool_wear_min\":" + String(toolWearMin, 0) + "}}";

  ensureWifi();
  if (!ensureServer()) { Serial.println("Server not reachable, will retry"); return; }

  client.print("POST /api/ingest HTTP/1.1\r\nHost: ");
  client.print(SERVER_HOST);
  client.print("\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nAuthorization: Bearer ");
  client.print(DEVICE_TOKEN);
  client.print("\r\nContent-Length: ");
  client.print(body.length());
  client.print("\r\n\r\n");
  client.print(body);

  int status = readReply();
  if (status != 200) {
    Serial.print("Reply "); Serial.print(status); Serial.print(" for "); Serial.println(body);
    client.stop();   // start a fresh connection next time
  }
}
```

Open Serial Monitor at 115200 baud: it stays quiet while posts succeed and prints the reply code and the body when one fails (401 wrong token, 400 bad body, 0 no reply). If the ML laptop needs the readings too, give it its own `WiFiClient` and repeat the post to its address.

To see exactly what the board sends, start the server with `LOG_INGEST=1 npx tsx --env-file=.env src/server.ts`. Every post is printed, and rejected ones say which field was wrong.

The board doesn't have to send all six readings. Whatever it sends drives GT-08 live (marked "Live" on the website); anything it leaves out keeps replaying from the dataset.

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
