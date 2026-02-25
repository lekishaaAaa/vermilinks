c# BeanToBin Environmental Monitoring System

## 🚀 Quick Start

### Recommended: Use the Startup Script (Handles Everything Automatically)

```powershell
# Windows PowerShell - This script installs dependencies, builds frontend, starts services, and verifies health
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

This script will:
- Install backend and frontend dependencies if missing
- Build the frontend production bundle
- Start all services with PM2 (backend on port 5000, frontend on port 3002)
- Wait for services to be healthy
- Display status and access URLs

### Alternative: Manual PM2 Setup

```bash
# Install PM2 globally (one-time setup)
npm install -g pm2


# Start all services
pm2 start ecosystem.config.js

# View logs
pm2 logs
```

### "Unable to connect to server" Error
If you get connection errors when trying to sign in:

1. **Check if backend is running:**
   ```bash
   pm2 list
   # or
   curl http://localhost:5000/api/health
   ```

2. **Restart services:**
   ```bash
   pm2 restart all
   ```

3. **Check logs:**
   ```bash
   pm2 logs beantobin-backend
   ```

4. **Manual start (if PM2 not available):**
   ```bash
   cd backend
   node server.js
   ```

### Services Should Always Run On:
- **Frontend:** http://localhost:3002
- **Backend:** http://localhost:5000

## 🛡️ Preventive Measures

### 1. Use PM2 for Production-Ready Service Management
- PM2 automatically restarts crashed services
- Provides process monitoring and logging
- Better than direct `node` commands for development

### 2. Environment Variables
Ensure these are set in `backend/.env`:
```
PORT=5000
NODE_ENV=development
DATABASE_URL=postgres://...
# Optional overrides for the admin OTP flow (defaults shown)
ADMIN_OTP_TTL_MS=180000        # 3 minutes
```

### 3. Database Connection
The system uses PostgreSQL with SQLite fallback for development.

### 4. Admin Credentials
Admin authentication is being upgraded. Configure administrator accounts using the forthcoming email-based flow (Phase 2). Until then, seed credentials explicitly via environment variables when running local scripts.

## 📊 Monitoring

- **Health Check:** http://localhost:5000/api/health
- **PM2 Dashboard:** `pm2 monit`
- **Logs:** `pm2 logs`

## ♻️ Sensor Log Maintenance

Sensor telemetry grows quickly. Use the admin-only purge endpoint or the CLI helper to prune stale rows before storage fills up.

- **API (requires admin JWT):**
  ```bash
  curl -X DELETE https://<backend>/api/sensor-logs \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{
      "days": 30,
      "deviceId": "vermilinks-esp32",
      "dryRun": true
    }'
  ```
  - `days`: delete everything older than _N_ days (use `before` with an ISO timestamp for a precise cutoff).
  - Optional filters: `deviceId`, `sensor`, `origin`.
  - Add `dryRun: true` (or `dryRun=1` query param) to preview how many rows match before actually deleting.

- **CLI helper:** `node backend/scripts/purge-sensor-logs.js --days 45 --dry-run`
  - Supports the same filters (`--device`, `--sensor`, `--origin`).
  - Use `--before 2025-01-01T00:00:00Z` for a fixed cutoff instead of `--days`.
  - Schedule this script via cron/Task Scheduler to enforce rolling retention.

Editing individual log rows should be handled sparingly at the database level (e.g., Postgres `UPDATE sensor_logs SET value=... WHERE id=...`). For most cases pruning old data is safer and keeps disk usage predictable.

## 🔄 Development Workflow

1. Start services: `pm2 start ecosystem.config.js`
2. Check status: `pm2 list`
3. View frontend: http://localhost:3002/dashboard
4. Stop when done: `pm2 stop all`on<!-- Updated README for the Environmental Monitoring System (BeanToBin) -->
# VermiLinks — Environmental Monitoring System

**VermiLinks** (formerly BeanToBin) is a comprehensive IoT environmental monitoring platform designed for vermicomposting operations. It provides real-time sensor data collection, automated actuator control, and a modern admin dashboard with secure authentication.

## 🌟 Key Features

### Core Functionality
- **Real-time Sensor Monitoring**: Temperature, humidity, soil moisture, pH, EC, NPK
- **Automated Actuator Control**: Pump and solenoid valve management with safety interlocks
- **MQTT Telemetry Ingest**: Sensor data streamed directly from ESP32 devices
- **Secure Admin Dashboard**: OTP-based authentication with JWT token management
- **Data Export**: CSV reports with comprehensive sensor history
- **Realtime Updates**: WebSocket-powered live data broadcasting

### Security & Reliability
- **OTP Authentication**: Email-based one-time passwords for admin access
- **Token Lifecycle Management**: Automatic refresh with blacklist on logout
- **Rate Limiting**: Protected API endpoints with configurable limits
- **Input Validation**: Comprehensive data sanitization and validation
- **Audit Logging**: Complete action tracking and security event logging

### Deployment Ready
- **Multi-Platform Support**: Render, Railway, Docker, VPS
- **Production Database**: PostgreSQL with automatic migrations
- **Health Monitoring**: Built-in health checks and service monitoring
- **Auto-Scaling Ready**: Stateless architecture for horizontal scaling

### Hardware Integration
- **ESP32 Support**: Complete firmware and configuration for environmental sensors
- **Device Telemetry Ingest**: Sensor readings collected directly from ESP32 nodes
- **MQTT Broker Support**: MQTT connectivity for device telemetry
- **Alert Thresholds**: Configurable environmental monitoring thresholds

See the ESP32 firmware folders for device configuration details.

## 🚀 Quick Start

### Recommended: One-Click Render Deployment

1. **Deploy to Render** (Free Tier):
   - Fork this repository to GitHub
   - In Render: Blueprints → New Blueprint Instance
   - Select your fork and deploy
   - Services auto-configure with environment variables

2. **Post-Deploy Setup**:
   ```bash
   # Run in Render backend shell
   npm run migrate
   npm run seed-admin
   ```

3. **Access Your System**:
   - Frontend: `https://your-app.onrender.com`
   - Admin Login: `https://your-app.onrender.com/admin/login`
   - API Health: `https://your-backend.onrender.com/api/health`

