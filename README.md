# Power Guard 360

Predictive maintenance for a gas turbine plant. A machine learning model watches every turbine's sensor data and tells the plant manager when a unit needs maintenance and why: the likely failure, the readings behind it and what to check. The manager declines it or requests maintenance with their own notes for the engineer, then dispatches someone. Nothing reaches an engineer until the manager does. The engineer gets the job on an Android app, walks to the asset by shaking the phone, and does the repair. Turbines don't actually fail in the demo; the recorded failures in the dataset are what the model has to see coming. Website and app stay in sync through the plant server.

Two Random Forest models score every turbine once a second: one detects failures (calibrated risk, 78% recall at 96% precision on 2,000 unseen rows), the other names the failure type (heat dissipation, power, overstrain, tool wear). When the first one flags a unit, the maintenance board shows a recommendation with the risk, the possible failures, the three inputs that moved the risk most (SHAP) and the model's suggested check, prefilled as the manager's note.

| Folder | What it is |
|---|---|
| `web/` | Website (Vite, React, three.js). Also holds the plant engine in `web/src/sim/` that the server and app share. |
| `server/` | Plant server: runs the plant, takes sensor readings, asks the ML service for forecasts, pushes live state to every screen. |
| `machine_learning/` | Failure detection and failure-type models, training pipeline, evaluation report, and the FastAPI service (`api.py`) the plant server calls. |
| `mobile/` | Engineer app (Expo, Android). |
| `ml/` | What an external ML laptop can post to the server (optional). |
| `firmware/` | What the sensor board sends to the server, and the board simulator. |
| `data/` | AI4I 2020 dataset and the script that trains the fallback decision tree. |

## Running the demo

One laptop hosts everything. Everyone joins the same phone hotspot, which also gives internet for the copilot and avoids venue Wi-Fi.

```
                 Phone hotspot (internet for Gemini)
        ┌──────────────────┬──────────────────┬───────────────────┐
        │                  │                  │                   │
  HOST LAPTOP           ML LAPTOP        ENGINEER PHONE       JUDGE / extra screen
  plant server :8787    (optional)       Expo app             browser
  ML service   :8790    posts its own    (USB to host, or     http://<host-ip>:5180
  website      :5180    forecasts        Wi-Fi to :8787)
  board sim
```

Quick start on the host laptop, once `server/.env` is in place:

```
./deploy.sh            # opens the firewall ports, starts the ML service, plant server and website, forwards the USB phone, then runs Expo
./deploy.sh --no-ml    # same without the ML service
```

Ctrl+C stops everything. Logs are in `.logs/`. The steps below are what it does, for running pieces by hand.

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

One-time setup of the ML service (Python 3.11 or newer):

```
cd machine_learning && python3 -m venv .venv && .venv/bin/pip install -r requirements-api.txt
```

Start each in its own terminal, the ML service first:

```
cd machine_learning && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8790 --no-access-log   # ML service
cd server && npx tsx --env-file=.env src/server.ts     # plant server, port 8787
cd web && npx vite --host --port 5180                  # website
cd server && npm run board -- HDF                      # sensor board simulator
```

`server/.env` holds `DEVICE_TOKEN`, `MODEL_TOKEN` and `GEMINI_API_KEY`. It is not in git; get it from Wali.

The plant server prints `[ml] scoring every turbine with Random Forest` once it reaches the ML service. Every second it sends each running turbine's six readings to `machine_learning/api.py`, which answers with Model 1's failure risk, Model 2's failure type, the three inputs that moved the risk most (SHAP) and the maintenance action. The website and phone label those forecasts "Random Forest". A unit the model flags gets one recommendation, which stays on the board until the manager requests or declines it; a declined unit stays quiet for 3 minutes, a repaired one for 2. If the ML service stops, the server goes back to the built-in decision tree after 15 seconds. `ML_SERVICE_URL` changes the address; `ML_SERVICE_URL=off` skips it.

For the demo, use `-- PWF` or `-- OSF`: the model flags every recorded power and overstrain failure. The `-- HDF` row is one of the 5 heat failures out of 115 it misses (46% risk), and it misses most tool wear failures (see `machine_learning/README.md`).

The board simulator sends real AI4I rows once a second in the board's format. `npm run board` gives steady readings with clean air at gas metering; `-- GAS` drops the air quality 20 s in to show a leak; `-- HDF`, `-- OSF`, `-- PWF` or `-- TWF` plays 40 rows leading into a recorded failure, which the model should flag as a recommendation for GT-08. To also send each reading to the ML laptop:

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

