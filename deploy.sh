#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Kiem tra dung luong du lieu (Gioi han GitHub 100MB/file, Pages < 1GB) ==="
node scripts/check-size.mjs

echo "=== 2. Chay Unit Tests ==="
npm run test -- --run

echo "=== 3. Build ung dung ==="
npm run build

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b main
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo ""
  echo "Chua cau hinh remote 'origin'. Hay tao repository tren GitHub va chay:"
  echo "  git remote add origin https://github.com/[ten-tai-khoan]/[ten-repo].git"
  echo "  git add ."
  echo "  git commit -m \"feat: initial IELTS Listening IDP suite (Vol 7-10)\""
  echo "  git push -u origin main"
  exit 0
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "chore: update IELTS Listening IDP app & data"
fi

echo "=== 4. Day len GitHub ==="
git push -u origin main
echo "Hoan tat! Kiem tra tab Actions tren GitHub de xem trang thai GitHub Pages."
