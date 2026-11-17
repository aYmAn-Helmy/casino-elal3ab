#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "== Docker =="
docker compose -f docker-compose.yml ps
echo
echo "== Health =="
port="$(sed -n 's/^PORT=//p' .env | tail -n1)"
curl -fsS --max-time 5 "http://127.0.0.1:${port:-3000}/api/health" || true
echo
echo "== Logs =="
docker compose -f docker-compose.yml logs --tail=60
