# One-command local startup for OurLab.
# Usage (from repo root):  powershell -File scripts/start-dev.ps1
#
# Starts, in order: Postgres (docker), Firebase emulators (WITH import/export so demo
# data survives a restart), backend API, frontend dev server. Each long-running piece
# opens in its own window so you can read its log and close it independently.
#
# Why the emulator flags matter: the emulator keeps everything in memory. Started
# without --import it comes up EMPTY (all demo accounts, posts, notes, and the 7,109
# course catalog gone); without --export-on-exit anything you do today is lost on close.
# Data lives in data/emulator-backup. To take a manual snapshot at any time:
#   powershell -File backend/scripts/restore_emulator.ps1 -Backup
# (ASCII only - Korean comments break locale-based parsers on Windows.)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Start-InWindow([string]$title, [string]$command) {
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-NoProfile", "-Command",
    "`$host.UI.RawUI.WindowTitle = '$title'; Set-Location '$repo'; $command"
  )
  Write-Host "  started: $title"
}

# 1) Postgres - only the schedule (todos) feature needs it.
Write-Host "[1/4] Postgres (docker)..."
$dockerUp = $false
try {
  docker ps > $null 2>&1
  $dockerUp = ($LASTEXITCODE -eq 0)
} catch { $dockerUp = $false }
if ($dockerUp) {
  Push-Location backend
  docker compose up -d | Out-Null
  Pop-Location
  Write-Host "  ok"
} else {
  Write-Host "  SKIPPED - Docker Desktop is not running. Start it, then run:"
  Write-Host "    cd backend; docker compose up -d"
  Write-Host "  (only the schedule tab needs this; everything else works without it)"
}

# 2) Firebase emulators - import existing data, export on close.
Write-Host "[2/4] Firebase emulators (import + export-on-exit)..."
if (-not (Test-Path "data/emulator-backup")) {
  Write-Error "data/emulator-backup is missing - cannot start with --import. Restore it from git or reseed."
  exit 1
}
Start-InWindow "ourlab-emulators" "firebase --project demo-ourlab emulators:start --import=data/emulator-backup --export-on-exit=data/emulator-backup"

# The backend needs Firestore answering, so wait for the port before starting it.
Write-Host "  waiting for Firestore on 8080..."
$ready = $false
foreach ($i in 1..60) {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -Uri "http://localhost:8080/" -TimeoutSec 2 -UseBasicParsing > $null
    $ready = $true
    break
  } catch { }
}
if ($ready) { Write-Host "  ok" } else { Write-Host "  WARNING: emulator did not answer in 120s - check its window before using the app" }

# 3) Backend API (real LLM). Note: no --reload; Windows uvicorn reload does not pick up
#    edits reliably here, so restart this window after changing backend code.
Write-Host "[3/4] Backend API on 8000..."
Start-InWindow "ourlab-backend" "`$env:FIREBASE_AUTH_EMULATOR_HOST='localhost:9099'; `$env:FIRESTORE_EMULATOR_HOST='localhost:8080'; `$env:FIRESTORE_PROJECT_ID='demo-ourlab'; Set-Location backend; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"

# 4) Frontend.
Write-Host "[4/4] Frontend on 3000..."
Start-InWindow "ourlab-frontend" "Set-Location frontend; npm run dev"

Write-Host ""
Write-Host "Open http://localhost:3000 once the frontend window says 'Ready'."
Write-Host "Demo accounts (password: observatory123!):"
Write-Host "  test-observer@yonsei.ac.kr    verified"
Write-Host "  demo-analyst@yonsei.ac.kr     verified"
Write-Host "  demo-unverified@example.com   NOT yonsei-verified (use this to check the blocked screens)"
Write-Host ""
Write-Host "Close the emulator window last - that is when it writes data/emulator-backup."