Optional now that the ML service runs on the host. A laptop that posts to `http://<host-ip>:8787/api/prediction` with `MODEL_TOKEN` overrides the ML service for its unit while it keeps posting. Format in `ml/README.md`.

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
// CodeRED Orion - plant sensor node (Arduino UNO R4 WiFi + Grove Base Shield at 5V)
//   I2C -> Grove Barometer (SPA06-003): air temperature
//   A2  <- R280 motor spun by hand (generator): lead 1 -> 10k -> A2 (Grove yellow), lead 2 -> GND (black)
//   A3  <- torque (HAS_TORQUE 1): lead 1 -> load switch -> 10 ohm -> GND; top of the 10 ohm -> 10k -> A3 (white)
//   A0  <- Grove Air Quality Sensor v1.3 at the gas metering skid (higher reading = more gas or fumes)
//
// Every 500 ms prints this line and POSTs it to http://SERVER_HOST:SERVER_PORT/api/ingest:
//   {"device":"plant-sensor-1","seq":42,"uptime_ms":42013,"readings":{"type":"M","air_temp_k":298.6,
//    "process_temp_k":308.9,"rpm":1480,"torque_nm":43.2,"tool_wear_min":12,"air_quality_raw":1610}}
// air_quality_raw is left out for the first 20 s while the sensor's heater warms up.
// Libraries: "Seeed Arduino SPA06". WiFi and server details: secrets.h.

#include <Wire.h>
#include <WiFiS3.h>
#include <SPL07-003.h>
#include "secrets.h"

#define HAS_TORQUE 0  // 0 = torque from rpm (dataset physics), 1 = measured with the load circuit on A3

const unsigned long SEND_MS = 500;
const unsigned long SAMPLE_MS = 20;          // rpm is averaged over each 500 ms window
const unsigned long RETRY_PAUSE_MS = 3000;   // after a failed connect, skip posting this long
const unsigned long WIFI_RETRY_MS = 30000;   // rejoining blocks briefly, so not every loop

// Hand-spun R280 as a generator: its voltage is proportional to speed.
const uint8_t PIN_GEN = A2;
const uint8_t PIN_LOAD = A3;
const uint8_t PIN_AIR = A0;
const unsigned long AIR_WARMUP_MS = 20000;   // the air quality sensor reads high until its heater settles
const float ADC_TO_V = 5.0f / 16383.0f;      // 14-bit ADC, 5 V reference
const float RPM_PER_VOLT = 1667;             // R280: ~10000 rpm at 6 V
const float NOISE_V = 0.015;                 // below this the shaft counts as stopped
const float MOTOR_RPM_FULL = 2000;           // your fastest hand spin -> top of the dataset range

// Torque. Measured: a DC motor's torque is proportional to its current (torque = KT x amps).
const float KT = 60.0f / (2 * PI * RPM_PER_VOLT);  // ~0.0057 N*m per amp
const float R_LOAD = 10.0;                   // load resistor, ohms
const float R_MOTOR = 5.0;                   // winding resistance, ohms (multimeter across the tabs)
const float TORQUE_FULL_NM = 0.001;          // real torque that maps to the top of the dataset range
// From rpm: AI4I machines run at roughly constant power, so torque = power / angular speed.
const float NOMINAL_POWER_W = 6000;
const float PROCESS_FOLLOW = 0.02;           // share of the gap to air temp + 10 K closed each send

// AI4I 2020 dataset ranges.
const float RPM_MIN = 1168, RPM_MAX = 2886;
const float TORQUE_MIN = 3.8, TORQUE_MAX = 76.6;
const float TOOL_WEAR_MAX = 253;

// One connection is opened once and reused for every post: opening a new one each time is
// slow on the R4, because every step is relayed to its separate WiFi chip.
WiFiClient client;
SPL07_003 baro;
bool baroOk = false;
float processK = NAN;
unsigned long seq = 0;
float toolWearMin = 0;
unsigned long lastSend = 0, lastSample = 0, lastWifiTry = 0, pausedUntil = 0;
float sumGenV = 0, sumLoadV = 0, sumAir = 0;
int nSamples = 0;

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry = millis();
  Serial.println("Joining Wi-Fi...");
  WiFi.setTimeout(3000);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

