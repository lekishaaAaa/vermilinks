# VermiLinks End-to-End Production Readiness Audit (2026-02-24)

Scope: firmware (ESP32A + ESP32B) → MQTT broker/LWT → backend ingest/auth → PostgreSQL storage/query paths → frontend UX/role gates → Render deployment/env contract.

Policy constraints enforced in this audit:
- ESP32-only stack (no Home Assistant dependency, no RS485 dependency).
- Zero skipped layers.
- GPIO safety review for ESP32 DevKit V1 30-pin.

---

## 1) Executive Verdict

Status: **CONDITIONALLY READY**

What is complete in code:
- LWT topics and backend presence handling are aligned for `esp32a` and `esp32b`.
- ESP32B firmware now supports required sensor topology (2x DHT22, 4x soil ADC1, up to 4x DS18B20 on shared bus).
- Admin-only actuator UI routes are enforced in frontend router.
- Calendar daily readings flow is implemented in user dashboard using `/api/sensors/daily`.
- Excel/PDF export actions are exposed in active Admin UI.
- Render env contract updated for frontend/backend URL and MQTT broker linkage.
- Backend sensor route compile error fixed.

What remains mandatory to claim full production-ready:
- Live hardware verification run (power-on, broker, dashboard state transitions).
- Live DB query evidence from the deployed database.
- Final Render deploy smoke checks with real env values.

---

## 2) Firmware + GPIO Validation (Final Approved Pin Tables)

### ESP32A (Actuators + Float + Status)

| Function | Pin | Validation |
|---|---:|---|
| Float switch input | GPIO32 | ADC1-capable, input-safe, not boot strap pin |
| Pump control output | GPIO18 | Output-capable, not input-only, not boot strap pin |
| Solenoid valve 1 | GPIO25 | Output-capable, not boot strap pin |
| Solenoid valve 2 | GPIO26 | Output-capable, not boot strap pin |
| Solenoid valve 3 | GPIO27 | Output-capable, not boot strap pin |
| Status LED | GPIO13 | Output-capable, acceptable for indicator |

Validation outcome:
- No boot conflict pins used from restricted set (0, 2, 12, 15).
- No input-only pin is used as output.
- No duplicate assignments.
- Float logic uses pull-up semantics (`INPUT_PULLUP`, LOW = low-water).

### ESP32B (Sensors + Status)

| Function | Pin | Validation |
|---|---:|---|
| DHT22 #1 data | GPIO16 | Digital IO-safe, not boot strap pin |
| DHT22 #2 data | GPIO17 | Digital IO-safe, not boot strap pin |
| Soil analog #1 | GPIO32 | ADC1 (valid with Wi-Fi) |
| Soil analog #2 | GPIO33 | ADC1 (valid with Wi-Fi) |
| Soil analog #3 | GPIO34 | ADC1 input-only (correct for analog input) |
| Soil analog #4 | GPIO35 | ADC1 input-only (correct for analog input) |
| DS18B20 one-wire bus | GPIO18 | Digital IO-safe for one-wire bus |
| Status LED | GPIO13 | Output-capable indicator pin |

Validation outcome:
- Soil analog channels are ADC1-only (no ADC2 usage).
- No boot conflict pins used from restricted set (0, 2, 12, 15).
- No duplicate assignments.
- Input-only pins (34/35) are used only as inputs.

### Required external circuitry (hard requirement)

- DHT22: 10kΩ pull-up from each DATA line to 3.3V.
- DS18B20 bus: 4.7kΩ pull-up from one-wire DATA to 3.3V.
- Pump and solenoids: **must be driven via relay/MOSFET driver stage**, never directly from ESP32 GPIO.
- Inductive load protection: flyback diode/snubber per actuator channel as applicable.

---

## 3) MQTT + Presence + LWT Audit

Expected LWT topics:
- `vermilinks/device_status/esp32a`
- `vermilinks/device_status/esp32b`

Expected payloads:
- `online`
- `offline`

Backend handling:
- LWT payload parser maps topics to `esp32a`/`esp32b` and updates device status snapshot.
- Presence fields (`online`, `last_seen`) are updated via device manager/status flow.

Result:
- Code path is consistent with required online/offline dashboard status behavior.

---

## 4) Backend/Database Audit

### Access control and control path

- Actuator control endpoint remains protected with auth + admin-only + OTP middleware.
- User path cannot perform actuator control through intended API route.

### Daily readings path

- `/api/sensors/daily` is public read-only to support calendar UI consumption.

