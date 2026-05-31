@echo off
echo ========================================
echo   构建并启动 Flink 作业
echo ========================================
echo.
cd flink-module
echo 正在构建项目...
call mvn clean package -DskipTests
if %errorlevel% neq 0 (
    echo 构建失败！
    pause
    exit /b 1
)
echo.
echo 构建成功，启动 Flink 作业...
java -cp target/flink-module-1.0.0.jar com.bookanalytics.flink.BookConversionJob
pause
