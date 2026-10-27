@echo off
rem Sim World launcher for Windows: checks Node.js, starts the server, opens the browser.
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Sim World needs Node.js 22.5 or newer, and it isn't installed.
  echo Download it from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" || (
  echo Sim World needs Node.js 22.5 or newer. You have:
  node --version
  echo Download a newer version from https://nodejs.org/
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3000
rem Open the browser two seconds from now, once the server is listening.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://localhost:%PORT%'"

echo Starting Sim World. Close this window or press Ctrl+C to stop it.
node server.js
pause
