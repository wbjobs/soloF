@echo off
chcp 65001 >nul
echo ========================================
echo    地牢生成器 - Python 服务器
echo ========================================
echo.
echo [1/3] 检查 Python 环境...
python --version
if errorlevel 1 (
    echo 错误: 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)
echo ✓ Python 环境正常
echo.
echo [2/3] 检查依赖...
python -c "import numpy, scipy, flask, flask_cors" 2>nul
if errorlevel 1 (
    echo 正在安装依赖...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)
echo ✓ 依赖检查完成
echo.
echo [3/3] 启动服务器...
echo.
echo 服务器地址: http://localhost:5000
echo 健康检查: http://localhost:5000/health
echo API 方法: http://localhost:5000/methods
echo.
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.
python server.py
pause
