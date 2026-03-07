# System Flow Overview

The diagram below summarizes the major runtimes, data flows, and orchestration scripts for the BeanToBin monitoring platform.

```mermaid
flowchart TD
    subgraph Client
        A[Admin / Operator
Web Browser]
    end

    subgraph PM2[PM2 start-all.ps1]
        B[Frontend SPA
React
btb-frontend @3002]
        C[Backend API
Express + Socket.IO
btb-backend @5000]
    end

    subgraph Data[Persistent Storage]
        F[(PostgreSQL 15
Docker container
system-db-1 @5075)]
    end

    subgraph Aux[Supporting Jobs]
        G[Sensor Poller
RUN_POLLER=true]
        H[Seeding Scripts
sync_models.js
seed-admin.js]
    end

    subgraph Devices[Physical Devices]
        I[ESP32 Hardware]
        J[Field Sensors
(temperature, humidity,
moisture)]
    end

    subgraph Broker[MQTT Broker]
        L[HiveMQ Cloud
mqtts:8883]
    end

    subgraph External[Automation / Tooling]
        K[docker-compose up db]
    end

    A -->|HTTPS 3002| B
    B -->|REST /api/*| C
    B <-->|Socket.IO events| C

    C -->|Sequelize ORM
read/write| F
    H -->|Schema sync + admin seed| F
    H -->|Invoked manually
pre-start| C

    I -->|Sensor payload| J
    I -->|Publish telemetry/state| L
    L -->|MQTT topics vermilinks/+/telemetry| C
    C -->|Device commands| L

    G -->|Internal HTTP + services| C

    K -->|Launch container| F

    PM2 -. supervises .-> C
    PM2 -. supervises .-> B
```

## Notes
- `start-all.ps1` wraps PM2 to launch backend and frontend processes.
- PostgreSQL runs inside Docker (`docker-compose up db`); all Sequelize connections use port `5075`.
- Telemetry source is real ESP32 hardware publishing to HiveMQ Cloud; backend ingestion runs through the `iotMqtt` client.
- The optional sensor poller (`RUN_POLLER=true`) runs inside the backend process to ingest data from external services.
- Production deployments should keep telemetry strictly MQTT-based from physical devices.