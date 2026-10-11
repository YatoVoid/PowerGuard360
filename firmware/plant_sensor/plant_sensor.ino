// Power Guard 360 plant sensor node (Arduino UNO R4 WiFi + Grove Base Shield at 5V)
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
