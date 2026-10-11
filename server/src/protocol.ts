import { z } from "zod";

// Everything a client may ask the plant to do. Anything else is rejected.
const asset = z.string().regex(/^(GT-0[1-8]|battery|acc|switchyard|gas|datacenter)$/);
const id = z.string().max(16).regex(/^[A-Z]+-\d+$/);

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trip"), unit: asset }),
  z.object({ type: z.literal("reset"), unit: asset }),
  z.object({ type: z.literal("request"), asset, reason: z.string().max(200).default("") }),
  z.object({ type: z.literal("cancel"), requestId: id }),
  // The manager sends a chosen engineer to an open request. Nothing is dispatched without this.
  z.object({ type: z.literal("dispatch"), requestId: id, engineerId: id }),
  // The manager's answer to a model recommendation, with their notes on what the engineer should check.
  z.object({ type: z.literal("review"), recommendationId: id, decision: z.enum(["request", "decline"]), note: z.string().max(200).default("") }),
  z.object({ type: z.literal("accept"), requestId: id, engineerId: id }),
  // One GPS step from the phone, already scaled to site metres. Capped so a jump in the fix can't teleport anyone.
  z.object({ type: z.literal("walk"), engineerId: id, meters: z.number().min(0).max(40) }),
  z.object({ type: z.literal("autoWalk"), engineerId: id, on: z.boolean() }),
  z.object({ type: z.literal("startRepair"), requestId: id }),
]);
export type Action = z.infer<typeof Action>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("action"), action: Action }),
  // The mobile app says hello so the server knows a real person is carrying the phone engineer's role.
  z.object({ type: z.literal("hello"), role: z.literal("phone"), engineerId: id }),
]);

// Same shape firmware/README.md documents: the six AI4I features, measured by the board for GT-08.
// Ranges are the physical bounds of each reading, wide enough for real sensors and the dataset alike.
export const SensorReading = z.object({
  device: z.string().max(40),
  seq: z.number().int().nonnegative(),
  uptime_ms: z.number().nonnegative(),
  readings: z.object({
    type: z.enum(["L", "M", "H"]).optional(),
    air_temp_k: z.number().min(250).max(350).optional(),
    process_temp_k: z.number().min(250).max(400).optional(),
    rpm: z.number().min(0).max(5000).optional(),
    torque_nm: z.number().min(0).max(200).optional(),
    tool_wear_min: z.number().min(0).max(500).optional(),
  }),
});
export type SensorReading = z.infer<typeof SensorReading>;

const RANGES: Record<string, [number, number]> = {
  air_temp_k: [250, 350], process_temp_k: [250, 400], rpm: [0, 5000], torque_nm: [0, 200], tool_wear_min: [0, 500],
};

// A glitching sensor shouldn't cost the whole post: drop just the reading that's out of range or not a number.
export function dropBadReadings(json: unknown): { json: unknown; dropped: string[] } {
  const readings = (json as { readings?: Record<string, unknown> } | null)?.readings;
  if (!readings || typeof readings !== "object") return { json, dropped: [] };
  const dropped: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(readings)) {
    const range = RANGES[k];
    if (range && !(typeof v === "number" && Number.isFinite(v) && v >= range[0] && v <= range[1])) dropped.push(`${k}=${JSON.stringify(v)}`);
    else kept[k] = v;
  }
  return { json: { ...(json as object), readings: kept }, dropped };
}

// What the ML laptop posts after scoring the board's readings. It overrides the decision tree for that unit.
const printable = /^[^\u0000-\u001f\u007f<>]*$/;
export const RemotePrediction = z.object({
  unit: asset.refine((a) => a.startsWith("GT-"), "unit must be a turbine"),
  probability: z.number().min(0).max(1),
  mode: z.enum(["TWF", "HDF", "PWF", "OSF", "RNF"]).nullable().optional(),
  minutes_to_failure: z.number().min(0).max(1440).nullable().optional(),
  detail: z.string().max(160).regex(printable).optional(),
  model: z.string().max(40).regex(printable).optional(),
});
export type RemotePrediction = z.infer<typeof RemotePrediction>;
