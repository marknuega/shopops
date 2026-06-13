# ShopOps — Hetzner deploy runbook

Goal: ShopOps reachable on the internet 24/7 (even with the home PC off), at
`https://<your-domain>`, with auto-HTTPS and auto-restart on reboot.

## Stack on the server
- **PostgreSQL** — database (localhost only)
- **Node service** (`shopops.service`) — Express on :4000, serves API **and** the built frontend
- **Caddy** — reverse proxy on :443/:80, automatic Let's Encrypt HTTPS

## One-time, once the Hetzner server is verified + created

You need: the server **IPv4** and your **domain**.

1. **Point DNS at the server.** At your registrar/Cloudflare, add an `A` record:
   `@` (or `shop`) -> `<server-ipv4>`. (Wait a few min for it to resolve.)

2. **Push the code** (locally, in Git Bash):
   ```bash
   bash deploy/push.sh <server-ipv4>
   ```

3. **Provision + launch** (on the server, via SSH):
   ```bash
   ssh root@<server-ipv4>
   DOMAIN=<your-domain> bash /opt/shopops/deploy/setup.sh
   ```
   Optional overrides: `OWNER_USER=... OWNER_PASSWORD=... SHOP_NAME=... DOMAIN=... bash ...`

The script prints the live URL + the owner login/password at the end.

## Verify
```bash
curl -s https://<your-domain>/api/health        # -> {"ok":true,...}
```

## Telegram alerts (low stock + bills due soon)

A `shopops-notify` timer runs every morning at **08:00 Asia/Manila** and messages
you on Telegram if anything needs attention. If nothing's wrong it stays quiet
(unless you set `NOTIFY_ALWAYS=true`). It reports, across all branches:
- ⚠️ **Low stock** — products at/below their min stock
- 🧾 **Bills due soon** — unpaid bills overdue or due within `NOTIFY_DUE_SOON_DAYS`
- ⏳ **Not started** — repair jobs still "received" (not in progress) past `NOTIFY_TAT_DAYS` (turnaround)
- 📦 **Ready, unclaimed** — jobs marked ready-for-pickup but not claimed for `NOTIFY_UNCLAIMED_DAYS`
- 🐌 **Backlog** — any still-open job in the shop longer than `NOTIFY_BACKLOG_DAYS`

(A job older than the backlog threshold shows only under Backlog, so nothing is listed twice.)

**One-time setup (5 min, on your phone + the server):**

1. **Make a bot.** In Telegram, open **@BotFather** → send `/newbot` → follow the
   prompts. It gives you a **bot token** like `123456789:AAE...`.
2. **Start a chat with your new bot** (tap it, hit *Start*) so it's allowed to message you.
3. **Get your chat ID.** Message **@userinfobot** — it replies with your numeric `Id`.
4. **Put both into the config** on the server and start it:
   ```bash
   nano /etc/shopops-notify.env      # set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
   systemctl start shopops-notify    # send a test now
   journalctl -u shopops-notify -n 30 --no-pager   # check it worked
   ```
   You should get a Telegram message (or "nothing to report" in the log if all is well).

**Tuning** (`/etc/shopops-notify.env`, then `systemctl restart shopops-notify.timer`):
- `NOTIFY_DUE_SOON_DAYS=3` — how many days ahead to warn about bills.
- `NOTIFY_TAT_DAYS=3` — flag jobs not started within this many days (turnaround).
- `NOTIFY_UNCLAIMED_DAYS=7` — flag ready jobs not picked up within this many days.
- `NOTIFY_BACKLOG_DAYS=30` — flag any open job older than this as backlog.
- `NOTIFY_ALWAYS=false` — set `true` to also get a daily "all clear" message.
- Change the time: edit `OnCalendar=` in `/etc/systemd/system/shopops-notify.timer`,
  then `systemctl daemon-reload && systemctl restart shopops-notify.timer`.

Check the schedule: `systemctl list-timers shopops-notify`

## Day-2 ops
- Logs:        `journalctl -u shopops -f`
- Restart:     `systemctl restart shopops`
- Redeploy:    re-run `deploy/push.sh` then `systemctl restart shopops`
              (re-run `setup.sh` only if deps/schema changed — it's idempotent)
- Secrets:     `/root/shopops-secrets.env` (DB + JWT + owner password)
- DB backup:   `sudo -u postgres pg_dump shopops > shopops-$(date +%F).sql`

## Notes
- The repair-log **local video streaming** feature reads from a Windows `Videos`
  folder and won't work on the server unless those files are copied up. Everything
  else (inventory, sales, services, reports, logins) runs fully on the server.
- Postgres is bound to localhost; only 22/80/443 are open (ufw).
