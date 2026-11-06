#!/bin/bash
# Shows the link to share. A quick tunnel gets a new link each time it restarts,
# so this also updates password reset emails to use the new one.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it like this: sudo crm-link"; exit 1; }

link=$(journalctl -u crm-tunnel -n 300 --no-pager -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
if [ -z "$link" ]; then
  echo "No link yet. Wait a minute and try again."
  echo "If it stays empty, check the internet connection, then run: sudo systemctl restart crm-tunnel"
  exit 1
fi

if ! grep -qxF "APP_URL=$link" /opt/crm/.env; then
  sed -i "s|^APP_URL=.*|APP_URL=$link|" /opt/crm/.env
  systemctl restart crm
fi
echo "$link"
