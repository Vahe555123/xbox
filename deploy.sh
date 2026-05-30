#!/usr/bin/env bash
# Pulls latest code, installs dependencies, builds the client, and reloads the API via PM2.

set -e

ROOT="/var/www/xbox"
cd "$ROOT"

echo "==> Pulling latest code"
git pull origin main

echo "==> Installing server deps"
cd "$ROOT/server"
npm ci --omit=dev

echo "==> Installing client deps"
cd "$ROOT/client"
npm ci

echo "==> Building client"
npm run build

echo "==> Publishing dist"
# Vite outputs to client/dist — mirror it into the canonical path nginx serves
rm -rf "$ROOT/dist"
cp -r "$ROOT/client/dist" "$ROOT/dist"

echo "==> Reloading PM2"
cd "$ROOT"
mkdir -p "$ROOT/logs"
pm2 startOrRestart ecosystem.config.js --env production
pm2 save

echo "==> Done"
