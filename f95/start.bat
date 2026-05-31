@echo off
chcp 65001 >nul
title ONNX Model Debugger

echo ========================================
echo   ONNX 模型调试器
echo ========================================
echo.

echo [1/2] 启动 Python 后端 (FastAPI on port 8000)...
start "ONNX Backend" cmd /k "cd /d %~dp0backend && python main.py"

echo.
timeout /t 3 /nobreak >nul

echo [2/2] 启动前端页面...
start "" "%~dp0frontend\index.html"

echo.
echo 后端已启动: http://localhost:8000
echo 前端页面已在浏览器中打开
echo.
echo 关闭此窗口将停止所有服务
pause