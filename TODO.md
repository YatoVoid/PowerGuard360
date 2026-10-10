# Power Guard 360: status

Live: https://power-guard-360.vercel.app
Feature freeze Sun 9 AM. Submit Sun 1 PM. Judging Sun 1:30-3:30 PM.

## Done
- Repo, team branches and folders (Anthony and cptnomar: firmware, Sakina: docs)
- Sponsor notes, verified Project Kilby facts, MLH prize list
- Web app live on Vercel
- 3D plant: 8 gas turbines with HRSGs and stacks, steam hall, A-frame air-cooled condenser, switchyard, battery yard, AI data center, gas metering, live power flow, click any asset
- Dashboard: power balance, chart, turbine fleet, unit details with trip and reset, overheat forecast, site sensors, alarm log
- Shipments: map with three inbound loads, stops, geofence, arrival vs failure check, phone GPS tracking
- Layout checked at phone, laptop and wide screens
- Mock plant engine with tests

## To do
1. Server that receives ESP32 readings and pushes live data to the web and the app
2. Send the firmware team the server URL and device token
3. Android app (Expo): dashboard and shipments, sends phone GPS
4. Gemini copilot that explains alarms and answers questions
5. ElevenLabs voice alerts on trips
6. Swap the trend forecast for the ML model when real turbine data arrives
7. Domain from GoDaddy Registry (MLH code)
8. Devpost: write-up, screenshots, demo video, AI tool disclosure, every prize selected
9. Rehearse the 2-minute pitch and demo script