### Data persistence expectations

- Sensor telemetry: `sensordata` + snapshot table updates.
- Device presence: `devices.online`, `devices.last_seen`, `devices.updated_at`.
- Alerts/log paths remain available for dashboard notifications/history.

### SQL verification pack (run in Postgres)

#### A) Device presence schema + values

```sql
-- 1) Confirm required presence columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'devices'
  AND column_name IN ('online', 'last_seen', 'updated_at');

-- 2) Live presence snapshot
SELECT "deviceId" AS device_id, status, online, last_seen, updated_at
FROM devices
ORDER BY updated_at DESC NULLS LAST
LIMIT 20;
```

#### B) Presence transition proof after power-cycle

```sql
-- Run after ESP32 restart / broker reconnect
SELECT "deviceId" AS device_id,
       status,
       online,
       last_seen,
       updated_at
FROM devices
WHERE "deviceId" IN ('esp32a', 'esp32b')
ORDER BY updated_at DESC;
```

#### C) Telemetry write proof

```sql
SELECT device_id, temperature, humidity, moisture, soil_temperature, timestamp
FROM sensor_snapshots
ORDER BY timestamp DESC
LIMIT 20;

SELECT "deviceId" AS device_id, temperature, humidity, moisture, soil_temperature, timestamp
FROM sensordata
ORDER BY timestamp DESC
LIMIT 50;
```

#### D) History endpoint coverage data

```sql
SELECT "deviceId" AS device_id,
       COUNT(*) AS points,
       MIN(timestamp) AS oldest,
       MAX(timestamp) AS newest
FROM sensordata
GROUP BY "deviceId"
ORDER BY newest DESC;
```

#### E) Alerts persistence

```sql
SELECT id, message, severity, status, "createdAt", "resolvedAt"
FROM alerts
ORDER BY "createdAt" DESC
LIMIT 50;
```

---

## 5) Frontend Audit

Implemented and verified in code:
- Admin route hardening: admin pages require admin-only protection.
- User dashboard daily calendar integration is wired to `/sensors/daily`.
- Export actions (Excel/PDF) are active in Admin dashboard controls.
- Removed stale Home Assistant fallback token from active admin logic.

Behavior expectation:
- Admin can control actuators (with backend auth/role/OTP).
- User can view readings/calendar but cannot invoke admin control flows.

---

## 6) Render Deployment Audit

Updated env contract:
- Backend:
  - `FRONTEND_URL`
  - `MQTT_BROKER_URL`
- Frontend:
  - `REACT_APP_BACKEND_URL`
  - `REACT_APP_ENABLE_SOCKETS=true`

Required production alignment checklist:
- Backend `CORS_ORIGINS` includes frontend domain.
- Backend `SOCKETIO_CORS_ORIGINS` includes frontend domain.
- Frontend API/WS env values point to backend service URL.
- Backend broker credentials and broker URL are present and valid.

---

## 7) Home Assistant / RS485 Compliance Check

- No Home Assistant dependency required for core ESP32 MQTT telemetry/control flow.
- No RS485 requirement in corrected architecture path.
- Core operation remains standalone MQTT + backend + frontend.

---

## 8) Exact Corrective Changes Applied

Firmware:
- `esp32/firmware_esp32a/src/config.h`
- `esp32/firmware_esp32a/src/mqtt_client.cpp`
- `esp32/firmware_esp32b/src/config.h`
- `esp32/firmware_esp32b/src/sensors.cpp`
- `esp32/firmware_esp32b/src/sensors.h`
- `esp32/firmware_esp32b/src/mqtt_client.cpp`

Backend:
- `backend/routes/sensors.js` (daily endpoint access + syntax fix in telemetry POST handler)
- `backend/.env.example`

Frontend:
- `frontend/src/App.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/pages/UserDashboard.tsx`
- `frontend/src/pages/AdminDashboard.tsx`

Deploy:
- `render.yml`

---

## 9) Final Go/No-Go Gate

Go to production only after these are attached as evidence:
1) Broker logs showing `online/offline` LWT events for both `esp32a` and `esp32b`.
2) SQL output proving `devices.online` and `last_seen` updates on reconnect.
3) Live dashboard screenshot/video showing:
   - online status changes,
   - incoming telemetry,
   - user calendar daily data,
   - admin-only control access,
   - export buttons functioning.
4) Render health checks green for backend + frontend with correct env values.

Without those runtime proofs, readiness remains **conditionally ready** (code-correct, runtime-unproven).
