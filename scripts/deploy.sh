#!/usr/bin/env bash
# Met à jour et redémarre l'API. Lancé par GitHub Actions, ou à la main sur le serveur.
set -euo pipefail

cd "$(dirname "$0")/.."

git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

pm2 startOrReload ecosystem.config.js --update-env
pm2 save
