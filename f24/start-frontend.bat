@echo off
echo ========================================
echo   启动 React 前端
echo ========================================
echo.
cd react-frontend
if not exist node_modules (
    echo 首次启动，正在安装依赖...
    call npm install
)
echo 启动前端服务...
npm start
pause
