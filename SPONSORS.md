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
- Idea in one sentence: a scale model of a data center with behind-the-meter backup power. When the grid drops, an ESP32 switches the load to the "generator" and a phone app shows live power, the switchover, and an AI explanation of what happened.

### Why it fits Chevron
Chevron New Energies is building natural-gas power plants co-located with data centers (first one: Microsoft, with Engine No. 1). Their pitch is always-on, behind-the-meter power that tracks data center demand. Our model is that system in miniature.

### Chevron facts for the pitch (checked 2026-10-10)
- Project Kilby, West Texas. Chevron subsidiary Energy Forge One signed a 20-year deal with Microsoft (announced 2026-06-22), developed with Engine No. 1.
- About 2.67 GW, built in phases. Natural gas from the Permian. GE Vernova turbines plus Solar Turbines (Caterpillar).
- Final investment decision expected end of 2026. First power expected 2028.
- Cost is an analyst estimate ($7-9B), not a Chevron figure. Pecos/Reeves County location is from one outlet, not confirmed. Don't quote either.
- In Kilby the turbines are the main power source, not the backup. Frame the demo as: data center runs on dedicated turbine power; if a turbine trips, the load fails over to grid or battery. That matches Chevron's real setup.
- Stretch feature: vibration sensor on the "turbine" so the AI flags trouble before the trip (predictive maintenance).

### Hardware (all low voltage, no mains)
- ESP32 (powered from laptop USB so it survives the switchover)
- 2x INA219 current/voltage sensors (grid side, generator side)
- 2-channel relay module or MOSFETs for the transfer switch
- "Grid": 5V USB supply. "Generator": battery pack
- "Data center load": small DC fan + LEDs
- Push button or kill switch to simulate an outage

### Demo script
1. App shows load on grid, steady.
2. Judge presses the outage button.
3. Load moves to generator, app logs switchover time, phone speaks the alert.
4. Ask the AI "what happened and what should the operator do?"

