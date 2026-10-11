import { describe, expect, it } from "vitest";
import { PlantHost } from "./plant.ts";
import { ClientMessage, RemotePrediction, SensorReading } from "./protocol.ts";

describe("plant host", () => {
  it("applies queued actions on the next tick", () => {
    const h = new PlantHost();
    h.tick();
    h.apply({ type: "trip", unit: "GT-02" });
    h.tick();
    expect(h.plant.turbines[1].status).toBe("tripped");
  });

  it("routes the board's six readings to GT-08 as live", () => {
    const h = new PlantHost();
    h.ingest({ device: "esp32", seq: 1, uptime_ms: 10, readings: { type: "M", air_temp_k: 299, process_temp_k: 309.4, rpm: 1500, torque_nm: 41, tool_wear_min: 20 } }, 1000);
    h.tick(1200);
    expect(h.plant.turbines[7].source).toBe("live");
    expect(h.plant.turbines[7].features.rpm).toBe(1500);
  });
});

describe("phone stand-in", () => {
  it("handles the phone engineer's job when no phone is connected", () => {
    const h = new PlantHost();
    h.tick();
    h.apply({ type: "trip", unit: "GT-04" });
    for (let i = 0; i < 600 && !h.plant.requests.some((r) => r.status === "resolved"); i++) h.tick();
    expect(h.plant.requests[0].engineerId).toBe("ENG-1");
    expect(h.plant.requests[0].status).toBe("resolved");
  });

  it("waits for the person once their phone is connected", () => {
    const h = new PlantHost();
    h.phonesOnline.add("ENG-1");
    h.tick();
    h.apply({ type: "trip", unit: "GT-04" });
    for (let i = 0; i < 30; i++) h.tick();
    expect(h.plant.requests[0].status).toBe("dispatched");
  });
});

describe("auto walk", () => {
  it("keeps the person's own auto walk on while their phone is connected", () => {
    const h = new PlantHost();
    h.phonesOnline.add("ENG-1");
    h.apply({ type: "autoWalk", engineerId: "ENG-1", on: true });
    for (let i = 0; i < 3; i++) h.tick();
    expect(h.plant.engineers[0].autoWalk).toBe(true);
  });
});

describe("protocol", () => {
  it("rejects actions it does not know", () => {
    expect(ClientMessage.safeParse({ type: "action", action: { type: "explode" } }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "action", action: { type: "trip", unit: "GT-99" } }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "action", action: { type: "walk", engineerId: "ENG-1", meters: 500 } }).success).toBe(false);
  });

  it("accepts the documented sensor format and rejects impossible values", () => {
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { air_temp_k: 300, rpm: 1500 } }).success).toBe(true);
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { air_temp_k: 5 } }).success).toBe(false);
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { type: "X" } }).success).toBe(false);
  });
});

describe("ML laptop forecast", () => {
  it("accepts a forecast for a turbine and rejects anything else", () => {
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 0.4, mode: "OSF", minutes_to_failure: 3 }).success).toBe(true);
    expect(RemotePrediction.safeParse({ unit: "battery", probability: 0.4 }).success).toBe(false);
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 1.4 }).success).toBe(false);
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 0.4, detail: "<script>" }).success).toBe(false);
  });

  it("shows the posted forecast on the next tick", () => {
    const h = new PlantHost();
    h.predict({ unit: "GT-08", probability: 0.7, mode: "PWF", model: "Team model" }, 1000);
    h.tick(1500);
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-08")!.by).toBe("Team model");
  });
});
