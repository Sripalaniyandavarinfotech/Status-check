#!/bin/bash
# Saves the database, keeps 14 days of copies, and lets the laptop's owner copy them off.
set -euo pipefail
cd /opt/crm
/usr/local/bin/node backup-database.js
find backups -name 'crm-*.sql' -mtime +14 -delete
chmod 750 backups
chmod 640 backups/crm-*.sql
