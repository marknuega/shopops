# Permanent free URL for ShopOps — Tailscale Funnel

Gives the app a **stable HTTPS URL** (e.g. `https://dell-pc.tailXXXX.ts.net`) that
survives reboots, needs **no domain**, and is **free**. Tailscale runs as a Windows
service that auto-starts on boot. Later you can move to a paid Cloudflare domain
(see `setup-tunnel.md`) without changing the app.

Two pieces must always be running on this PC:
1. The ShopOps app served on `http://localhost:4173` (the "ShopOps App" scheduled task).
2. Tailscale Funnel exposing that port publicly.

`cloudflared` (Tailscale's binary) is at `C:\Program Files\Tailscale\tailscale.exe`.
In the commands below it's shown via the PowerShell call operator `&`.

---

## One-time setup

### 1. Serve the built app permanently (Admin PowerShell)
```powershell
cd "C:\Users\DELL\Downloads\shopops"
npm run build
powershell -ExecutionPolicy Bypass -File scripts\install-app-startup.ps1
Start-ScheduledTask -TaskName "ShopOps App"
```
This serves `dist/` on port 4173 now and at every boot.

### 2. Log in to Tailscale (opens a browser)
```powershell
& "C:\Program Files\Tailscale\tailscale.exe" up
```
Sign in with Google / Microsoft / GitHub / email (free **Personal** plan). This
connects the PC to your private tailnet.

### 3. Expose the app over the public internet with Funnel
```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 4173
```
- `--bg` keeps it running in the background and **persists across reboots**.
- If Funnel isn't enabled yet, the command prints a URL — open it, click
  **Enable Funnel** for this device, then re-run the command.

### 4. Get your permanent URL
```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel status
```
It shows something like:
```
https://dell-pc.tailXXXX.ts.net
|-- / proxy http://127.0.0.1:4173
```
Open that URL on your phone — it works from anywhere, on any network.

---

## Managing it
```powershell
# see what's exposed
& "C:\Program Files\Tailscale\tailscale.exe" funnel status

# stop exposing (app stays running locally)
& "C:\Program Files\Tailscale\tailscale.exe" funnel --bg off

# the app server itself
Start-ScheduledTask -TaskName "ShopOps App"
Stop-ScheduledTask  -TaskName "ShopOps App"
```

## Notes
- After a reboot: the **Tailscale service** + the **ShopOps App task** both auto-start,
  so the URL keeps working with no action from you.
- Standalone mode still stores data **per-device** in the browser. For one shared
  live dataset across phone + shop, do the database/server phase, point Funnel at
  port **4000** instead of 4173, and turn off `MOCK` in `src/config.js`.
- You can stop the temporary `trycloudflare` tunnel and the `vite preview` from
  earlier — they're replaced by this setup.
