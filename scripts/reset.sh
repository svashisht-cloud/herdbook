#!/usr/bin/env bash
# Clean fleet from scratch: wipe every volume (DB, broker, MinIO, each robot's queue.db and
# clips), rebuild, start, and wait until it's usable: minio-init exited 0, ingest subscribed,
# and all 4 robots online in GET /robots. Prints the elapsed time. Never touches infra/.env.
#
# Usage: scripts/reset.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

START=$(now_ms)
TIMEOUT_S=300
log "docker compose down -v"
docker compose down -v --remove-orphans
log "docker compose up -d --build"
docker compose up -d --build

init_ok= sub_ok= online_ok=
while :; do
  el=$(( $(now_ms) - START ))
  if [ -z "$init_ok" ]; then
    read -r st code <<<"$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$(ctr minio-init)" 2>/dev/null || echo "missing -")"
    if [ "$st" = exited ]; then
      [ "$code" = 0 ] || die "minio-init exited $code (docker compose logs minio-init)"
      init_ok=$el; log "minio-init exited 0 ($(secs "$el") s)"
    fi
  fi
  if [ -z "$sub_ok" ] && docker compose logs ingest 2>&1 | grep -q "subscribed to"; then
    sub_ok=$el; log "ingest subscribed ($(secs "$el") s)"
  fi
  if [ -z "$online_ok" ] && all_online; then
    online_ok=$el; log "all 4 robots online ($(secs "$el") s)"
  fi
  [ -n "$init_ok" ] && [ -n "$sub_ok" ] && [ -n "$online_ok" ] && break
  [ "$el" -gt $(( TIMEOUT_S * 1000 )) ] && die "not ready after ${TIMEOUT_S} s (minio-init: ${init_ok:-no}, ingest subscribed: ${sub_ok:-no}, robots online: ${online_ok:-no})"
  sleep 1
done
echo "reset done in $(secs $(( $(now_ms) - START ))) s"
