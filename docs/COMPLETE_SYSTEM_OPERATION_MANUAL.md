# VermiLinks Complete End-to-End System User & Operations Manual

Version: Source-aligned operational runbook
Audience: Operators, admins, maintainers, demo presenters, and troubleshooting engineers
System Scope: ESP32-A (actuators + float safety), ESP32-B (environment sensors), MQTT broker, Node/Express backend, PostgreSQL, React dashboards, Render deployment

---

## 1) System Purpose and High-Level Flow

VermiLinks is a two-node IoT monitoring/control platform:

- **ESP32-B** publishes sensor telemetry (temperature, humidity, soil moisture, soil temp, RSSI) to MQTT.
- **ESP32-A** receives actuator commands (pump/valves), applies hardware state, enforces float safety interlock, and publishes resulting state + acknowledgements.
- **Backend** subscribes to MQTT topics, writes telemetry/state to PostgreSQL, tracks pending command acknowledgements, emits realtime events via Socket.IO, and serves REST APIs.
- **Frontend** provides:
  - **User Dashboard** (read-only telemetry + daily summary + alerts)
  - **Admin Dashboard** (secure actuator control + alert actions + device/status views)

Primary architecture reference: `docs/system-schematic.md`.

---

## 2) Hardware Setup (Authoritative Pin Map + Electrical Requirements)

## 2.1 Source-of-Truth Pin Map Policy

There are historical docs that differ from current firmware pin assignments. For operational wiring and maintenance, treat these files as authoritative:

- `esp32/firmware_esp32a/src/config.h`
- `esp32/firmware_esp32b/src/config.h`

They enforce pin locks with compile-time `static_assert` checks.

## 2.2 ESP32-A (Actuators + Float Interlock)

From `esp32/firmware_esp32a/src/config.h`:

- Float switch input: **GPIO14** (`FLOAT_PIN`)
- Pump output: **GPIO5** (`PUMP_PIN`)
- Valve 1 output: **GPIO25** (`VALVE1_PIN`)
- Valve 2 output: **GPIO26** (`VALVE2_PIN`)
- Valve 3 output: **GPIO27** (`VALVE3_PIN`)
- Status LED: **GPIO13** (`PIN_STATUS_LED`)

Float logic from `safety.cpp`:

- Pin mode: `INPUT_PULLUP`
- Float LOW means switch pulled to GND (low-water condition)
- On LOW, firmware forces pump OFF and sets source to `safety_override`

## 2.3 ESP32-B (Sensors)

From `esp32/firmware_esp32b/src/config.h`:

- DHT22 #1 data: **GPIO16**
- DHT22 #2 data: **GPIO17**
- Soil analog #1: **GPIO32** (ADC1)
- Soil analog #2: **GPIO33** (ADC1)
- Soil analog #3: **GPIO34** (ADC1 input-only)
- Soil analog #4: **GPIO35** (ADC1 input-only)
- DS18B20 one-wire bus: **GPIO18**
- Status LED: **GPIO13**

## 2.4 Mandatory External Electrical Protections

- DHT22: 10kΩ pull-up from each DATA line to 3.3V
- DS18B20 bus: 4.7kΩ pull-up from DATA to 3.3V
- Pump/valves must **not** be driven directly from ESP32 GPIO
- Use relay/MOSFET driver stage per actuator channel
- Add flyback/snubber protection for inductive loads
- Use shared ground reference between ESP32 and driver stage

## 2.5 Power and Wiring Checklist Before First Boot

1. Verify all grounds are common.
2. Verify actuator driver inputs match GPIO map exactly.
3. Confirm float switch wiring to GPIO14 + GND with pull-up behavior.
4. Verify no direct high-current load on ESP32 pins.
5. Power ESP32 boards from stable regulated supply.
6. Confirm Wi-Fi RSSI in deployment area is acceptable.

---

## 3) Firmware Behavior and Operating Contracts

## 3.1 ESP32-A Runtime Behavior

From `esp32/firmware_esp32a/src/main.cpp` and `mqtt_client.cpp`:

- Boot sequence initializes actuators, float sensor, MQTT client, Wi-Fi.
- **Fail-safe boot rule:** pump forced OFF at startup.
- Float sampled every `FLOAT_SAMPLE_MS` (300ms).
- Any state change publishes `vermilinks/esp32a/state`.
- Device heartbeat/status publishes every `STATUS_INTERVAL_MS` (30s).
- MQTT reconnection uses exponential backoff up to 30s.
- LWT topic used for presence:
  - `vermilinks/device_status/esp32a`
  - payload: `online` / `offline`

