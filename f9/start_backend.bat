@echo off
echo Starting Level-2 Backend...
cd /d "%~dp0backend"

echo Checking Python...
python --version
if %errorlevel% neq 0 (
    echo Python not found!
    pause
    exit /b 1
)

echo Installing dependencies...
pip install -r requirements.txt

echo Starting FastAPI server...
cd app
python main.py

pause