### Local Development

```powershell
# Windows PowerShell - Automated setup
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

This script handles:
- Dependency installation
- Frontend build
- Service startup with PM2
- Health verification
- Access URL display

**Services run on:**
- Frontend: http://localhost:3002
- Backend: http://localhost:5000

## 🏗️ System Architecture

```
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   ESP32 Nodes │───▶│   VermiLinks    │───▶│   PostgreSQL    │
│   (Sensors)   │    │   Backend API   │    │   Database      │
└───────────────┘    │   • Express      │    └─────────────────┘
      │   • Socket.IO    │
      │   • Sequelize    │    ┌─────────────────┐
      │   • JWT + OTP    │    │   VermiLinks    │
      └─────────────────┘    │   Frontend      │
          ▲             │   • React        │
          └────────────▶│   • TypeScript   │
              │   • Tailwind     │
              └─────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Node.js + Express | REST API & WebSocket server |
| **Database** | PostgreSQL + Sequelize | Data persistence & migrations |
| **Frontend** | React + TypeScript | Admin dashboard & visualization |
| **Authentication** | JWT + OTP (Nodemailer) | Secure admin access |
| **Real-time** | Socket.IO | Live data broadcasting |
| **External** | MQTT Broker | Sensor telemetry ingestion |
| **Deployment** | Render/Docker | Production hosting |

## 🔐 Security Features

### Authentication Flow
1. **Admin Login**: Email + password → OTP sent via email
2. **OTP Verification**: Time-limited codes (3 minutes default)
3. **Token Issuance**: JWT access + refresh tokens
4. **Automatic Refresh**: Seamless token renewal
5. **Secure Logout**: Token blacklisting

### Security Measures
- **Password Hashing**: bcrypt with salt rounds
- **Token Encryption**: Strong JWT secrets required
- **CORS Protection**: Configured origins only
- **Input Sanitization**: All endpoints validated
- **Rate Limiting**: API protection against abuse
- **Audit Trails**: Complete action logging

## 📈 Monitoring & Analytics

