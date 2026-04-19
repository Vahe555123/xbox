#!/usr/bin/env bash
# Runs on the server after `git pull` during `pm2 deploy production update`.
# Installs dependencies, builds the client, and reloads the API via PM2.

set -e

ROOT="/var/www/xbox"
cd "$ROOT"

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
pm2 startOrReload ecosystem.config.js --env production
pm2 save

echo "==> Done"
