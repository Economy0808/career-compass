# One-shot recovery for the local Firebase emulator dataset.
# Usage (from repo root or backend/):
#   powershell -File backend/scripts/restore_emulator.ps1            # reload 7,109 courses only
#   powershell -File backend/scripts/restore_emulator.ps1 -Backup    # export current emulator state to data/emulator-backup
#
# Why this exists: the emulator stores everything in memory. If it restarts
# without --import, ALL data (courses, accounts, posts) is silently gone and
# generation jobs then emit zero course clusters. Recommended emulator start:
#   firebase emulators:start --import=data/emulator-backup --export-on-exit=data/emulator-backup
# (ASCII only - Korean comments break locale-based parsers on Windows.)

param([switch]$Backup)

$ErrorActionPreference = "Stop"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $repo

if ($Backup) {
  firebase --project demo-ourlab emulators:export data/emulator-backup --force
  exit $LASTEXITCODE
}

$env:FIRESTORE_EMULATOR_HOST = "localhost:8080"
$env:FIRESTORE_PROJECT_ID = "demo-ourlab"
$env:PYTHONUTF8 = "1"

$json = Join-Path $repo "data/courses-2026.json"
if (-not (Test-Path $json)) {
  Write-Host "data/courses-2026.json missing - parsing from Downloads TXT..."
  $dl = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
  $a = Get-ChildItem "$dl\*2026*교과과정*.txt" | Select-Object -First 1
  $b = Get-ChildItem "$dl\*2026*개요*.txt" | Select-Object -First 1
  if (-not $a -or -not $b) { Write-Error "source TXT files not found in Downloads"; exit 1 }
  & backend/.venv/Scripts/python.exe backend/scripts/parse_courses.py $a.FullName $b.FullName $json
}

& backend/.venv/Scripts/python.exe backend/scripts/load_courses.py $json data/courses-2026-load-report.txt
Write-Host "Done. Restart the backend afterwards - the taxonomy cache is process-level."