### Health Checks
- **API Health**: `GET /api/health` - Service status
- **Database**: Connection and migration verification
- **WebSocket**: Real-time connection monitoring

### Data Export
- **CSV Reports**: Complete sensor history
- **Date Range Filtering**: Custom time periods
- **All Metrics**: Temperature, humidity, moisture, pH, EC, NPK

### Realtime Features
- **Live Updates**: WebSocket-powered data streaming
- **Toast Notifications**: Success/error feedback
- **Connection Status**: Visual connection indicators
- **Auto-Reconnect**: Robust WebSocket handling

## 🛠️ Development

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Docker)
- Git

### Local Setup
```bash
# Clone repository
git clone https://github.com/yourusername/vermilinks.git
cd vermilinks

# Install all dependencies
npm run install-all

# Start development services
powershell -ExecutionPolicy Bypass -File .\start-all.ps1

# Run tests
npm test

# Build frontend
cd frontend && npm run build
```

### Testing
```bash
# Backend tests
cd backend && npm test

# Integration tests
npm run test-integration

# Smoke test (end-to-end)
node scripts/smoke-test.js
```

### Code Quality
- **ESLint**: Code linting and formatting
- **Prettier**: Consistent code formatting
- **TypeScript**: Type safety and IntelliSense
- **Jest**: Unit and integration testing

## 🚀 Deployment Options

### Primary: Render (Recommended)
- **Free Tier**: Complete stack on free plans
- **Auto-Scaling**: Built-in scaling and monitoring
- **Managed Database**: PostgreSQL included
- **One-Click Deploy**: Blueprint-based deployment

### Alternatives
- **Railway**: Similar to Render with great DX
- **Docker**: Full containerization support
- **VPS**: Traditional server deployment
- **Fly.io**: Global edge deployment

See `docs/DEPLOY.md` for detailed deployment guides.

## 📚 Documentation

- **[Deployment Guide](docs/DEPLOY.md)**: Comprehensive deployment instructions
- **[API Documentation](docs/README.DEV.md)**: Backend API reference
- **[Testing Guide](docs/HOW_TO_TEST_BACKEND.md)**: Testing procedures
- **[System Validation](docs/SYSTEM_VALIDATION_REPORT.md)**: Architecture validation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with tests
4. Run tests: `npm test`
5. Commit and push: `git push origin feature/your-feature`
6. Open a Pull Request

### Development Guidelines
- Follow existing code style and patterns
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

### Common Issues
- **Connection Errors**: Check service status with `pm2 list`
- **Database Issues**: Verify `DATABASE_URL` and run migrations
- **Email Problems**: Check SMTP configuration and app passwords
- **HA Webhooks**: Verify HMAC secrets and webhook URLs

### Debug Tools
```bash
# Check service health
curl http://localhost:5000/api/health

# View PM2 logs
pm2 logs

# Run smoke test
node scripts/smoke-test.js

```

For additional help, check the troubleshooting sections in the deployment guide or create an issue in the repository.

- `backend/` — Node/Express API, Sequelize models, routes
- `frontend/` — React app (TypeScript), TailwindCSS, components and pages
- `esp32/` — ESP32 firmware (MQTT/HTTP) for sensors and actuators
- `scripts/` — Migration & helper scripts (seeding, smoke-tests, simulators)
- `docker-compose.yml` — Optional local stack (Postgres, etc.)
- `README.md` — This file

---

## High-level Overview

- Sensors (ESP32) collect Temperature, Humidity, Soil Moisture and pH (where supported).
- ESP32 devices POST sensor readings to the backend API; the backend stores and broadcasts data and raises alerts.
- The frontend provides an Admin dashboard (role-based access) and public dashboards for visualization, charts, and exports.
- A weather service (frontend-side) fetches Manila-only weather snapshots and produces realistic weather-derived sensor-like readings for correlation and analytics.

## Recent Key Changes

- pH support: `SensorData` now includes an optional `ph` field; UI charts and exports were updated to include pH.
  - New component: `frontend/src/components/charts/PhChart.tsx` — pH line chart.
  - `ChartContainer` now supports a `ph` chart type and renders `PhChart`.
  - CSV export in `AdminDashboard` includes a `ph` column.
