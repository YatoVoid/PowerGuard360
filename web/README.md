# Power Guard 360 web app

Digital twin and dashboard for a gas-turbine plant powering an AI data center.

```
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests
npm run build
```

- `src/types.ts`: data format every screen reads. Real turbine data and the ML model plug in here.
- `src/sim/engine.ts`: mock plant. 8 turbines, battery, data center load, inbound trailer. Seeded, so demos repeat.
- `src/scene/PlantScene.tsx`: 3D plant view.
- `src/ui/parts.tsx`: panels shared by the plant view, dashboard and mobile app.

All plant numbers are simulated until real data is connected. Sensor and GPS readings are marked "Live" when they arrive.
