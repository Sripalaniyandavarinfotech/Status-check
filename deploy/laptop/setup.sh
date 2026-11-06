#!/bin/bash
# Run on the laptop, inside the unpacked crm-laptop folder:  sudo bash deploy/laptop/setup.sh
# Safe to run again: it keeps the laptop's .env and never replaces its database.
set -euo pipefail

say() { printf '\n==> %s\n' "$1"; }
[ "$(id -u)" = 0 ] || { echo "Run it like this: sudo bash deploy/laptop/setup.sh"; exit 1; }
[ -f server.js ] && [ -f deploy/laptop/crm.service ] || { echo "Run this from inside the crm-laptop folder."; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "This script needs a 64-bit Intel or AMD laptop."; exit 1; }
command -v apt-get >/dev/null || { echo "This script needs Ubuntu or Debian."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
APP=/opt/crm
OWNER=${SUDO_USER:-}

say "Installing system packages"
apt-get update
apt-get install -y ca-certificates curl gnupg rsync xz-utils postgresql-common

say "Installing PostgreSQL 18"
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-18

say "Installing Node 24"
if ! /usr/local/bin/node -v 2>/dev/null | grep -q '^v24\.'; then
  work=$(mktemp -d)
  base=https://nodejs.org/dist/latest-v24.x
  curl -fsSL "$base/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  file=$(grep -o 'node-v24[^ ]*-linux-x64\.tar\.xz' "$work/SHASUMS256.txt")
  curl -fsSL "$base/$file" -o "$work/$file"
  (cd "$work" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/node
  mkdir /opt/node
  tar -xJf "$work/$file" -C /opt/node --strip-components=1
  rm -rf "$work"
  ln -sf /opt/node/bin/node /opt/node/bin/npm /opt/node/bin/npx /usr/local/bin/
fi

say "Installing cloudflared"
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared

say "Copying the site to $APP"
id crm >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin crm
mkdir -p "$APP"
rsync -a --delete --exclude=/.env --exclude=/backups --exclude=/node_modules --exclude=/dist --exclude=/deploy-data ./ "$APP"/
mkdir -p "$APP/backups"
chown -R crm:crm "$APP"
chmod 750 "$APP" "$APP/backups"
[ -z "$OWNER" ] || usermod -aG crm "$OWNER"

set_env() { # name value
  if grep -q "^$1=" "$APP/.env"; then sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; else echo "$1=$2" >> "$APP/.env"; fi
}

say "Setting up the database"
systemctl enable --now postgresql
if [ ! -f "$APP/.env" ]; then
  password=$(openssl rand -hex 24)
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'crm'" | grep -q 1; then
    sudo -u postgres psql -qc "ALTER ROLE crm PASSWORD '$password'"
  else
    sudo -u postgres psql -qc "CREATE ROLE crm LOGIN PASSWORD '$password'"
  fi
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'crm'" | grep -q 1 || sudo -u postgres createdb -O crm crm
  install -o crm -g crm -m 600 "$APP/.env.example" "$APP/.env"
  set_env DATABASE_URL "postgres://crm:$password@localhost:5432/crm"
  set_env COOKIE_SECURE on
  set_env BEHIND_TUNNEL on
  set_env HOST 127.0.0.1
fi

if ! grep -Eq '^AADHAAR_KEY=[0-9a-fA-F]{64}$' "$APP/.env"; then
  aadhaar_key=$(cat deploy-data/aadhaar.key 2>/dev/null || true)
  [ -n "$aadhaar_key" ] || aadhaar_key=$(openssl rand -hex 32)
  set_env AADHAAR_KEY "$aadhaar_key"
fi

tables=$(sudo -u postgres psql -d crm -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ -f deploy-data/crm.sql ] && [ "$tables" = 0 ]; then
  say "Restoring your data"
  url=$(grep '^DATABASE_URL=' "$APP/.env" | cut -d= -f2-)
  dbpass=$(printf '%s' "$url" | sed -E 's|^postgres://crm:([^@]*)@.*|\1|')
  install -o crm -g crm -m 600 deploy-data/crm.sql /tmp/crm-restore.sql
  sudo -u crm PGPASSWORD="$dbpass" psql -q -h localhost -U crm -d crm -v ON_ERROR_STOP=1 --single-transaction -f /tmp/crm-restore.sql \
    || { rm -f /tmp/crm-restore.sql; echo "Your data could not be restored. Nothing was changed in the database."; exit 1; }
  rm -f /tmp/crm-restore.sql
fi

say "Building the website"
sudo -u crm -H bash -c "cd $APP && PATH=/usr/local/bin:\$PATH npm ci && PATH=/usr/local/bin:\$PATH npm run build"

say "Keeping the laptop awake and on Indian time"
timedatectl set-timezone Asia/Kolkata
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/crm.conf <<'CONF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
CONF
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
systemctl restart systemd-logind

say "Starting the site, the tunnel and nightly backups"
install -m 644 "$APP"/deploy/laptop/crm.service "$APP"/deploy/laptop/crm-tunnel.service \
  "$APP"/deploy/laptop/crm-backup.service "$APP"/deploy/laptop/crm-backup.timer /etc/systemd/system/
install -m 755 "$APP/deploy/laptop/crm-link.sh" /usr/local/bin/crm-link
systemctl daemon-reload
systemctl enable crm crm-tunnel crm-backup.timer
systemctl restart crm
systemctl restart crm-tunnel
systemctl start crm-backup.timer

say "Done"
sleep 15
systemctl is-active crm crm-tunnel || true
crm-link || true
echo
echo "Next, follow part 5 of deploy/LAPTOP_SETUP.md."
