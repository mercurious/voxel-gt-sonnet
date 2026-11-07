#!/usr/bin/env bash
# Serve the game locally (ES modules need http://) and open it in the default browser.
# Usage: ./play.sh [start-port]   - picks the first free port at or above start-port (default 8080).
cd "$(dirname "$0")"
START="${1:-8080}"
PORT=$(python3 - "$START" <<'PY'
import socket, sys
p = int(sys.argv[1])
while p < 65535:
    with socket.socket() as s:
        try:
            s.bind(("", p))
            print(p)
            break
        except OSError:
            p += 1
PY
)
echo "Voxel GT  ->  http://localhost:$PORT/   (Ctrl+C to stop)"
( sleep 1; (xdg-open "http://localhost:$PORT/" || open "http://localhost:$PORT/") >/dev/null 2>&1 ) &
exec python3 -m http.server "$PORT"
