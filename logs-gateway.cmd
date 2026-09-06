@echo off
setlocal
cd /d "%~dp0"
echo Press Ctrl+C to stop watching logs. The gateway will keep running.
docker compose logs --follow --tail 150 api worker web migrate

