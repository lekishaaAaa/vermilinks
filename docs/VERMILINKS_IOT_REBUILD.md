# VermiLinks IoT Rebuild - Implementation Blueprint

Date: 2026-02-14

This document locks the implementation to the required architecture and payloads.

## 1) MQTT Payload Definitions (Exact)

Topic: `vermilinks/esp32a/command`

Payload (all fields required; booleans only; requestId is UUID string):
```
{
  "pump": true,
  "valve1": false,
  "valve2": false,
  "valve3": true,
  "requestId": "5f08a934-2b6b-4cf0-8d2b-1b6e97c1f7c3"
}
```

Rules:
- All fields required.
- All fields boolean except requestId.
- Backend generates requestId.
- ESP32-A ignores invalid payloads.

Topic: `vermilinks/esp32a/state`

Payload (retained state + confirmation):
```
{
  "pump": false,
  "valve1": false,
  "valve2": false,
  "valve3": false,
  "float": "LOW",
  "requestId": "5f08a934-2b6b-4cf0-8d2b-1b6e97c1f7c3",
  "source": "applied",
  "ts": 1739491200
}
```

Topic: `vermilinks/esp32b/telemetry`
```
{
  "tempC": 24.6,
  "humidity": 62.1,
  "soil": 478,
  "waterTempC": 23.9,
  "ts": 1739491200
}
```

Topic: `vermilinks/esp32a/status`
```
{
  "online": true,
  "ip": "192.168.1.21",
  "rssi": -61,
  "uptime": 123456,
  "ts": 1739491200
}
```

Topic: `vermilinks/esp32b/status`
```
{
  "online": true,
  "rssi": -58,
  "uptime": 2210,
  "ts": 1739491200
}
```

## 2) Actuator State Synchronization Strategy

Command flow:
1) Frontend -> POST `/api/control`
2) Backend validates payload, generates requestId, stores `pendingCommands`, publishes MQTT command
3) ESP32-A validates payload, enforces safety, applies outputs
4) ESP32-A publishes retained `vermilinks/esp32a/state` with requestId
5) Backend verifies confirmation and resolves `pendingCommands`
6) Frontend updates UI only after confirmation event or `/api/latest`

Confirmation logic:
- Backend marks `pendingCommands` as `acknowledged` only when requestId matches and state matches.
- If state differs without safety override, mark `mismatch` with error.
- `source == safety_override` is treated as valid confirmation.

Race condition handling:
- Backend allows one pending command per device. A second request gets HTTP 409.
- Frontend disables controls while a command is pending.

Reconnect handling:
- ESP32-A republishes retained state on reconnect.
- Backend updates `deviceState` from retained state and clears stale `pendingCommands`.

Desync prevention:
- Source of truth for physical state: ESP32-A retained state.
- Backend never forces a replay; user must issue a new command to align desired state.

Frontend loading state:
- Controls disabled when pending or device offline.
- UI updates only after requestId confirmation or `/api/latest` confirms.

## 3) Pump Safety Override Logic (Safest)

Firmware (ESP32-A) is authoritative:
- On boot: pump forced OFF before any MQTT connect.
- If float LOW: immediately force pump OFF, reject pump ON commands.
- If float transitions HIGH -> LOW while pump ON: stop pump immediately.
- Publish state with `source = safety_override` and float LOW.
- Safety runs even if WiFi disconnects.

Backend safety:
- Backend rejects pump ON if last known float state is LOW.
- Backend never overrides firmware safety.

## 4) Firmware Structures

ESP32-A (Actuator Controller) structure:
```
esp32/firmware_esp32a/src/
  main.cpp
  config.h
  mqtt_client.h/.cpp
  actuator.h/.cpp
  safety.h/.cpp
  state_store.h/.cpp
```

ESP32-B (Sensor Node) structure:
```
esp32/firmware_esp32b/src/
  main.cpp
  config.h
  mqtt_client.h/.cpp
  sensors.h/.cpp
```

Required Arduino libraries:
- PubSubClient
- ArduinoJson
- DHT sensor library
- OneWire
- DallasTemperature

## 5) Backend Structure

New IoT services:
- `backend/services/iotMqtt.js`
- `backend/services/iotCommandService.js`
- `backend/services/iotAlertEngine.js`

Mongo models:
- `backend/models_mongo/Telemetry.js`
- `backend/models_mongo/Alert.js`
- `backend/models_mongo/DeviceState.js`
- `backend/models_mongo/PendingCommand.js`

REST endpoints (mounted at `/api`):
- `GET /api/latest`
- `GET /api/alerts`
- `PATCH /api/alerts/:id`
- `DELETE /api/alerts`
- `POST /api/control`

## 6) Frontend Control Flow

- Admin and User dashboards include `ActuatorControls`.
- Control buttons are disabled if float is LOW, device offline, or a command is pending.
- UI updates on `actuator:state` socket event or `GET /api/latest` confirmation.

## 7) Alert Engine Logic

Temperature:
- <18 -> LOW
- <15 -> CRITICAL
- >=32 -> HIGH
- >=35 -> CRITICAL

Humidity:
- <45 -> LOW
- >=75 -> HIGH

Float LOW:
- Immediate CRITICAL alert
- Message: "Water tank needs refill"

Anti-flooding:
- Active alerts de-duplicated by signature (type + level + deviceId).
- `lastSeen` updated while active.

## 8) Reconnect and Failure Handling

- ESP32-A republishes retained state on reconnect.
- Backend marks device online/offline using status topics.
- Pending commands time out or mismatch if no confirmation arrives.

## 9) Estimated Development Hours

- ESP32-A firmware: 10-14 hours
- ESP32-B firmware: 6-8 hours
- Backend MQTT + REST + models: 10-14 hours
- Frontend controls: 6-10 hours
- Integration testing: 6-10 hours
