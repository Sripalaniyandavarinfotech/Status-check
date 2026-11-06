#!/bin/bash
# Run on your main computer. Makes crm-laptop.tar.gz to copy to the laptop.
#   bash deploy/make-package.sh              the site and a copy of your database
#   bash deploy/make-package.sh --code-only  only the site, for updating the laptop later
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/crm-laptop"

tar -cf - --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./data-backup-before-postgres \
  --exclude=./backups --exclude=./.env --exclude=./.git --exclude=./.claude --exclude=./crm-laptop.tar.gz . \
  | tar -xf - -C "$work/crm-laptop"

if [ "${1:-}" != "--code-only" ]; then
  npm run --silent backup
  latest=$(ls -t backups/crm-*.sql | head -1)
  mkdir "$work/crm-laptop/deploy-data"
  cp "$latest" "$work/crm-laptop/deploy-data/crm.sql"
  # Saved Aadhaar numbers can only be read with the same key.
  (umask 077; grep '^AADHAAR_KEY=' .env | cut -d= -f2- > "$work/crm-laptop/deploy-data/aadhaar.key" || true)
fi

umask 077
rm -f crm-laptop.tar.gz
tar -czf crm-laptop.tar.gz -C "$work" crm-laptop
echo "Made crm-laptop.tar.gz"
[ "${1:-}" = "--code-only" ] || echo "It holds your customers' details and your Aadhaar key, so delete it after copying it to the laptop."