## 3.2 ESP32-A Command and ACK Contract

Command topic expected:

- `vermilinks/esp32a/command`

Required JSON fields in command payload:

- `pump` (boolean)
- `valve1` (boolean)
- `valve2` (boolean)
- `valve3` (boolean)
- `requestId` (string)

After applying safety and output state, firmware publishes:

- state topic: `vermilinks/esp32a/state`
- ack topic: `vermilinks/esp32a/ack`

If float LOW and pump command true:

- firmware forces pump false
- state `source` becomes `safety_override`
- backend treats this as valid safety-driven outcome

## 3.3 ESP32-B Runtime Behavior

From `esp32/firmware_esp32b/src/main.cpp` and `mqtt_client.cpp`:

- Sensors initialized at boot
- Telemetry publish interval: `TELEMETRY_INTERVAL_MS` (5s)
- Status publish interval: `STATUS_INTERVAL_MS` (30s)
- MQTT reconnection with exponential backoff
- LWT topic:
  - `vermilinks/device_status/esp32b`
  - payload: `online` / `offline`

Telemetry topic:

- `vermilinks/esp32b/metrics`

Status topic:

- `vermilinks/esp32b/status`

---

## 4) MQTT Topic Map and Message Lifecycle

## 4.1 Subscribed by Backend (`backend/services/iotMqtt.js`)

- `vermilinks/esp32a/state`
- `vermilinks/esp32a/ack`
- `vermilinks/esp32a/status`
- `vermilinks/esp32b/metrics`
- `vermilinks/esp32b/status`
- `vermilinks/device_status/#` (LWT)

## 4.2 Command Lifecycle (Admin click to device apply)

1. Admin issues control API request (`POST /api/control`).
2. Backend validates payload and role/OTP requirements.
3. Backend checks:
   - target device online
   - no pending command already open
   - float lock rule for pump
4. Backend creates `pending_commands` row with `requestId`.
5. Backend publishes MQTT command to ESP32-A.
6. ESP32-A applies command + safety checks.
7. ESP32-A publishes state + ack.
8. Backend updates command status:
   - `acknowledged`, `mismatch`, or `failed`
9. Frontend gets realtime updates on actuator state.

## 4.3 Presence Lifecycle

- LWT online/offline messages update `devices` status and `online` fields.
- Backend emits realtime device status events to dashboards.

---

## 5) Backend Operations Manual

## 5.1 Backend Core Responsibilities

From `backend/server.js` and services:

- REST API serving (`/api/*`)
- Socket.IO realtime channel
- Native WebSocket support for device connections
- MQTT ingest service startup (when enabled)
- IoT command/status processing
- Presence reconciliation and tracking
- PostgreSQL persistence (plus existing Mongo connection path for legacy/auxiliary flows)

## 5.2 Key Mounted API Groups (`backend/server.js`)

- `/api` -> IoT routes (`backend/routes/iot.js`)
- `/api/auth` -> auth routes
- `/api/sensors` -> sensor routes
- `/api/settings` -> settings
- `/api/maintenance` -> maintenance
- `/api/devices` -> device inventory/status
- `/api/alerts` -> alert lifecycle
- `/api/command` -> deprecated (returns 410; use `/api/control`)

## 5.3 Control and Safety API Contracts (`backend/routes/iot.js`)

- `GET /api/latest`
  - returns latest telemetry snapshot + actuator state + pending command summary
- `POST /api/control`
  - protected by `auth + adminOnly + requireOtpVerified`
  - payload booleans: `pump`, `valve1`, `valve2`, `valve3`
  - returns `requestId` on accepted command (202)
- `GET /api/alerts`
  - returns active alerts by default
- `PATCH /api/alerts/:id`
  - admin + OTP acknowledge
- `DELETE /api/alerts`
  - admin + OTP clear all unresolved
- `GET /api/thresholds` and `PUT /api/thresholds`
  - admin threshold read/update

## 5.4 Command Service Guarantees (`backend/services/iotCommandService.js`)

- Rejects if device offline (503)
- Rejects if another command pending (409)
- Rejects pump ON while float LOW (409)
- Creates unique `requestId` (`crypto.randomUUID()`)
- Marks stale pending commands failed after timeout
- Timeout default: max(5000, `COMMAND_ACK_TIMEOUT_MS` or 25000)

