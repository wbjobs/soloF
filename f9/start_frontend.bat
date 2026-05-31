@echo off
echo Starting Level-2 Frontend...
cd /d "%~dp0frontend"

echo Checking Node.js...
node --version
if %errorlevel% neq 0 (
    echo Node.js not found!
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install

echo Starting dev server...
call npm run dev

pause