bool ensureServer() {
  if (client.connected()) return true;
  client.stop();
  client.setConnectionTimeout(1500);
  return client.connect(SERVER_HOST, SERVER_PORT);
}

// Waits up to the deadline for one line of the reply. Returns false on timeout.
bool readLine(String& line, unsigned long deadline) {
  line = "";
  while ((long)(deadline - millis()) > 0) {
    if (!client.available()) { delay(1); continue; }
    char c = client.read();
    if (c == '\n') return true;
    line += c;
  }
  return false;
}

bool skipBytes(long n, unsigned long deadline) {
  while (n > 0 && (long)(deadline - millis()) > 0) {
    if (client.available()) { client.read(); n--; } else delay(1);
  }
  return n == 0;
}

// Reads the whole reply - headers, then a Content-Length or chunked body - so the next post
// on the same connection starts clean. Returns the status code, or 0 if the reply was cut off.
int readReply() {
  unsigned long deadline = millis() + 1500;
  String line;
  if (!readLine(line, deadline) || !line.startsWith("HTTP/1.")) return 0;
  int status = line.substring(9, 12).toInt();

  long length = 0;
  bool chunked = false;
  while (true) {
    if (!readLine(line, deadline)) return 0;
    if (line == "\r" || line.length() == 0) break;  // blank line ends the headers
    line.toLowerCase();
    if (line.startsWith("content-length:")) length = line.substring(15).toInt();
    if (line.startsWith("transfer-encoding:") && line.indexOf("chunked") >= 0) chunked = true;
  }

  if (!chunked) return skipBytes(length, deadline) ? status : 0;
  // Chunked: "<hex size>\r\n<data>\r\n" repeated, ending with a zero-size chunk.
  while (true) {
    if (!readLine(line, deadline)) return 0;
    long size = strtol(line.c_str(), nullptr, 16);
    if (!skipBytes(size + 2, deadline)) return 0;  // the data plus its trailing \r\n
    if (size == 0) return status;
  }
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 3000) {}
  analogReadResolution(14);

  Wire.begin();
  // &Wire picks the I2C overload of begin(), not the SPI one.
  baroOk = baro.begin(SPL07_ADDR_DEF, &Wire) || baro.begin(SPL07_ADDR_ALT, &Wire);
  if (baroOk) {
    baro.setPressureConfig(SPL07_8HZ, SPL07_8SAMPLES);
    baro.setTemperatureConfig(SPL07_8HZ, SPL07_1SAMPLE);
    baro.setMode(SPL07_CONT_PRES_TEMP);
  } else {
    Serial.println("Barometer not found, sending 298.0 K");
  }

  Serial.println("Joining Wi-Fi...");
  WiFi.setTimeout(10000);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiTry = millis();
  if (WiFi.status() == WL_CONNECTED) Serial.println("Joined Wi-Fi as " + WiFi.localIP().toString());
  else Serial.println("Couldn't join Wi-Fi yet (it must be 2.4 GHz), will retry");
}

void loop() {
  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis();
    sumGenV += analogRead(PIN_GEN) * ADC_TO_V;
#if HAS_TORQUE
    sumLoadV += analogRead(PIN_LOAD) * ADC_TO_V;
#endif
    sumAir += analogRead(PIN_AIR);
    nSamples++;
  }

  if (millis() - lastSend < SEND_MS) return;
  float dtSec = (millis() - lastSend) / 1000.0f;
  lastSend = millis();

  float genV = nSamples ? sumGenV / nSamples : 0;
  float loadV = nSamples ? sumLoadV / nSamples : 0;
  float airRaw = nSamples ? sumAir / nSamples : 0;
  sumGenV = sumLoadV = sumAir = 0;
  nSamples = 0;
  // Under load the winding drops some voltage; adding it back gives the true speed.
  float currentA = loadV / R_LOAD;
  float motorRpm = genV < NOISE_V ? 0 : (genV + currentA * R_MOTOR) * RPM_PER_VOLT;
  float rpm = motorRpm > 0 ? RPM_MIN + fminf(motorRpm / MOTOR_RPM_FULL, 1) * (RPM_MAX - RPM_MIN) : 0;
#if HAS_TORQUE
  float torqueNm = TORQUE_MIN + fminf(KT * currentA / TORQUE_FULL_NM, 1) * (TORQUE_MAX - TORQUE_MIN);