## 5.5 Health and Availability Checks

- Primary health: `GET /api/health`
- Verify Socket.IO and MQTT presence indirectly via:
  - device status updates in dashboard
  - `devices.online` and `last_seen` updates in DB

---

## 6) Database Operations Manual

## 6.1 Core Tables in Active Runtime Paths

From backend models:

- `devices` (`backend/models/Device.js`)
  - includes `status`, `online`, `last_seen`, `updated_at`
- `sensordata`
  - historical telemetry stream
- `sensor_snapshots` (`backend/models/SensorSnapshot.js`)
  - latest-per-device snapshot
- `actuator_states` (`backend/models/ActuatorState.js`)
  - latest actuator state payloads
- `pending_commands` (`backend/models/PendingCommand.js`)
  - command request/ack lifecycle
- `alerts`
  - threshold/system alert history
- `actuator_logs`
  - actuator action audit trail

## 6.2 Critical Validation SQL Pack

```sql
-- Presence columns and sample values
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name='devices'
  AND column_name IN ('online','last_seen','updated_at');

SELECT "deviceId", status, online, last_seen, updated_at
FROM devices
ORDER BY updated_at DESC
LIMIT 20;

-- Telemetry snapshots and history
SELECT device_id, temperature, humidity, moisture, soil_temperature, timestamp
FROM sensor_snapshots
ORDER BY timestamp DESC
LIMIT 20;

SELECT "deviceId", temperature, humidity, moisture, timestamp
FROM sensordata
ORDER BY timestamp DESC
LIMIT 50;

-- Pending command queue health
SELECT request_id, device_id, status, error, ack_at, created_at, updated_at
FROM pending_commands
ORDER BY created_at DESC
LIMIT 30;

-- Alerts overview
SELECT id, type, severity, status, "createdAt", "resolvedAt"
FROM alerts
ORDER BY "createdAt" DESC
LIMIT 50;
```

## 6.3 Data Retention and Hygiene

- High-frequency telemetry can grow quickly.
- Use sensor log purge workflows (`README.md` and backend scripts) for retention control.
- Prefer scheduled cleanup over manual row edits.

---

## 7) Frontend Dashboard User Manual

## 7.1 User Dashboard (`frontend/src/pages/UserDashboard.tsx`)

Audience: students/guests/research viewers (read-only)

Main capabilities:

- Live telemetry panel
- Manual refresh of telemetry snapshot
- Daily readings by selected date (`sensorService.getDaily`)
- Alert summary (critical/warning/info counts)
- Recent alerts list
- Link to admin login
- No actuator control exposed

Operator training notes:

- “Connection healthy” indicates data pipeline currently active.
- If daily summary fails, UI displays a readable daily error state.
- Dashboard remains safe for public viewing (no command actions).

## 7.2 Admin Dashboard (`frontend/src/pages/AdminDashboard.tsx`)

Audience: authenticated admins

Main capabilities:

- Device inventory/status monitoring
- Realtime telemetry and history panes
- Alerts review + acknowledge/clear workflows
- Actuator control panel
- Maintenance reminders and system summaries
- Export/reporting actions

## 7.3 Actuator Control UI (`frontend/src/components/ActuatorControls.tsx`)

Behavior details:

- Pulls initial snapshot from `GET /api/latest`.
- Sends commands via `POST /api/control`.
- Subscribes to `actuator:state` socket events.
- Shows pending request indicator (`requestId`).
- Disables controls when:
  - command in-flight (`loading`)
  - device offline
  - pump toggle attempted while float is LOW
- Displays explicit safety message on `safety_override`.

---

## 8) Alerting and Response Playbook

## 8.1 Alert Sources

- Sensor threshold checks (backend threshold logic)
- Device presence transitions
- Pump emergency shutdown event on float LOW while pump previously ON

## 8.2 Alert Actions

Admin actions via API/UI:

- View active/recent alerts
- Acknowledge single alert (`PATCH /api/alerts/:id` or compatibility acknowledge route)
- Clear unresolved alerts (`DELETE /api/alerts` in iot route surface)

## 8.3 Incident Priority Model (Recommended)

- **Critical**: immediate operator response required (e.g., pump emergency shutdown)
- **Warning**: monitor and investigate promptly
- **Info**: non-urgent status notifications

## 8.4 Standard Alert Triage Procedure

