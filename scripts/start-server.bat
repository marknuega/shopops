@echo off
REM Starts the ShopOps server (serves API + built frontend on PORT, default 4000).
REM Used by the Windows scheduled task and for manual starts.
cd /d "%~dp0\.."
node server\src\index.js
