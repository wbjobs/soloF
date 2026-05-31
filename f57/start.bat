@echo off
echo ========================================
echo     网络流量分析系统 - 启动脚本
echo ========================================
echo.

echo [1/3] 检查 Python 环境...
python --version
if errorlevel 1 (
    echo 错误: 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

echo.
echo [2/3] 安装依赖...
pip install -r requirements.txt

echo.
echo [3/3] 启动系统...
echo.
echo 请选择运行模式:
echo   1. 全部执行 (生成数据 + 分析 + 启动服务)
echo   2. 仅生成并导入数据
echo   3. 仅运行图分析
echo   4. 仅启动 API 服务
echo.

set /p choice=请输入选项 (1-4): 

if "%choice%"=="1" (
    python main.py all
) else if "%choice%"=="2" (
    python main.py import
) else if "%choice%"=="3" (
    python main.py analyze
) else if "%choice%"=="4" (
    python main.py server
) else (
    echo 无效选项
    pause
    exit /b 1
)

pause
