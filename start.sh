#!/bin/sh
# Sim World launcher for macOS/Linux: checks Node.js, starts the server, opens the browser.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Sim World needs Node.js 22.5 or newer, and it isn't installed."
  echo "Download it from https://nodejs.org/ then run this script again."
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"; then
  echo "Sim World needs Node.js 22.5 or newer. You have: $(node --version)"
  echo "Download a newer version from https://nodejs.org/"
  exit 1
fi

PORT="${PORT:-3000}"
export PORT
URL="http://localhost:$PORT"

# Open the browser two seconds from now, once the server is listening.
(
  sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

echo "Starting Sim World at $URL. Press Ctrl+C to stop it."
exec node server.js
