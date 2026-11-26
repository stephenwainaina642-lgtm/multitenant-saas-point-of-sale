# Windows backup of the nexaPOS database (works on the free Supabase plan, which has no automatic backups).
# Needs the PostgreSQL command-line tools (pg_dump, pg_restore) on PATH.
# Usage (PowerShell, in the backend folder):
#   $env:DATABASE_URL = Read-Host "Paste DATABASE_URL"   # typed locally, never into chat, never saved to a file
#   .\scripts\backup.ps1
param([string]$Dir = (Join-Path $HOME "nexapos-backups"), [int]$Keep = 14)
if (-not $env:DATABASE_URL) { throw "DATABASE_URL is not set in this PowerShell window." }
New-Item -ItemType Directory -Force $Dir | Out-Null
$file = Join-Path $Dir ("nexapos-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".dump")
pg_dump --format=custom --no-owner --no-privileges --file=$file $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) { Remove-Item $file -ErrorAction SilentlyContinue; throw "pg_dump failed. Nothing was saved." }
pg_restore --list $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The backup file could not be read back. Do not rely on it: $file" }
Write-Host ("Backup saved and checked: {0} ({1:N1} MB)" -f $file, ((Get-Item $file).Length / 1MB))
Get-ChildItem $Dir -Filter "nexapos-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item
Write-Host "Copy it somewhere else too (flash disk or cloud drive): it contains customer data."
