Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FFT Image Processor - Start Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$wasmPkg = Join-Path $PSScriptRoot "static\pkg\fft_image_processor_bg.wasm"
if (-not (Test-Path $wasmPkg)) {
    Write-Host "Wasm module not found. Building first..." -ForegroundColor Yellow
    & .\build.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed. Cannot start server." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Starting FastAPI server on http://localhost:8000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

python main.py
