@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS first.
  pause
  exit /b 1
)
call npm run verify:all
if errorlevel 1 (
  echo Verification failed. Read the first failing test above.
  pause
  exit /b 1
)
echo All configured verification steps passed.
pause
