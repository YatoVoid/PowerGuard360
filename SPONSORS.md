# CodeRED sponsor challenges

Hacking: Sat 1 PM to Sun 1 PM. Judging: Sun 1:30-3:30 PM.
Rubric (equal weight): Technology, Design, Completion, Learning.

Fill in one block per sponsor during the ceremony.

## Template

### <Sponsor>
- Challenge:
- Their problem / pain point:
- Data or API they provide:
- Required deliverable:
- Judging criteria:
- Prize:
- Contact / mentor:
- Fit with our default shape (data -> dashboard -> AI Q&A): high / medium / low

## Predicted (unconfirmed, delete or confirm)

### Chevron
- Likely: AI tool or dashboard on their data (sustainability, safety, equipment)

### Lovable
- Likely: best app built with Lovable

### Google Gemini (MLH)
- Likely: best use of the Gemini API. Stack this one with any track.

### RSM
- Possible: AI for finance or auditing

### Reynolds and Reynolds
- Possible: car dealership software

## MLH prizes (confirmed, from mlh.io CodeRED Orion page)

Stackable on top of any sponsor track. Select every one we touch on Devpost.

| Prize | Reward | Easy to qualify? |
|---|---|---|
| Best Use of Gemini API | MLH swag kits | Yes, our AI layer |
| Best Use of ElevenLabs | Wireless earbuds | Yes, if the app speaks (voice alerts, narrated summaries) |
| Best Use of Tiger Data | Stream Deck Mini | Yes, if we store sensor/metric time series in it (Postgres + hypertables) |
| Best Domain Name (GoDaddy Registry) | Digital gift card | Yes, register a domain with the MLH code |
| Best Use of Backboard | Tile Essentials Pack | Maybe, AI memory across sessions |
| Best Use of Vultr | M5Stack Tab5 | Maybe, host the backend on Vultr instead of Vercel |
| Best Use of Solana | Assorted | Only if the idea needs payments/ledger |
| DEV Writing Challenge | $100 | After the event, write up the project on DEV |

## Hardware

Physical projects allowed. Arduino, ESP32, Raspberry Pi are all fair game.
Shape that fits most tracks: ESP32 sensors -> Tiger Data (time series) -> web dashboard -> Gemini explains -> ElevenLabs speaks alerts.
A physical demo at the judging table is strong for Design and Completion.

## Decision
- Sponsor track: Chevron (pending the announced challenge)
- Plus: General, Gemini, ElevenLabs, Tiger Data, GoDaddy domain
- No hardware available. Software only.
- Idea in one sentence: a control room and planning tool for a Kilby-style plant, where gas turbines power an AI data center directly. It simulates the data center's swinging load, decides how many turbines and how much battery to run, catches failures before they happen, and an AI copilot explains every decision.

### The real problem it solves
- AI training loads swing hard and fast (thousands of GPUs speed up and slow down together). Gas turbines ramp slower than that, and the swings stress them.
- An operator has to answer, every hour: how many turbines on, how much spinning reserve, when to lean on the battery or grid, when to take a turbine down for maintenance. Too few and the data center drops. Too many and you burn gas and emissions for nothing.

### What the app does
1. Live view: data center load vs. turbine output vs. battery, per second, from a simulator we write.
2. Planner: given a load forecast, picks turbines on/off and battery reserve. Shows cost, gas burned, CO2, and uptime risk.
3. Failure drill: "trip turbine 2" button. Watch battery cover the gap and the rest ramp up. Same demo moment as the hardware version.
4. Early warning: simulated turbine sensor drift (vibration, exhaust temp). Flags trouble before the trip.
5. AI copilot (Gemini): "why did you start turbine 4?", "what if load grows 20% next month?". Voice alerts via ElevenLabs.

### Real data we can use
- ERCOT public prices/load (grid fallback cost in Texas)
- EIA natural gas prices (Waha hub, Permian)
- Published turbine specs (GE Vernova, Solar Turbines) for size, ramp, efficiency
- Load shape modeled on published AI training power traces

### Split
- Simulator + planner logic
- Backend, database (Tiger Data), AI copilot
- Dashboard UI