- Weather integration changes:
  - Manila-only weather monitoring locations and a `getManilaWeatherSummary()` helper are implemented in `frontend/src/services/weatherService.ts`.
  - The Admin Dashboard `/admin/dashboard` has a `Load Weather` button which fetches and displays the Manila weather summary (Avg Temp, Avg Humidity, Avg Moisture, status, lastUpdated).
  - The Enhanced dashboard's separate weather snapshot was removed per recent UX requests; weather is now loaded via Admin only.

---

## Quick local setup

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL (local or Docker)
- (Optional) Twilio account for SMS alerts

### Recommended quick start (Windows)

1) From repository root install dependencies once:

```powershell
cd C:\xampp\htdocs\beantobin\system
npm run install-all
```

2) Start backend + frontend using the helper (waits for health checks):

```powershell
PowerShell -ExecutionPolicy Bypass -File .\start-all.ps1
```

- Backend health: http://127.0.0.1:5000/api/health
- Frontend: http://127.0.0.1:3000 (default; some dev setups use 3002)

3) Run the resilient smoke test (verifies actuator endpoints and DB logging):

```powershell
node .\scripts\smoke-test.js
```

Expected: the script logs in (uses dev admin), posts pump/valve commands, and verifies actuator logs. It will exit with code 0 on success.

4) Run a simulated device to test forwarding & ack behavior:

```powershell
# starts a simulator that registers as esp32-test-01
node backend\scripts\ws-device-sim.js ws://127.0.0.1:5000 esp32-test-01

# or register as the smoke device used by the smoke test
node backend\scripts\ws-device-sim.js ws://127.0.0.1:5000 smoke-sim-01
```

When a simulator is connected the actuator endpoints will return `forwarded: true` and the simulator will send `actuator:ack` messages.

---

## IoT integration guide

### ESP32 firmware setup

1. Use the firmware folders:
  - `esp32/firmware_esp32a` (actuators + float sensor)
  - `esp32/firmware_esp32b` (DHT22 + soil ADC + DS18B20)
2. Update the `config.h` placeholders with your Wi-Fi and MQTT credentials.
3. Build and flash using Arduino IDE or PlatformIO.

### Wiring reference

- **Power**: 5 V adapter into the ESP32 *VIN* pin and GND shared with all peripherals.
- **ESP32A actuators**: Pump GPIO5; valves GPIO25/26/27; float sensor GPIO14 (active-high).
- **ESP32B sensors**: DHT22 GPIO4; soil moisture ADC GPIO34; DS18B20 GPIO16.

### Field test plan

1. Open the Arduino Serial Monitor at 115200 baud and power the ESP32. Confirm Wi-Fi connection logs and HTTP 200 responses.
2. In the Render dashboard open the backend logs – each telemetry POST should create a row in the `sensordata` table (check via `npm run migrate && npm run db:console` locally if needed).
3. From the dashboard Solenoid Valve cards press **Turn ON/OFF** for each valve. A matching row should appear in `/api/command/status`, and Socket.IO updates should flip the badge in real time once the ESP32 acknowledges.
4. Trip the float sensor (LOW). All valves should immediately show OFF and new commands must fail with a float-sensor warning (check the command message).

### Deployment & troubleshooting notes

- Render’s Basic Postgres tier requires allow-listing outbound IPs. Fetch them with:

  ```powershell
  Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:RENDER_API_KEY" } \
    -Uri "https://api.render.com/v1/services/srv-d43v9q0dl3ps73aarv30/outboundIPs"
  ```

  Add each `outboundIPs[]` value with `/32` under **Render → vermilinks-db → Networking → Allowed inbound IPs**.
- Keep `DATABASE_URL` appended with `?sslmode=require`. The backend automatically applies `dialectOptions.ssl = { require: true, rejectUnauthorized: false }`.
- If Sequelize migrations fail on Render, run `npm run migrate` from the service shell after the allow list is updated.
- Socket.IO failures usually mean the browser is connecting to the wrong host. Confirm `REACT_APP_WS_URL` equals `wss://vermilinks-backend.onrender.com` (or the custom domain).
- Float sensor wiring now depends on GPIO5 — if valves remain disabled, verify the reed switch is pulled HIGH when water is present.

