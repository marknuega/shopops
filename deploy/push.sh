#!/usr/bin/env bash
# Push the ShopOps source to the VPS (run locally from Git Bash).
# Uses tar-over-ssh so it works with just the Windows OpenSSH client (no rsync needed).
#
#   bash deploy/push.sh <server-ip>
#
# Excludes node_modules / dist / .git / local .env — those are rebuilt on the server.
set -euo pipefail

IP="${1:?usage: bash deploy/push.sh <server-ip>}"
APP_DIR="${APP_DIR:-/opt/shopops}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

echo "==> Pushing $SRC  ->  root@$IP:$APP_DIR"
tar czf - -C "$SRC" \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  --exclude=server/node_modules \
  --exclude='*.log' \
  --exclude=server/.env \
  . | ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new root@"$IP" \
        "mkdir -p $APP_DIR && tar xzf - -C $APP_DIR && echo '   unpacked on server'"

echo "==> Done. Next, on the server run:"
echo "    DOMAIN=<your-domain> bash $APP_DIR/deploy/setup.sh"
