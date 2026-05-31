@echo off
echo Starting AI Whiteboard Service...
echo.
echo Make sure you have installed dependencies:
echo   pip install -r requirements.txt
echo.
echo If you want to use Stable Diffusion, start Automatic1111 with --api flag:
echo   set COMMANDLINE_ARGS=--api
echo.
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