#else
  // Stopped: no load on the shaft, so the dataset's minimum torque.
  float torqueNm = rpm > 0 ? constrain(NOMINAL_POWER_W * 60 / (2 * PI * rpm), TORQUE_MIN, TORQUE_MAX)
                           : TORQUE_MIN;
#endif
  if (rpm > 0) toolWearMin = fminf(toolWearMin + dtSec, TOOL_WEAR_MAX);  // demo time: 1 s = 1 min

  float airK = baroOk ? baro.readTemperature() + 273.15f : 298.0f;
  // Process temp heads for air temp + 10 K plus load heating, but lags like a machine's thermal mass
  // (2% of the way per 500 ms send, ~25 s to catch up). A quick pinch on the barometer raises air temp
  // faster than process temp follows, so the gap shrinks for a few seconds: a heat dissipation warning.
  float targetK = airK + 10 + (torqueNm * rpm * 2 * PI / 60 - 6000) / 3000;
  processK = isnan(processK) ? targetK : processK + (targetK - processK) * PROCESS_FOLLOW;

  String body = String("{\"device\":\"plant-sensor-1\",\"seq\":") + seq++ +
    ",\"uptime_ms\":" + millis() +
    ",\"readings\":{\"type\":\"M\"" +
    ",\"air_temp_k\":" + String(airK, 1) +
    ",\"process_temp_k\":" + String(processK, 1) +
    ",\"rpm\":" + String(rpm, 0) +
    ",\"torque_nm\":" + String(torqueNm, 1) +
    ",\"tool_wear_min\":" + String(toolWearMin, 0) +
    (millis() > AIR_WARMUP_MS ? String(",\"air_quality_raw\":") + String(airRaw, 0) : String("")) + "}}";
  Serial.println(body);

  ensureWifi();
  if (WiFi.status() != WL_CONNECTED || (long)(millis() - pausedUntil) < 0) return;
  if (!ensureServer()) {
    Serial.println("Server not reachable, retrying in 3 s");
    pausedUntil = millis() + RETRY_PAUSE_MS;
    return;
  }

  // The whole request in one print: each print is a separate trip to the WiFi chip.
  String req = String("POST /api/ingest HTTP/1.1\r\nHost: ") + SERVER_HOST +
    "\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nAuthorization: Bearer " + DEVICE_TOKEN +
    "\r\nContent-Length: " + body.length() + "\r\n\r\n" + body;
  client.print(req);

  int status = readReply();
  if (status != 200) {
    Serial.print("Reply ");
    Serial.println(status);
    client.stop();  // start a fresh connection next time
  }
}
```

Open Serial Monitor at 115200 baud: it stays quiet while posts succeed and prints the reply code and the body when one fails (401 wrong token, 400 bad body, 0 no reply). If the ML laptop needs the readings too, give it its own `WiFiClient` and repeat the post to its address.

To see exactly what the board sends, start the server with `LOG_INGEST=1 npx tsx --env-file=.env src/server.ts`. Every post is printed, and rejected ones say which field was wrong.

**Air quality at gas metering.** Plug the Grove Air Quality Sensor v1.3 into A0. After its 20 s warm-up the board adds `air_quality_raw` to every post. The server takes the first few seconds of readings as clean air and shows the rest as a percentage of it on the gas metering asset. Below 70% the manager gets a "possible gas leak" maintenance recommendation. For the presentation: let it settle in normal air, then cup your hands over the sensor and breathe into it. The reading climbs, quality drops and the recommendation appears within a couple of seconds. Without the board, `npm run board -- GAS` plays the same drop. If breathing doesn't bring it under 70%, lower `GAS_ALERT_PCT` in `web/src/sim/engine.ts`.

The board doesn't have to send all six readings. Whatever it sends drives GT-08 live (marked "Live" on the website); anything it leaves out keeps replaying from the dataset.

When it works, GT-08 shows "Live sensor" on the website within a second, and readings the model flags show up as a maintenance recommendation for GT-08.

### Before judging

- Plug in the host laptop and the hotspot phone. A hotspot drains a battery fast.
- The host's address can change if the hotspot restarts. Check `ip -4 addr` again and update the Wi-Fi phone.
- Check the plant server printed `[ml] scoring every turbine with Random Forest`.
- Do one full run: `npm run board -- PWF`, GT-08 recommendation on the maintenance board, edit what to check, Request maintenance, Dispatch to the phone engineer, alert on the phone, Accept, walk, website updates, repair.
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
cd machine_learning && .venv/bin/python -m pytest -q
```
