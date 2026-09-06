@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker was not found.
  echo Install and start Docker Desktop, then run this file again.
  echo https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop is installed but is not running.
  echo Start Docker Desktop, wait until it says the engine is running, then try again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo A new .env configuration file has been created.
  echo Notepad will open it now. Complete the REQUIRED settings, save it, and run
  echo start-gateway.cmd again.
  start "" /wait notepad.exe ".env"
  exit /b 0
)

set "CONFIG_ERROR="
findstr /R /B /C:"ADMIN_API_KEY=." ".env" >nul || (echo Missing: ADMIN_API_KEY & set "CONFIG_ERROR=1")
findstr /R /B /C:"WALLET_MNEMONIC=." ".env" >nul || (echo Missing: WALLET_MNEMONIC & set "CONFIG_ERROR=1")
findstr /R /B /C:"POLYGON_RPC_URL=." ".env" >nul || (echo Missing: POLYGON_RPC_URL & set "CONFIG_ERROR=1")
findstr /R /B /C:"BSC_RPC_URL=." ".env" >nul || (echo Missing: BSC_RPC_URL & set "CONFIG_ERROR=1")
findstr /R /B /C:"PAYSTACK_SECRET_KEY=." ".env" >nul || (echo Missing: PAYSTACK_SECRET_KEY & set "CONFIG_ERROR=1")

findstr /B /C:"CHAIN_DETECTION_MODE=alchemy" ".env" >nul
if not errorlevel 1 (
  findstr /R /B /C:"ALCHEMY_NOTIFY_AUTH_TOKEN=." ".env" >nul || (echo Missing: ALCHEMY_NOTIFY_AUTH_TOKEN & set "CONFIG_ERROR=1")
  findstr /R /B /C:"ALCHEMY_POLYGON_WEBHOOK_ID=." ".env" >nul || (echo Missing: ALCHEMY_POLYGON_WEBHOOK_ID & set "CONFIG_ERROR=1")
  findstr /R /B /C:"ALCHEMY_BSC_WEBHOOK_ID=." ".env" >nul || (echo Missing: ALCHEMY_BSC_WEBHOOK_ID & set "CONFIG_ERROR=1")
  findstr /R /B /C:"ALCHEMY_POLYGON_SIGNING_KEY=." ".env" >nul || (echo Missing: ALCHEMY_POLYGON_SIGNING_KEY & set "CONFIG_ERROR=1")
  findstr /R /B /C:"ALCHEMY_BSC_SIGNING_KEY=." ".env" >nul || (echo Missing: ALCHEMY_BSC_SIGNING_KEY & set "CONFIG_ERROR=1")
)

if defined CONFIG_ERROR (
  echo.
  echo Complete the settings listed above. Notepad will open .env now.
  start "" /wait notepad.exe ".env"
  exit /b 1
)

echo Building and starting Stablecoin Gateway...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Startup failed. Run logs-gateway.cmd to see the reason.
  pause
  exit /b 1
)

echo.
docker compose ps
echo.
echo Waiting for the dashboard to become ready...
for /L %%I in (1,1,30) do (
  powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5173/health; if ($r.StatusCode -eq 200) { exit 0 } }; exit 1" >nul 2>&1
  if not errorlevel 1 goto gateway_ready
  timeout /t 2 /nobreak >nul
)

echo The containers started, but the dashboard did not become ready in 60 seconds.
echo Run logs-gateway.cmd to inspect the startup logs.
pause
exit /b 1

:gateway_ready
echo Stablecoin Gateway is ready at http://localhost:5173
start "" "http://localhost:5173"
pause