---

## Seeding admin user

To provision an admin account in development, supply credentials via environment variables and run the seed script manually:

```powershell
INIT_ADMIN_EMAIL=admin@example.com INIT_ADMIN_PASSWORD=ChangeMe node backend\scripts\seed-admin.js
```

> The seeder requires `INIT_ADMIN_EMAIL` and `INIT_ADMIN_PASSWORD` (or corresponding values in `backend/.env`). The old LOCAL_ADMIN_USER/PASS fallback has been removed.

---

## Auto-start on Windows (PM2)

We provide a PM2 ecosystem and a helper to register PM2 on Windows:

- `ecosystem.config.js` — defines processes: backend and two simulators (smoke and esp32-test-01)
- `scripts/pm2-windows-setup.ps1` — installs `pm2`, attempts to install `pm2-windows-startup`, starts the ecosystem, and saves the process list.

Usage (run as Administrator for the startup registration step):

```powershell
cd C:\xampp\htdocs\beantobin\system
.\scripts\pm2-windows-setup.ps1

# Check pm2 status
pm2 list
pm2 logs btb-backend
```

Notes:
- If `pm2-startup` registration fails, run `pm2-startup install` manually as Administrator.
- Alternative: use NSSM to register Node scripts as native Windows services — tell me if you prefer that and I will add NSSM helpers.

---

## Docker / Production


### Render Deployment (Free Tier, VermiLinks.com)

The repository includes a Render blueprint tuned for the ESP32-only VermiLinks stack. It provisions three free-tier services: `vermilinks-backend` (Node), `vermilinks-frontend` (static site), and `vermilinks-db` (managed PostgreSQL).

1. Commit and push your changes to the branch Render will track (recommended: `main`).
2. In Render, choose **Blueprints → New Blueprint Instance** and select this repository.
3. Confirm the generated resources match the Render config file:
  - `vermilinks-backend` (plan `free`, rootDir `backend`, health path `/api/health`).
  - `vermilinks-frontend` (plan `free`, rootDir `frontend`, publish path `build`).
  - `vermilinks-db` (plan `free`).
4. Populate backend environment variables under **vermilinks-backend → Environment** (values mirror `backend/.env.example`):
  - `JWT_SECRET=<strong-random-secret>`
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=587`
  - `EMAIL_USER=<smtp-user>`
  - `EMAIL_PASS=<smtp-app-password>`
  - `EMAIL_FROM="VermiLinks <no-reply@yourdomain.com>"`
  - `CORS_ORIGINS=https://vermilinks.com,https://www.vermilinks.com`
  - `SOCKETIO_CORS_ORIGINS=https://vermilinks.com,https://www.vermilinks.com`
  - `ESP32_URL=https://api.vermilinks.com/api/esp32`
  - `ESP32_COMMAND_TIMEOUT_MS=5000`
  - `INIT_ADMIN_EMAIL=<your-admin-email>`
  - `INIT_ADMIN_PASSWORD=<your-admin-password>`
5. Populate frontend variables under **vermilinks-frontend → Environment**:
  - `REACT_APP_API_URL=https://api.vermilinks.com/api`
  - `REACT_APP_WS_URL=wss://api.vermilinks.com`
6. Deploy the blueprint. Once the backend is live, open a shell for `vermilinks-backend` and run:

  ```bash
  npm run migrate
  npm run seed-admin
  ```

7. Verify `https://api.vermilinks.com/api/health` returns `{ "status": "ok" }`, then log in at `https://vermilinks.com/admin/login` using your configured admin credentials.

- Render automatically wires `DATABASE_URL` from `vermilinks-db`; no manual secret is needed for the connection string.
- All resources stay on the free plan so the deployment runs at $0/month (services auto-sleep when idle).

Recommended quick production flows:

- Render: import the repo in the Render dashboard (config file included). Set `DATABASE_URL` and `JWT_SECRET` in the Render environment and deploy.
- VPS with Docker Compose: use `docker-compose.prod.yml` and `.env.production` on the server. See `DEPLOY.md` for step-by-step instructions in the repo.

---

## Developer & debug tools

