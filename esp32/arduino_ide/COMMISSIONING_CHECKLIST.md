# ESP32 Commissioning Checklist

Use this checklist after flashing both boards.

## Before Power-On

- Verify common ground between ESP32 boards and actuator driver stage.
- Verify ESP32-A float switch is wired to GPIO14 and GND.
- Verify ESP32-A pump/valve outputs are wired to GPIO5, GPIO25, GPIO26, GPIO27 through relay or MOSFET drivers.
- Verify ESP32-B sensors match the current firmware pin map.
- Verify DHT22 pull-ups and DS18B20 pull-up are installed.
- Verify `secrets.h` was created from `secrets.example.h` in each sketch folder.

## Flash Order

1. Flash ESP32-A first.
2. Open Serial Monitor at `115200`.
3. Confirm boot diagnostics print the correct device ID and topics.
4. Flash ESP32-B second.
5. Open Serial Monitor at `115200`.
6. Confirm telemetry snapshots begin printing every 5 seconds.

## Live Verification

- Confirm both boards connect to Wi-Fi.
- Confirm both boards connect to MQTT.
- Confirm backend receives `vermilinks/device_status/esp32a` and `vermilinks/device_status/esp32b`.
- Confirm backend receives `vermilinks/esp32b/metrics`.
- Confirm backend receives `vermilinks/esp32a/state` after any state change.
- Confirm dashboard latest telemetry appears only after ESP32-B starts publishing.
- Confirm actuator control only affects ESP32-A.
- Confirm float LOW forces pump OFF on ESP32-A.

## Final Acceptance

- `/api/devices` shows real connected boards only.
- `/api/sensors/latest` reflects fresh ESP32-B telemetry.
- Admin dashboard updates with live values.
- Pump and valve commands acknowledge correctly.
- Float safety prevents pump ON during low-water state.