1. Confirm alert timestamp and affected device ID.
2. Check device online/offline and last heartbeat.
3. Verify latest telemetry around event window.
4. For actuator/safety events, inspect `pending_commands` + `actuator_states`.
5. Apply physical inspection if hardware issue suspected.
6. Acknowledge alert only after root condition confirmed.

---

## 9) Startup and Shutdown Procedures

## 9.1 Local/On-Prem Operator Startup (Windows)

Repository includes script: `start-all.ps1`.

Recommended sequence:

1. Start DB (if using Docker local):
   - `docker-compose up -d db`
2. Install dependencies:
   - `npm run install-all`
3. Initialize models/admin if first run:
   - `node backend\scripts\sync_models.js`
   - `node backend\scripts\seed-admin.js`
4. Start platform:
   - `powershell -ExecutionPolicy Bypass -File .\start-all.ps1`
5. Validate:
   - Backend health: `http://127.0.0.1:5000/api/health`
   - Frontend: `http://127.0.0.1:3002`
   - `pm2 list` for process health

## 9.2 Hardware Power-Up Sequence (Operational Best Practice)

1. Ensure all actuator outputs are in safe default hardware state.
2. Power network infrastructure (router/AP).
3. Power backend/frontend host (or ensure Render stack is healthy).
4. Power ESP32-A and ESP32-B.
5. Confirm LWT online events for both devices.
6. Confirm telemetry appears before enabling any actuator actions.

## 9.3 Controlled Shutdown Sequence

1. Stop active pump/valve operations from admin UI (set all OFF, verify ack).
2. Confirm no pending command in UI and DB.
3. Stop frontend/backend services (`pm2 stop all` or deployment stop action).
4. Power down ESP32 nodes last if full system shutdown is required.
5. Preserve logs/DB snapshots for post-mortem if shutdown is incident-related.

---

## 10) Render Deployment and Live Operations

Deployment blueprint: `render.yml`

## 10.1 Render Services

- `vermilinks-backend` (Node web service)
- `vermilinks-frontend` (static site)
- `vermilinks-db` (managed PostgreSQL)

## 10.2 Critical Backend Environment Variables

From `render.yml` contract:

