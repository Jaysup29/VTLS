#!/bin/bash
# ============================================================
#  Vault Ledger v2 — Mac / Linux launcher
#  Run: ./start-mac-linux.sh
#  Requires: Python 3 (pre-installed on Mac and most Linux)
# ============================================================

cd "$(dirname "$0")"
PORT=8765

echo "Starting local server on http://127.0.0.1:$PORT ..."
python3 -m http.server $PORT --bind 127.0.0.1 &
SERVER_PID=$!

# Give the server a moment to come up
sleep 1

# Open browser
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "http://127.0.0.1:$PORT/index.html"
elif command -v xdg-open > /dev/null; then
  xdg-open "http://127.0.0.1:$PORT/index.html"
else
  echo "Please open http://127.0.0.1:$PORT/index.html in your browser"
fi

echo ""
echo "========================================================="
echo "  Vault Ledger server started on http://127.0.0.1:$PORT"
echo "  Press Ctrl+C in this window to stop the server."
echo "========================================================="
echo ""

# Wait on the server process
wait $SERVER_PID
