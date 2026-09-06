@echo off
setlocal
cd /d "%~dp0"
docker compose down
echo Stablecoin Gateway has stopped. Its database and Redis data were kept.
pause

