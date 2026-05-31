Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FFT Image Processor - Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Checking Rust and wasm-pack..." -ForegroundColor Yellow

$rustcInstalled = Get-Command rustc -ErrorAction SilentlyContinue
if (-not $rustcInstalled) {
    Write-Host "Error: Rust is not installed. Please install Rust from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

$wasmPackInstalled = Get-Command wasm-pack -ErrorAction SilentlyContinue
if (-not $wasmPackInstalled) {
    Write-Host "Installing wasm-pack..." -ForegroundColor Yellow
    cargo install wasm-pack
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to install wasm-pack" -ForegroundColor Red
        exit 1
    }
}

Write-Host "[2/4] Building Rust/Wasm module..." -ForegroundColor Yellow
wasm-pack build --target web --out-name fft_image_processor --out-dir static/pkg
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to build Wasm module" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/4] Checking Python dependencies..." -ForegroundColor Yellow

$pythonInstalled = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonInstalled) {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    exit 1
}

python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install Python dependencies" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[4/4] Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server, run: .\run.ps1" -ForegroundColor Cyan
Write-Host "Or manually: python main.py" -ForegroundColor Cyan
