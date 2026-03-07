# BeanToBin Environmental Monitoring System - Quick Start Guide

This guide will get your entire environmental monitoring system up and running with no issues or errors.

## Prerequisites

- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
- **Docker Desktop** - For PostgreSQL database (download from [docker.com](https://www.docker.com/products/docker-desktop))
- **Git** - For cloning the repository
- **PowerShell** (Windows) or Terminal (macOS/Linux)

## 🚀 One-Command Setup (Recommended)

If you have Docker running, use this single command to start everything:

```powershell
# Windows PowerShell
cd C:\xampp\htdocs\beantobin\system
docker-compose up -d db
npm run install-all
node backend\scripts\sync_models.js
node backend\scripts\seed-admin.js
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

## 📋 Step-by-Step Setup

### Step 1: Clone and Navigate to Project

```powershell
cd C:\xampp\htdocs\beantobin\system
```

### Step 2: Start PostgreSQL Database

```powershell
# Start the database in background
docker-compose up -d db

# Wait a moment, then verify it's running
docker ps
```

You should see a `postgres:15-alpine` container running on port 5075.

### Step 3: Install Dependencies

```powershell
# Install all dependencies (backend + frontend)
npm run install-all
```

This runs:
- `npm install` in backend/
- `npm install` in frontend/

### Step 4: Initialize Database

```powershell
# Sync database models (create tables)
node backend\scripts\sync_models.js

# Create admin user
node backend\scripts\seed-admin.js
```

### Step 5: Start All Services

```powershell
# Start backend and frontend with PM2
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

This script will:
- Start the backend API on port 5000
- Start the frontend on port 3002
- Wait for services to be healthy
- Display status information

### Step 6: Verify Everything Works

1. **Check service status:**
   ```powershell
   pm2 list
   ```

2. **Check logs if needed:**
   ```powershell
   pm2 logs
   ```

3. **Test backend health:**
   - Open http://localhost:5000/api/health in your browser
   - Should return: `{"status":"ok","message":"Server is running"}`

4. **Test frontend:**
   - Open http://localhost:3002 in your browser
   - Should load the dashboard

5. **Admin access:** Configure administrator accounts manually using the new Admin model (see Phase 1 notes) until the email-based authentication flow is finalized.

## 🔧 Manual Troubleshooting

### If Database Connection Fails

```powershell
# Check if PostgreSQL is running
docker ps

# Check database logs
docker logs beantobin-db-1

# Reset database if needed
docker-compose down -v
docker-compose up -d db
```

### If Services Won't Start

```powershell
# Kill any existing processes
pm2 kill

# Clean restart
pm2 start ecosystem.config.js
```

### If Frontend Build Fails

```powershell
cd frontend
npm install
npm run build
```

### Environment Variables

The system uses these key environment variables (already configured in `backend/.env`):

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: For authentication tokens
- `PORT`: Backend port (5000)
- `CORS_ORIGINS`: Allowed frontend URLs

## 🛑 Stopping the System

```powershell
# Stop all services
pm2 stop all

# Stop database
docker-compose down

# Remove database data (if needed)
docker-compose down -v
```

## 📊 System Architecture

- **Backend API**: http://localhost:5000
  - REST endpoints for sensor data, users, alerts
  - WebSocket server for real-time device communication
  - PostgreSQL database with Sequelize ORM

- **Frontend Dashboard**: http://localhost:3002
  - React + TypeScript + TailwindCSS
  - Real-time charts and monitoring
  - Admin/user role-based access

- **Database**: PostgreSQL on port 5075
  - Stores users, sensor data, alerts, device info

- **Telemetry Source**: Real ESP32 devices via HiveMQ Cloud MQTT
- Backend ingests device telemetry and stores latest values in PostgreSQL

## 🧪 Testing the System

### Run Integration Tests

```powershell
# Smoke test (verifies actuator endpoints)
npm run smoke

# UI login test
npm run smoke-ui
```

### Manual Testing

1. **Login** to the frontend dashboard
2. **View sensor data** - Should show real telemetry from ESP32 devices
3. **Test actuators** - Use admin controls to send pump/valve commands
4. **Check alerts** - System should generate alerts based on thresholds

## 🚀 Production Deployment

For production deployment, see:
- `docker-compose.prod.yml` - Full containerized setup
- `docs/README.DEV.md` - Detailed deployment guide
- Render config file - Render.com deployment configuration

## 📞 Support

If you encounter issues:
1. Check the logs: `pm2 logs`
2. Verify database: `docker ps`
3. Restart services: `pm2 restart all`
4. Check this guide's troubleshooting section

The system is now ready for development and testing!