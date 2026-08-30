@echo off
REM ============================================================
REM  mediator-store installer + starter (Windows)
REM  - Installs dependencies
REM  - Creates .env from .env.example if missing
REM  - Starts the server
REM ============================================================

setlocal

cd /d "%~dp0\.."

if not exist .env (
  echo [setup] Creating .env from .env.example ...
  copy /Y .env.example .env >nul
)

echo [setup] Installing dependencies (this may take a minute) ...
call npm install
if errorlevel 1 (
  echo.
  echo [error] npm install failed. Make sure Node.js 22.5+ is installed.
  pause
  exit /b 1
)

echo.
echo [run] Starting mediator-store on http://localhost:3000
echo       Admin login: /admin/login
echo       Default user: admin
echo       Default pass: admin123  (change it in admin settings)
echo.
call npm start
endlocal
