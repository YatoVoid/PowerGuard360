// Stands in for the sensor board: sends real AI4I 2020 rows once a second in the board's exact format.
//   npm run board                     steady readings
//   npm run board -- HDF              lead into a recorded heat dissipation failure (also OSF, PWF, TWF)
//   npm run board -- GAS              steady readings, and 20 s in the gas metering air quality drops for 15 s
// Every post also carries an air quality reading for gas metering, clean air unless GAS is running.
// SERVER_URL defaults to this laptop. ML_URL, if set, gets the same JSON so the ML laptop scores it too.
// LEAD_ROWS sets how many rows play before the recorded failure (default 40).
import { ROWS, rowFailure, rowFeatures } from "../../web/src/sim/model.ts";
import type { FailureMode } from "../../web/src/types.ts";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8787";
const ML_URL = process.env.ML_URL ?? "";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const EVERY_MS = Number(process.env.EVERY_MS ?? 1000);
const LEAD_ROWS = Number(process.env.LEAD_ROWS ?? 40);

const arg = process.argv[2]?.toUpperCase() ?? "";
if (arg && !["HDF", "OSF", "PWF", "TWF", "GAS"].includes(arg)) {
  console.error(`Unknown scenario "${process.argv[2]}". Use HDF, OSF, PWF, TWF or GAS, or nothing for steady readings.`);
  process.exit(1);
}
const leak = arg === "GAS";
const mode = (leak ? "" : arg) as FailureMode | "";
// Clean air reads about 1,600 on the R4's 14-bit ADC with a Grove air quality sensor; a breath roughly doubles it.
const CLEAN_AIR = 1600;
const airQuality = (sec: number) => Math.round(CLEAN_AIR * (leak && sec >= 20 && sec < 35 ? 1.9 : 1) + (Math.random() - 0.5) * 40);
if (!DEVICE_TOKEN) {
  console.error("DEVICE_TOKEN is not set. Run from server/ with the .env loaded.");
  process.exit(1);
}

function startRow(): number {
  if (!mode) return 0;
  const fail = ROWS.findIndex((_, i) => i >= LEAD_ROWS && rowFailure(i) === mode);
  return fail - LEAD_ROWS;
}

async function post(url: string, body: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(2000) });
    return res.ok ? "ok" : `HTTP ${res.status}`;
  } catch (e) {
    return (e as Error).name === "TimeoutError" ? "timeout" : "unreachable";
  }
}

let row = startRow();
let seq = 0;
const started = Date.now();
console.log(`Board simulator: ${mode ? `${LEAD_ROWS} rows before a recorded ${mode}` : leak ? "steady readings, gas metering air quality drops at 20 s" : "steady readings"} from dataset row ${row + 1}, to ${SERVER_URL}${ML_URL ? ` and ${ML_URL}` : ""}`);

setInterval(async () => {
  // Steady mode skips failure rows so the unit only fails when a scenario asks for it.
  while (!mode && rowFailure(row)) row = (row + 1) % ROWS.length;
  const f = rowFeatures(row);
  const failure = rowFailure(row);
  const aq = airQuality((Date.now() - started) / 1000);
  const body = JSON.stringify({
    device: "board-sim",
    seq: seq++,
    uptime_ms: Date.now() - started,
    readings: {
      type: f.type, air_temp_k: f.airTempK, process_temp_k: f.processTempK, rpm: f.rpm, torque_nm: f.torqueNm, tool_wear_min: f.toolWearMin,
      air_quality_raw: aq,
    },
  });
  const [server, ml] = await Promise.all([
    post(`${SERVER_URL}/api/ingest`, body, { authorization: `Bearer ${DEVICE_TOKEN}` }),
    ML_URL ? post(ML_URL, body, {}) : Promise.resolve(null),
  ]);
  console.log(`row ${row + 1} ${f.type} ${f.airTempK}K/${f.processTempK}K ${f.rpm}rpm ${f.torqueNm}Nm wear ${f.toolWearMin} air ${aq}${failure ? ` <- recorded ${failure}` : ""} | server ${server}${ml ? ` | ML ${ml}` : ""}`);
  row = (row + 1) % ROWS.length;
}, EVERY_MS);
