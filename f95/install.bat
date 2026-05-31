@echo off
chcp 65001 >nul
echo ========================================
echo   ONNX 模型调试器 - 安装依赖
echo ========================================
echo.

echo [1/2] 正在安装 Python 依赖...
pip install fastapi uvicorn python-multipart onnx onnxruntime numpy

if %errorlevel% neq 0 (
    echo.
    echo 错误: Python 依赖安装失败!
    echo 请确保已安装 Python 3.8+ 并添加到 PATH。
    pause
    exit /b 1
)

echo.
echo [2/2] 依赖安装完成!
echo.
echo 运行 start.bat 启动应用。
pause