- `start-all.ps1` — unified local start helper (PowerShell) for backend + frontend.
- `scripts/smoke-test.js` — resilient smoke test that logs in (admin fallback), posts actuator commands and checks logs.
- `backend/scripts/ws-device-sim.js` — WebSocket device simulator that registers and ACKs commands.
- `scripts/render_deploy.ps1` — helper to import the Render config using the Render CLI (keeps API key local).

---rnu

## Troubleshooting

- Health check fails (DB unavailable): check Postgres is running and `DATABASE_URL` is correct.
- Ports in use: the backend attempts alternate ports if the configured port is busy; inspect logs for `EADDRINUSE` diagnostics.
- npm install issues (private registry): ensure `npm config get registry` is `https://registry.npmjs.org/`.
- Render CLI `@render/cli` install fails in restricted networks — use the Render web UI import instead.

---

## Onboarding Tour (guided walkthrough)

This project includes a lightweight guided onboarding tour to help first-time users discover key features.

Where it lives

- Frontend component: `frontend/src/components/OnboardingTour` — a small wrapper around `intro.js`.
- Tour steps config: `frontend/src/components/OnboardingTour/tourConfig.ts` — a simple array of steps.

How it works

- The tour automatically runs only for first-time visitors. A flag is stored in `localStorage` under the key `onboarding_seen` after completion or skip.
- The tour is integrated at the top-level `App` component so it can highlight elements across routes.

Configuring & extending steps

1. Open `frontend/src/components/OnboardingTour/tourConfig.ts`.
2. Add or remove step objects. Each step has the shape: `{ element?: string, title?: string, intro: string }`.
  - `element` is a CSS selector (e.g. `'#admin-access-btn'` or `'nav'`). If omitted, a center modal step is shown.
  - `title` is optional and shown above the content.
  - `intro` is the short description shown in the tooltip.

Example step:

```ts
{ element: '#actuator-controls', title: 'Actuator Controls', intro: 'Open the actuator panel to manually operate devices.' }
```

Controlling when the tour runs

- The tour reads/writes `localStorage.onboarding_seen`. To force the tour to show again during development, run in the browser console:

```js
localStorage.removeItem('onboarding_seen');
window.location.reload();
```

Custom storage key

- The `OnboardingTour` component accepts a `storageKey` prop if you need a different key (e.g., per-user keys).

Library choice

- We use `intro.js` (framework-agnostic) to remain compatible with the project's React version. This keeps the integration minimal and easy to maintain.


---

## Useful commands (copy/paste)

- Start services (PowerShell helper):
  - `PowerShell -ExecutionPolicy Bypass -File .\start-all.ps1`
- Run smoke test locally:
  - `node scripts/smoke-test.js`
- Start a device simulator (registers on WS):
  - `node backend\scripts\ws-device-sim.js ws://127.0.0.1:5000 smoke-sim-01`
- Install and run PM2 ecosystem (Administrator):
  - `.\scripts\pm2-windows-setup.ps1`

---

If you want, I can also add a short `README-DEPLOY.md` tailored to a chosen hosting provider (Render, Railway, or a one-liner VPS script with Let's Encrypt). Tell me which target you prefer and I'll add it.

---

## Screenshots & assets

Add actual screenshots to `screenshots/` or `frontend_design_bundle/` and update the image paths above. Optimized PNGs (under 500 KB) are recommended for repo storage.

---

## Contributing

Thanks for your interest in contributing! A few quick guidelines:

1. Fork the repository and create a feature branch from `main` (or from your working branch): `git checkout -b feature/your-change`
2. Add tests for changes where appropriate. Keep changes focused and documented.
3. Make small, well-scoped commits and push your branch to your fork.
4. Open a Pull Request describing the change and link related issues. CI will run on the PR.

If you want to contribute infrastructure changes (Docker/Render), include clear deploy notes and a rollback plan in the PR description.

---

## License

This project is licensed under the MIT License — see the `LICENSE` file for details.

---

Last saved commit: see Git HEAD in this branch. For any environment-specific help (Render import, VPS bootstrap, or Windows service via NSSM), tell me which you prefer and I will prepare the exact, tested steps.
