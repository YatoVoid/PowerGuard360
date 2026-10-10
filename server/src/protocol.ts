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

// Same shape firmware/README.md documents for the ESP32.
export const SensorReading = z.object({
  device: z.string().max(40),
  seq: z.number().int().nonnegative(),
  uptime_ms: z.number().nonnegative(),
  readings: z.object({
    air_quality_raw: z.number().finite().optional(),
    pressure_hpa: z.number().min(300).max(1100).optional(),
    temperature_c: z.number().min(-40).max(85).optional(),
    light_raw: z.number().finite().min(0).optional(),
  }),
});
export type SensorReading = z.infer<typeof SensorReading>;
