# Power Guard 360: build plan

Selling point: a live feed. Real sensors and a real moving vehicle drive a 3D model of a gas-turbine plant that powers an AI data center.

## What's real, what's simulated

| Source | Real or simulated | Role in the story |
|---|---|---|
| Air quality sensor (Arduino) | Real | Fence-line emissions monitor next to the turbine stacks |
| Barometer (Arduino) | Real | Ambient pressure. Lower air density cuts turbine output, so the simulator derates the fleet from this reading |
| Light sensor (Arduino) | Real | Flame detector on GT-01. Cover it and the turbine "trips" |
| Phone GPS (Android app) | Real | Field service truck, its movement mapped onto the plant site |
| ERCOT price, EIA gas price | Real public data | Economics panel |
| Turbine output, data center load, battery | Simulated | Driven by the real inputs above |

The light sensor doubles as the failure drill a judge can trigger by hand.

## Architecture

```
Arduino --Wi-Fi, HTTPS + shared secret------------------> API server
        (fallback) --USB serial--> laptop bridge -------^
Android app (phone GPS) ---------------HTTPS + shared secret--> API server
API server: ingest, simulator tick, Tiger Data writes, WebSocket fan-out
Web app (Vercel) <---WebSocket--- API server ---WebSocket---> Android app
```

- Board has USB-C and Wi-Fi. It posts straight to the API over Wi-Fi. If venue Wi-Fi blocks it (captive portal), the laptop bridge reads the same data over USB serial. Both paths send the same JSON, so the server doesn't care which one is live.
- Mobile app: Expo, APK built with EAS.
- 3D look: stylized dark control room, low-poly assets from simple shapes, glowing live values, animated power flow.
- Every number shown is tagged real or simulated.
- Simulator and planner compute numbers. Gemini only explains them through tool calls.

## Surfaces

1. Web, desktop: 3D plant (react-three-fiber), click any asset for its panel, live sidebar, copilot.
2. Web, mobile: same data, layout built for phone from day one, not a squeezed desktop.
3. Android app (Expo): live feed, alerts, and it sends the phone's GPS as the truck.

## Order (cut from the bottom if time runs short)

1. API server + WebSocket + Arduino bridge, live numbers on a plain page
2. 3D plant with live values pinned to assets
3. Simulator: turbines, load, battery, derate from barometer, trip from light sensor
4. Android app: live feed + GPS truck
5. Mobile web layout + design pass
6. Gemini copilot, ElevenLabs voice alerts
7. ERCOT/EIA economics panel
8. Early warning on drifting simulated sensors
