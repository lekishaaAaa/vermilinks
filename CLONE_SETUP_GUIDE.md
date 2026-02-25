# 🚀 BeanToBin Environmental Monitoring System - Clone & Setup Guide

## Prerequisites (Install on New Device)

### 1. Install Git
```bash
# Windows (via Chocolatey)
choco install git

# macOS
brew install git

# Ubuntu/Debian
sudo apt update && sudo apt install git
```

### 2. Install Node.js (v18+)
```bash
# Windows (via Chocolatey)
choco install nodejs

# macOS
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Install PostgreSQL (Optional - for production)
```bash
# Windows
# Download from: https://www.postgresql.org/download/windows/

# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
```

---

## 📥 Clone the Repository

### Option 1: HTTPS Clone (Recommended)
```bash
git clone https://github.com/lekisyaaAaa/initialb2b.git beantobin-system
cd beantobin-system
```

### Option 2: SSH Clone (if you have SSH keys set up)
```bash
git clone git@github.com:lekisyaaAaa/initialb2b.git beantobin-system
cd beantobin-system
```

---

## 🔧 Initial Setup

### 1. Install Dependencies
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Environment Configuration
```bash
# Copy environment files
cp backend/.env.example backend/.env
cp .env.example .env

# Edit the .env files with your configuration
# notepad backend/.env  # Windows
# nano backend/.env     # Linux/Mac
```

### 3. Database Setup
```bash
# For development (SQLite - no setup needed)
# The system will create database files automatically

# For production (PostgreSQL)
# Create database and user, then update .env with credentials
```

---

## 🚀 Quick Start

### Option 1: Using PM2 (Recommended for Production)
```bash
# Install PM2 globally
npm install -g pm2

# Start all services
pm2 start ecosystem.config.js

# Check status
pm2 list

# View logs
pm2 logs

# Stop services
pm2 stop all
```

### Option 2: Manual Startup (Development)
```bash
# Terminal 1: Start Backend
cd backend
npm run dev

# Terminal 2: Start Frontend
cd frontend
npm start
```

### Option 3: Using the Startup Script (Windows)
```powershell
# Run the automated startup script
.\start-all.ps1
```

---

## 🌐 Access the Application

Once running, access your system at:
- **Frontend Dashboard**: http://localhost:3002
- **Backend API**: http://localhost:5000
- **API Health Check**: http://localhost:5000/api/health

### Default Login Credentials:
- **Admin**: `admin` / `admin123`
- **User**: `user` / `user123`

---

##  System Features Included

✅ **Complete Environmental Monitoring System**
- Real-time sensor data collection
- Admin dashboard with device management
- Alert system with notifications
- User management and authentication
- Charts and analytics
- Dark mode support
- Responsive design

✅ **Production Ready**
- PM2 process management
- Docker support
- PostgreSQL database
- Error handling and logging

---

## 🐛 Troubleshooting

### Common Issues:

**Port Already in Use:**
```bash
# Kill processes on ports
npx kill-port 3002 5000

# Or find and kill specific processes
netstat -ano | findstr :3002
taskkill /PID <PID> /F
```

**Database Connection Issues:**
- Check PostgreSQL is running
- Verify credentials in `.env`
- For SQLite, ensure write permissions

**Build Errors:**
```bash
# Clear caches and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Permission Errors (Linux/Mac):**
```bash
# Fix permissions
sudo chown -R $USER:$USER .
chmod +x start-all.ps1  # Even on Linux/Mac for compatibility
```

---

## 📁 Project Structure

```
beantobin-system/
├── backend/                 # Node.js/Express API server
│   ├── models/             # Database models
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic
│   └── data/               # SQLite databases
├── frontend/               # React dashboard
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/         # Dashboard pages
│   │   ├── services/      # API clients
│   │   └── contexts/      # React contexts
├── esp32/                  # ESP32 firmware
├── docs/                   # Documentation
├── scripts/                # Utility scripts
└── *.md                    # Setup guides
```

---

## 🔄 Updating from Repository

To get latest changes on any device:

```bash
cd beantobin-system
git pull origin fix/contact-header-gap
npm install  # If dependencies changed
```

---

## 📞 Support

If you encounter issues:
1. Check the logs: `pm2 logs`
2. Verify environment variables in `.env`
3. Ensure all prerequisites are installed
4. Check the troubleshooting section above

The system is fully functional and ready to use! 🎉