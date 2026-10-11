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
