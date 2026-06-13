# ShopOps — go live on managed cloud (Neon + Render)

Goal: ShopOps reachable from **any device, anywhere, 24/7** — no home PC, no LAN.
Data is saved in a real database and stays in sync across all branches, sales
staff, technicians and business partners.

```
  Phone / branch PC / partner's laptop
            │  https
            ▼
   Render web service  ──►  serves the app  + the API     (free, 24/7)
            │  TLS
            ▼
   Neon PostgreSQL  ──►  your single source of truth        (free, 24/7)
```

You do this **once**. ~20 minutes. Two free accounts, no credit card.

---

## 1. Create the database (Neon)

1. Go to **https://neon.tech** → sign up (GitHub/Google is fastest).
2. **Create a project** → name it `shopops`, region **Asia Pacific (Singapore)**.
3. On the project dashboard, click **Connect** → copy the **connection string**.
   It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/shopops?sslmode=require
   ```
   Keep `?sslmode=require` at the end. **Save this — it's your `DATABASE_URL`.**

## 2. Create the tables + first logins (run once, from your PC)

```bash
cd "C:/Users/DELL/Downloads/shopops/server"
cp .env.example .env          # then edit server/.env:
#   DATABASE_URL = the Neon string from step 1
#   JWT_SECRET   = any long random text
#   SEED_OWNER_PASSWORD = the owner password you want
npm install
npm run db:setup              # creates all tables in Neon
npm run db:seed               # creates logins + demo products
```

`db:seed` prints the logins it created. By default:

| Login      | Role             | Can do                                  |
|------------|------------------|-----------------------------------------|
| `owner`    | Owner            | Everything, all branches                |
| `manager1` | Manager          | Full operations for their branch        |
| `sales1`   | Sales            | Record sales + cash, view stock         |
| `tech1`    | Technician       | Repair / service jobs                   |
| `partner1` | Business partner | **View-only** — dashboards & reports    |

Change every password from inside the app (**Staff** tab) once you're in.

## 3. Put the code on GitHub (Render deploys from GitHub)

```bash
cd "C:/Users/DELL/Downloads/shopops"
git init
git add -A
git commit -m "ShopOps — initial deploy"
# create an EMPTY repo named shopops at https://github.com/new , then:
git branch -M main
git remote add origin https://github.com/<your-username>/shopops.git
git push -u origin main
```

> `server/.env` is git-ignored, so your password/secret never leave your PC.

## 4. Deploy the app (Render)

1. Go to **https://render.com** → sign up → connect your GitHub.
2. **New** → **Blueprint** → pick the `shopops` repo. Render reads `render.yaml`.
3. When prompted, set **`DATABASE_URL`** = the same Neon string from step 1.
   (`JWT_SECRET` is generated automatically.)
4. **Apply / Create** → wait for the build (~3–5 min). Render gives you a URL like
   `https://shopops.onrender.com`.

## 5. Done — share the link

Open the Render URL on any device, log in as `owner`. Everyone you add under
**Staff** can now log in from their own phone/PC, anywhere, and sees the same
live data. The dashboard, sales and stock auto-refresh every ~20s and whenever
a tab regains focus.

---

## Notes & gotchas
- **Free Render sleeps** after ~15 min idle; the next visit takes ~50s to wake,
  then it's fast again. To stay always-on, upgrade that service's plan.
- **Re-deploy** after code changes: `git push` → Render rebuilds automatically.
- **Schema change?** Re-run `npm run db:setup` from your PC (it's idempotent).
- **Back up the data:** Neon keeps automatic backups; you can also branch the DB
  from its dashboard.
- **JWT_SECRET must stay constant** — if it changes, everyone is logged out.
- Same `DATABASE_URL` must be set in BOTH places (your local `server/.env` for
  setup/seed, and Render for the running app).
- Prefer your own server instead? The Hetzner runbook in `deploy/README.md`
  still works; this managed path just avoids the wait and the upkeep.
