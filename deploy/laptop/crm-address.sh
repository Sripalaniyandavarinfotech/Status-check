#!/bin/bash
# Shows where to open the CRM on the shop network:  crm-address
set -uo pipefail
name=$(grep '^LAN_NAME=' /opt/crm/.env 2>/dev/null | cut -d= -f2-)
name=${name:-ethunaivan.local}
ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' || true)

echo "Open the CRM on any computer or phone on this Wi-Fi:"
echo "  https://$name"
for ip in $ips; do echo "  https://$ip    (if the name does not work)"; done
echo
echo "Phone app (eThunaivan Calls): it finds the laptop by itself."
echo "  If asked for a link, type:  $name"
echo
echo "Trust the laptop once on each new device (stops the 'not private' warning):"
echo "  http://$name/ethunaivan-ca.crt"
echo "  (steps for Windows, Android and Brave are in docs/HTTPS.md)"
systemctl is-active --quiet crm || echo "Warning: the site is not running. Start it with: sudo systemctl restart crm"
