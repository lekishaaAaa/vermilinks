<#
render_deploy.ps1

Usage (secure):
  - Create a Render API Key (Dashboard → Account → API Keys)
  - Run in PowerShell: $env:RENDER_API_KEY = 'your_key_here'; .\scripts\render_deploy.ps1

What this script does:
  - Checks for the Render CLI and offers install instructions
  - Logs in to Render using your API key (keeps the key local)
  - Imports the bundled Render config manifest into your Render account

Security: This script DOES NOT send your API key anywhere outside your machine. You run it locally to keep secrets private.

Note: If you prefer, run these steps manually in the Render UI (I can guide you interactively).
#>

param()

function Abort($msg){ Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host "Render deploy helper — will attempt to import the Render config into your Render account" -ForegroundColor Cyan

if (-not (Get-Command render -ErrorAction SilentlyContinue)) {
  Write-Host "Render CLI not found. Install options:" -ForegroundColor Yellow
  Write-Host "  npm: npm i -g @render/cli" -ForegroundColor Gray
  Write-Host "  or follow: https://render.com/docs/cli" -ForegroundColor Gray
  Write-Host "Please install the Render CLI, then re-run this script." -ForegroundColor Yellow
  exit 0
}

if (-not $env:RENDER_API_KEY) {
  Write-Host "Please set the environment variable RENDER_API_KEY before running this script." -ForegroundColor Yellow
  Write-Host "Example (PowerShell):`n  $env:RENDER_API_KEY = 'your_key_here'`n  .\scripts\render_deploy.ps1" -ForegroundColor Gray
  exit 0
}

Write-Host "Logging in to Render CLI using RENDER_API_KEY..." -ForegroundColor Cyan
# render login supports --api-key; if not available, this will fail and user should run `render login` interactively
$login = & render login --api-key $env:RENDER_API_KEY 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Render CLI login failed. Output:" -ForegroundColor Red
  Write-Host $login
  Abort "Login failed. Try running 'render login' interactively and ensure the CLI is installed."
}

Write-Host "Importing Render config manifest..." -ForegroundColor Cyan
# The Render CLI supports importing a manifest; if your CLI version doesn't, run the import in the web UI
$import = & render import render.yml 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "render import failed or is not supported by your CLI. Output:" -ForegroundColor Yellow
  Write-Host $import
  Write-Host "Fallback: open Render dashboard, import repo, and ensure the Render config is used (choose branch fix/contact-header-gap)." -ForegroundColor Gray
  exit 1
}

Write-Host "Render manifest imported. Check the Render dashboard to confirm services are creating." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - In Render dashboard, copy DATABASE_URL from the managed Postgres and set it in backend service env as DATABASE_URL." -ForegroundColor Gray
Write-Host "  - Add JWT_SECRET and any provider secrets (TWILIO, SMTP)." -ForegroundColor Gray
Write-Host "  - Watch the build logs; once backend & frontend are deployed, run seed script to create admin." -ForegroundColor Gray

Write-Host "To seed admin from your machine (after deploy and DATABASE_URL set):" -ForegroundColor Cyan
Write-Host "  $env:DATABASE_URL='<paste database url>' ; node backend/scripts/seed-admin.js" -ForegroundColor Gray

Write-Host "Done. If you want, paste the Render dashboard URLs and I will validate health endpoints for you." -ForegroundColor Green
