@echo off
setlocal enabledelayedexpansion

echo === 1. Kiem tra dung luong du lieu (Gioi han GitHub 100MB/file, Pages ^< 1GB) ===
node scripts/check-size.mjs
if errorlevel 1 exit /b 1

echo === 2. Chay Unit Tests ===
call npm.cmd run test -- --run
if errorlevel 1 exit /b 1

echo === 3. Build ung dung ===
call npm.cmd run build
if errorlevel 1 exit /b 1

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  git init -b main
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo.
  echo Chua cau hinh remote 'origin'. Hay tao repository tren GitHub va chay:
  echo   git remote add origin https://github.com/[ten-tai-khoan]/[ten-repo].git
  echo   git add .
  echo   git commit -m "feat: initial IELTS Listening IDP suite (Vol 7-10)"
  echo   git push -u origin main
  exit /b 0
)

git add .
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore: update IELTS Listening IDP app & data"
)

echo === 4. Day len GitHub ===
git push -u origin main
echo Hoan tat! Kiem tra tab Actions va Settings ^> Pages tren GitHub.
