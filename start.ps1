# LBook — Start both frontend and backend
# Usage: .\start.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== LBook ===" -ForegroundColor Cyan
Write-Host ""

# ── Backend ──
$backendJob = Start-Job -Name "lbook-backend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
} -ArgumentList "$root\backend"

Write-Host "Backend starting on http://127.0.0.1:8000 ..." -ForegroundColor Green

# ── Frontend ──
$frontendJob = Start-Job -Name "lbook-frontend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev
} -ArgumentList "$root\frontend"

Write-Host "Frontend starting on http://localhost:5173 ..." -ForegroundColor Green
Write-Host ""

Write-Host "Press Ctrl+C to stop both servers" -ForegroundColor Yellow
Write-Host ""

try {
    while ($true) {
        Receive-Job -Name "lbook-backend" -ErrorAction SilentlyContinue
        Receive-Job -Name "lbook-frontend" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    Stop-Job -Name "lbook-backend" -ErrorAction SilentlyContinue
    Stop-Job -Name "lbook-frontend" -ErrorAction SilentlyContinue
    Remove-Job -Name "lbook-backend" -ErrorAction SilentlyContinue
    Remove-Job -Name "lbook-frontend" -ErrorAction SilentlyContinue
    Write-Host "Stopped." -ForegroundColor Gray
}
