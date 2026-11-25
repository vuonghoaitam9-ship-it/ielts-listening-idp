@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [1/3] Dang cai dat thu vien Node.js...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

if not exist "public\data\manifest.json" (
  echo [2/3] Dang nap du lieu Vol 7-10 tu F:\IELTS\Vol...
  python scripts\prepare-data.py
  if errorlevel 1 exit /b 1
)

if not exist "dist\data\manifest.json" (
  echo [3/3] Dang dong goi ban chay local (dist)...
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)

echo.
echo Dang mo may chu local tai http://127.0.0.1:4173/
echo Nhan Ctrl+C trong cua so nay neu muon dung may chu.
start "" "http://127.0.0.1:4173/"
call npm.cmd run preview -- --port 4173 --host 127.0.0.1
