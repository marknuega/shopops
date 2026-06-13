# ShopOps — Remote Manager (server edition)

Run a mini electronics shop from anywhere. ShopOps is now a **client + server +
database** system: a React front-end, an Express API, and PostgreSQL — so the
same **live data** is available on every device (including your phone), behind a
login, with **Excel report exports**.

## What's inside

```
shopops/
  src/        React front-end (Vite + Tailwind), talks to the API
  server/     Express API + PostgreSQL + Excel reports
  scripts/    Windows startup task + Cloudflare Tunnel setup
  dist/       Built front-end (served by the API in production)
```

### Features

- **Sales / POS**, **Stocks** (all stock changes audited via `stock_movements`),
  **Repair logs**, **Materials orders** (purchase orders), **Fund movement**
  (cash in/out), **Bills**, **Backlogs**, **Cash closing**, **Performance**,
  **Ratings**, **Staff** (with logins & roles).
- **Login** with `owner` / `manager` / `staff` roles.
- **Excel exports** (`.xlsx`) for: Repair logs, Sales, Materials orders, Backlogs,
  Technician productivity, Fund movement — with optional date ranges.

## First-time setup (this PC)

PostgreSQL 18 is already installed and running here. Node 18+ required.

```bash
# 1. Install dependencies
npm install                 # front-end
cd server && npm install    # API

# 2. Configure secrets
copy .env.example .env       # in the server/ folder
#   then edit server/.env:
#   - PG_SUPERUSER_URL  -> postgres superuser password
#   - APP_DB_PASSWORD / DATABASE_URL -> a password for the new 'shopops' DB user
#   - JWT_SECRET        -> any long random string
#   - SEED_OWNER_*      -> the owner login you want

# 3. Create the database + tables, then seed
node src/setup.js
node src/seed.js

# 4. Build the front-end and start the server
cd ..
npm run build
node server/src/index.js     # serves app + API on http://localhost:4000
```

Open **http://localhost:4000**, log in with the owner credentials from `.env`.

### Development mode (hot reload)

```bash
# terminal 1
cd server && npm run dev      # API on :4000
# terminal 2
npm run dev                   # Vite on :5173, proxies /api -> :4000
```

## Run on Windows startup

```powershell
# elevated PowerShell (Run as Administrator)
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
Start-ScheduledTask -TaskName "ShopOps Server"
```

Registers a scheduled task that launches the server at every boot. Postgres
already auto-starts as a Windows service.

## Reach it from your phone

See **[scripts/setup-tunnel.md](scripts/setup-tunnel.md)** — a Cloudflare Tunnel
gives a secure HTTPS URL with no port-forwarding. Quick test:

```powershell
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://localhost:4000
```

Open the printed `https://…trycloudflare.com` URL on your phone and log in.

## Data & safety

- All data lives in PostgreSQL (`shopops` database). Back up with `pg_dump`.
- Stock can only change through `stock_movements`; adjustments and sale-voids
  require a reason and surface on the owner dashboard's red-flags panel.
- `server/.env` holds the DB password + JWT secret — keep it private (git-ignored).
