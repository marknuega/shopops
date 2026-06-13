#!/usr/bin/env bash
# ShopOps one-shot server provisioning for Ubuntu 24.04 (run as root on the VPS).
#
#   DOMAIN=shop.example.com bash /opt/shopops/deploy/setup.sh
#
# Optional env overrides:
#   OWNER_USER, OWNER_PASSWORD, OWNER_NAME, SHOP_NAME, BRANCH_NAME, APP_DIR
#
# Idempotent: safe to re-run. Secrets are generated once and stored in
# /root/shopops-secrets.env so re-runs keep the same DB/JWT passwords.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. DOMAIN=shop.example.com}"
APP_DIR="${APP_DIR:-/opt/shopops}"
OWNER_USER="${OWNER_USER:-owner}"
OWNER_NAME="${OWNER_NAME:-Shop Owner}"
SHOP_NAME="${SHOP_NAME:-My Electronics Shop}"
BRANCH_NAME="${BRANCH_NAME:-Branch 1}"

gen() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 28; }

echo "==> [1/8] Persistent secrets"
SECRETS=/root/shopops-secrets.env
if [ -f "$SECRETS" ]; then
  # shellcheck disable=SC1090
  source "$SECRETS"
  echo "    reused $SECRETS"
else
  APP_DB_PASSWORD="$(gen)"
  PG_SUPER_PASSWORD="$(gen)"
  JWT_SECRET="$(openssl rand -hex 32)"
  OWNER_PASSWORD="${OWNER_PASSWORD:-$(gen)}"
  cat > "$SECRETS" <<EOF
APP_DB_PASSWORD=$APP_DB_PASSWORD
PG_SUPER_PASSWORD=$PG_SUPER_PASSWORD
JWT_SECRET=$JWT_SECRET
OWNER_PASSWORD=$OWNER_PASSWORD
EOF
  chmod 600 "$SECRETS"
  echo "    generated $SECRETS"
fi

echo "==> [2/8] System packages (Node 20, PostgreSQL, Caddy)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw openssl debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y postgresql

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

systemctl enable --now postgresql

echo "==> [3/8] PostgreSQL superuser password"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres PASSWORD '${PG_SUPER_PASSWORD}';"

echo "==> [4/8] App user + write server/.env"
id shopops >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin shopops
cat > "$APP_DIR/server/.env" <<EOF
DATABASE_URL=postgresql://shopops:${APP_DB_PASSWORD}@localhost:5432/shopops
JWT_SECRET=${JWT_SECRET}
PORT=4000
PG_SUPERUSER_URL=postgresql://postgres:${PG_SUPER_PASSWORD}@localhost:5432/postgres
APP_DB_PASSWORD=${APP_DB_PASSWORD}
SEED_OWNER_USERNAME=${OWNER_USER}
SEED_OWNER_PASSWORD=${OWNER_PASSWORD}
SEED_OWNER_NAME=${OWNER_NAME}
SEED_SHOP_NAME=${SHOP_NAME}
SEED_BRANCH_NAME=${BRANCH_NAME}
EOF
chmod 600 "$APP_DIR/server/.env"

echo "==> [5/8] Install deps + build frontend"
cd "$APP_DIR"
npm install --no-audit --no-fund
npm run build
cd "$APP_DIR/server"
npm install --no-audit --no-fund

echo "==> [6/8] Database setup + seed"
node src/setup.js
node src/seed.js

echo "==> [7/8] systemd service (auto-start on boot/crash)"
chown -R shopops:shopops "$APP_DIR"
cat > /etc/systemd/system/shopops.service <<EOF
[Unit]
Description=ShopOps API + frontend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=shopops
WorkingDirectory=${APP_DIR}/server
ExecStart=/usr/bin/node ${APP_DIR}/server/src/index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable shopops
systemctl restart shopops

echo "==> [8/9] Daily alert notifier (low stock + bills due) via Telegram"
# User-editable alert config — created once, preserved across re-runs.
if [ ! -f /etc/shopops-notify.env ]; then
  cat > /etc/shopops-notify.env <<EOF
# ShopOps alerts — fill these in, then:  systemctl start shopops-notify
# How to get them: deploy/README.md → "Telegram alerts".
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
# Warn this many days before a bill's due date (overdue always included):
NOTIFY_DUE_SOON_DAYS=${NOTIFY_DUE_SOON_DAYS:-3}
# Repair jobs received but not yet started (still "received") for this many days:
NOTIFY_TAT_DAYS=${NOTIFY_TAT_DAYS:-3}
# Jobs marked ready-for-pickup but not claimed for this many days:
NOTIFY_UNCLAIMED_DAYS=${NOTIFY_UNCLAIMED_DAYS:-7}
# Any still-open job in the shop longer than this = aging backlog:
NOTIFY_BACKLOG_DAYS=${NOTIFY_BACKLOG_DAYS:-30}
# Set to true to also get an "all clear" message when nothing needs attention:
NOTIFY_ALWAYS=false
EOF
  chmod 600 /etc/shopops-notify.env
fi

cat > /etc/systemd/system/shopops-notify.service <<EOF
[Unit]
Description=ShopOps daily low-stock & bills-due alert
After=network-online.target postgresql.service shopops.service
Wants=network-online.target

[Service]
Type=oneshot
User=shopops
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=/etc/shopops-notify.env
ExecStart=/usr/bin/node ${APP_DIR}/server/src/notify.js
EOF

cat > /etc/systemd/system/shopops-notify.timer <<EOF
[Unit]
Description=Run the ShopOps daily alert at 08:00 (Asia/Manila)

[Timer]
OnCalendar=*-*-* 08:00:00 Asia/Manila
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now shopops-notify.timer

echo "==> [9/9] Caddy (auto-HTTPS) + firewall"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    encode gzip
    reverse_proxy localhost:4000
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

echo
echo "============================================================"
echo " ShopOps is live:  https://${DOMAIN}"
echo " Owner login:      ${OWNER_USER}"
echo " Owner password:   ${OWNER_PASSWORD}"
echo " (secrets stored in ${SECRETS})"
echo "============================================================"
echo "Health check:  curl -s https://${DOMAIN}/api/health"
