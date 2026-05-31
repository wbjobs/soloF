@echo off
chcp 65001 >nul
echo ========================================
echo   离线法律卷宗检索工具
echo ========================================
echo.

echo [1/2] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)
echo ✓ Python 环境正常
echo.

echo [2/2] 启动 Streamlit 应用...
echo.
streamlit run app.py

if errorlevel 1 (
    echo.
    echo 启动失败，请检查是否已安装依赖:
    echo   pip install -r requirements.txt
    echo.
    pause
)
