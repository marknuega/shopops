@echo off
REM Serves the built ShopOps app (dist/) on port 4173.
REM Used by the "ShopOps App" scheduled task and for manual starts.
cd /d "%~dp0\.."
node scripts\serve-static.mjs
