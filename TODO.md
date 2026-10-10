# Power Guard 360: status

Live: https://power-guard-360.vercel.app
Feature freeze Sun 9 AM. Submit Sun 1 PM. Judging Sun 1:30-3:30 PM.

## Done
- Repo, team branches and folders (Anthony: firmware, Sakina: docs, egetwasm: story)
- Sponsor notes, verified Project Kilby facts, MLH prize list
- Web app deployed on Vercel
- 3D plant view: 8 gas turbines with HRSGs and stacks, steam hall, air-cooled condenser, switchyard, battery yard, AI data center, gas metering, live power flow, click any asset
- Dashboard: power balance, 5-minute chart, turbine fleet, unit details with trip and reset, overheat forecast, site sensors, alarm log
- Shipment map: trailer from Midland to the plant, shown in 3D when it arrives
- Mobile layout for every screen
- Mock plant engine with tests: turbine trip, battery backup, GT-03 overheating, barometer derate, light sensor trip

## To do
1. Server that receives ESP32 readings and phone GPS and pushes them live to the web and the app
2. Send Anthony the server URL and device token
3. Android app (Expo): dashboard and map, sends phone GPS as the trailer
4. Replace the trend forecast with the ML model once real turbine data arrives
5. Load real turbine data into the engine
6. Gemini copilot that explains alarms
7. ElevenLabs voice alerts
8. Domain from GoDaddy Registry (MLH code)
9. Devpost: screenshots, demo video, AI tool disclosure, select every prize
10. Practice the 2-minute pitch