- `DATABASE_URL` (from managed DB)
- `JWT_SECRET`
- `CORS_ORIGINS`
- `SOCKETIO_CORS_ORIGINS`
- `FRONTEND_URL`
- `MQTT_BROKER_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- plus mail/auth/admin bootstrap variables as configured

## 10.3 Critical Frontend Environment Variables

- `REACT_APP_API_URL`
- `REACT_APP_BACKEND_URL`
- `REACT_APP_WS_URL`
- `REACT_APP_ENABLE_SOCKETS=true`

## 10.4 Post-Deploy Smoke Checklist

1. Backend `/api/health` returns healthy response.
2. Frontend loads without API base errors.
3. Admin login and OTP flow works.
4. Devices appear online when hardware connected.
5. New telemetry rows appear in DB.
6. Admin control command produces requestId and final state update.
7. Alert acknowledge/clear actions succeed.

## 10.5 Free-Plan CLI Limitation Note

If Render CLI is unavailable due to plan limitations:

- Use Render Dashboard manual deploy/redeploy.
- Use service event logs and environment panels for runtime validation.

---

## 11) End-to-End Live Demo Script (Presenter Checklist)

Use this when demonstrating to stakeholders/auditors.

## 11.1 Pre-Demo (15–30 min before)

1. Confirm backend and frontend health endpoints/pages.
2. Confirm both ESP32 nodes are online in dashboard.
3. Validate latest telemetry timestamp is current.
4. Pre-check admin credentials and OTP delivery path.
5. Verify at least one recent alert exists or can be simulated safely.

## 11.2 Demo Flow (Suggested 8–12 minutes)

1. **Architecture intro** (30–60 sec)
   - Explain ESP32 -> MQTT -> Backend -> DB -> Dashboard loop.
2. **User dashboard walkthrough**
   - Show live telemetry and daily summary.
   - Emphasize read-only safety for public users.
3. **Admin secure login**
   - Show role-protected access and OTP verification.
4. **Actuator command demo**
   - Toggle one valve ON then OFF.
   - Show pending requestId and confirmed state.
5. **Safety interlock demo** (if safe test setup available)
   - Simulate float LOW and show pump lock behavior.
   - Highlight `safety_override` message.
6. **Alerts flow**
   - Show recent alert, acknowledge, and clear workflow.
7. **Ops evidence**
   - Display DB rows updating (telemetry or command status).

## 11.3 Demo Success Criteria

- Realtime updates visible without page reload
- Command acknowledgement loop visibly completes
- Safety lockout behavior prevents unsafe pump state
- Role boundaries are clear (user vs admin)

---

## 12) Troubleshooting Matrix (Field + Cloud + UI)

## 12.1 Device Offline in Dashboard

Symptoms:

- `ESP32-A offline` or `ESP32-B offline`
- stale telemetry timestamps

Checks:

1. Device power and Wi-Fi credentials in firmware config.
2. MQTT broker reachability and credentials.
3. LWT topic events (`vermilinks/device_status/*`).
4. Backend logs for MQTT reconnect/errors.

Likely fixes:

- Correct Wi-Fi/MQTT credentials and redeploy firmware.
- Restore broker availability.
- Verify firewall/network egress rules.

## 12.2 Command Rejected with 409

Possible backend reasons:

- Another command pending (`A command is already pending confirmation.`)
- Float lockout (`Pump locked out due to low float sensor.`)

Actions:

1. Inspect pending command list in UI or DB.
2. Wait for/resolve in-flight command.
3. Resolve float LOW physical condition before pump ON retry.

## 12.3 Command Fails with 503 (Device Offline)

- Backend rejected because `devices.online` false.
- Restore ESP32-A connectivity first; then retry.

## 12.4 Telemetry Missing but Device Online

Checks:

1. Confirm ESP32-B publish interval still 5s.
2. Confirm backend subscribed to `vermilinks/esp32b/metrics`.
3. Verify payload shape and timestamp validity.
4. Check writes to `sensor_snapshots` and `sensordata`.

## 12.5 Realtime UI Not Updating

Checks:

1. `REACT_APP_ENABLE_SOCKETS=true`
2. Backend `SOCKETIO_CORS_ORIGINS` includes frontend domain
3. Browser console for socket connection errors
4. Backend socket logs for connect/disconnect churn

## 12.6 Excess Alerts or Alert Noise

Actions:

1. Review threshold config endpoints/settings.
2. Validate sensor calibration (soil dry/wet constants, sensor wiring).
3. Investigate unstable power/noisy analog lines.

## 12.7 Render Deployment Works but UI Points to Wrong API

Checks:

- `REACT_APP_API_URL`, `REACT_APP_BACKEND_URL`, `REACT_APP_WS_URL`

Fix:

- Update frontend env vars and redeploy static service.

---

## 13) Security and Access Control Operations

- Actuator control path is protected by auth + admin role + OTP verification.
- User dashboard is intentionally read-only.
- Token expiry/refresh handling is implemented in frontend API client.
- Rate limiters exist for login/OTP paths.

Operational practice:

- Rotate admin credentials periodically.
- Keep JWT and email credentials in secure Render env vars.
- Review auth and audit logs after sensitive operations.

---

## 14) Operator Acceptance Checklist (Go-Live Gate)

Use this as final sign-off:

1. Hardware wiring matches firmware pin maps exactly.
2. Float LOW condition verified to force pump OFF.
3. ESP32-A and ESP32-B publish online LWT on connect.
4. Backend health endpoint stable.
5. Telemetry visible in UI and persisted in DB.
6. Admin login + OTP verified.
7. Command -> ack -> state confirmation loop verified.
8. Alert creation + acknowledgement + clear tested.
9. Render env vars validated for frontend/backend CORS/socket/API alignment.
10. Demo script completed successfully end-to-end.

---

## 15) Operational References

Primary implementation references:

- `esp32/firmware_esp32a/src/config.h`
- `esp32/firmware_esp32a/src/main.cpp`
- `esp32/firmware_esp32a/src/mqtt_client.cpp`
- `esp32/firmware_esp32a/src/safety.cpp`
- `esp32/firmware_esp32b/src/config.h`
- `esp32/firmware_esp32b/src/main.cpp`
- `esp32/firmware_esp32b/src/mqtt_client.cpp`
- `backend/server.js`
- `backend/services/iotMqtt.js`
- `backend/services/iotCommandService.js`
- `backend/routes/iot.js`
- `backend/routes/alerts.js`
- `frontend/src/pages/UserDashboard.tsx`
- `frontend/src/pages/AdminDashboard.tsx`
- `frontend/src/components/ActuatorControls.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/services/iotControl.ts`
- `render.yml`

This runbook is implementation-grounded and intended for direct operator training and production support.
