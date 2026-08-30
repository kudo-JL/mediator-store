@echo off
REM Run mediator-store in development mode (auto-reload).
cd /d "%~dp0\.."
if not exist .env (
  copy /Y .env.example .env >nul
)
call npm run dev
