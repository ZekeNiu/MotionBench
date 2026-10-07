@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 scripts\serve.py
) else (
  python scripts\serve.py
)
if errorlevel 1 (
  echo.
  echo MotionBench requires Python 3.10 or later for the local AI launcher.
  echo You can still open MotionBench.html directly for offline assessment.
  pause
)
