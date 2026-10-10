import { z } from "zod";

// Everything a client may ask the plant to do. Anything else is rejected.
const asset = z.string().regex(/^(GT-0[1-8]|battery|acc|switchyard|gas|datacenter)$/);
const id = z.string().max(16).regex(/^[A-Z]+-\d+$/);

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trip"), unit: asset }),
  z.object({ type: z.literal("reset"), unit: asset }),
  z.object({ type: z.literal("request"), asset, reason: z.string().max(200).default("") }),
  z.object({ type: z.literal("cancel"), requestId: id }),
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
