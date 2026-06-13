# Reaching ShopOps from your phone (Cloudflare Tunnel)

The server listens on `http://localhost:4000` on this PC. A Cloudflare Tunnel
gives it a secure **HTTPS** address reachable from anywhere — your phone in
Makkah on mobile data, the shop staff, etc. — **without** port-forwarding or
exposing your home IP.

## 0. Install cloudflared (once)

```powershell
winget install --id Cloudflare.cloudflared -e
```

---

## Option A — Quick tunnel (works in 1 minute, URL changes each run)

No Cloudflare account or domain needed. Great for testing phone access today.

```powershell
cloudflared tunnel --url http://localhost:4000
```

It prints a URL like `https://random-words.trycloudflare.com`. Open that on your
phone, log in, done. The URL changes every time you restart the command, so this
is for testing — use Option B for a permanent address.

---

## Option B — Named tunnel (permanent URL, auto-starts on boot)

Requires a **free Cloudflare account** and a **domain added to Cloudflare**
(any cheap domain works; point its nameservers at Cloudflare).

```powershell
# 1. Log in (opens a browser to authorize)
cloudflared tunnel login

# 2. Create a named tunnel (stores credentials under %USERPROFILE%\.cloudflared)
cloudflared tunnel create shopops

# 3. Route a hostname on your domain to the tunnel
cloudflared tunnel route dns shopops shop.YOURDOMAIN.com
```

Then create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: shopops
credentials-file: C:\Users\DELL\.cloudflared\<TUNNEL-UUID>.json

ingress:
  - hostname: shop.YOURDOMAIN.com
    service: http://localhost:4000
  - service: http_status:404
```

Install it as a Windows service so it reconnects on every boot:

```powershell
cloudflared service install
```

Now `https://shop.YOURDOMAIN.com` always points at the shop server. After a
reboot: Postgres service → ShopOps scheduled task → cloudflared service all come
back up on their own.

---

## Security notes

- The app **requires login** — only people with an account can see data.
- The tunnel is HTTPS end-to-end; your home IP stays hidden.
- Keep `server/.env` private (it holds the DB password + JWT secret).
- For extra protection on Option B you can add **Cloudflare Access** (email
  one-time-pin) in front of the hostname from the Cloudflare Zero Trust dashboard.
