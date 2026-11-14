# Shared helpers for the failure scripts. Source it; don't run it.
# Every helper runs docker compose from infra/, and none of them read infra/.env on the host:
# credentials stay inside the containers that already have them.

HB_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$HB_ROOT/infra"

ROBOTS=(robot1 robot2 robot3 robot4)
NET=fleet_default            # compose project "fleet", default network
API=http://127.0.0.1:8000

now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
secs() { python3 -c 'import sys; print(f"{int(sys.argv[1]) / 1000:.1f}")' "$1"; }   # ms -> "12.3"
sleep_until_ms() { python3 -c 'import sys, time; time.sleep(max(0, int(sys.argv[1]) / 1000 - time.time()))' "$1"; }

ctr() { docker compose ps -aq "$1"; }       # container id of a service (running or not)

psql_q() {
  docker compose exec -T timescaledb sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -v ON_ERROR_STOP=1 "$@"' sh "$@"
}

# GET /robots as "robot_id status last_seen_ms" lines; nothing if ingest or the DB is down.
robots_lines() {
  curl -fsS --max-time 2 "$API/robots" 2>/dev/null | python3 -c '
import json, sys
for r in json.load(sys.stdin):
    print(r["robot_id"], r["status"], r["last_seen"] or 0)' 2>/dev/null || true
}
robot_status() { robots_lines | awk -v r="$1" '$1 == r { print $2 }'; }
robot_last_seen() { robots_lines | awk -v r="$1" '$1 == r { print $3 }'; }

# All four robots online, with telemetry newer than $1 (UTC ms, default: 5 s ago).
all_online() {
  local since=${1:-$(( $(now_ms) - 5000 ))}
  [ "$(robots_lines | awk -v s="$since" '$2 == "online" && $3 > s' | wc -l | tr -d ' ')" = 4 ]
}

# Rows in a robot's outbox and the age (ms) of the oldest: "rows age_ms", or "? ?" if unreachable.
queue_state() {
  docker exec "$(ctr "$1")" python3 -c '
import os, sqlite3, time
p = "/data/queue.db"
if not os.path.exists(p):
    print(0, 0)
else:
    n, oldest = sqlite3.connect(f"file:{p}?mode=ro", uri=True).execute(
        "SELECT COUNT(*), MIN(enqueued_at) FROM outbox").fetchone()
    print(n, int(time.time() * 1000) - oldest if n else 0)' 2>/dev/null || echo "? ?"
}
queue_rows() { queue_state "$1" | awk '{ print $1 }'; }

# Wait until every robot's outbox is drained: 0 rows, or 1 row younger than 1 s (in flight).
# Gap reports are only valid after this (live data is sent before backlog).
wait_drained() {
  local timeout_s=${1:-180} start r n age ok
  start=$(now_ms)
  while :; do
    ok=1
    for r in "${ROBOTS[@]}"; do
      read -r n age <<<"$(queue_state "$r")"
      if [ "$n" = "?" ] || { [ "$n" != 0 ] && { [ "$n" != 1 ] || [ "$age" -ge 1000 ]; }; }; then ok=0; break; fi
    done
    [ "$ok" = 1 ] && return 0
    [ $(( $(now_ms) - start )) -gt $(( timeout_s * 1000 )) ] && { log "queues not drained after ${timeout_s} s ($r: $n rows)"; return 1; }
    sleep 0.5
  done
}

# Fire obstacle_stop on a robot. Never call this on a cut robot: ros2 topic pub hangs without
# a network, hence the timeout.
fire_event() {
  docker compose exec -T "$1" bash -c "source /ws/install/setup.bash && timeout 5 ros2 topic pub --once /$1/event std_msgs/msg/String \"{data: '{\\\"type\\\": \\\"obstacle_stop\\\"}'}\"" >/dev/null
}

is_attached() { docker inspect -f '{{json .NetworkSettings.Networks}}' "$(ctr "$1")" | grep -q "\"$NET\""; }

# Cut one robot's network. ROS keeps running on loopback (discovery is LOCALHOST only).
net_cut() { docker network disconnect "$NET" "$(ctr "$1")"; }

# Reconnect with the aliases compose gave it: the service name and the container name.
net_restore() {
  local c name
  c=$(ctr "$1")
  is_attached "$1" && return 0
  name=$(docker inspect -f '{{.Name}}' "$c")
  docker network connect --alias "$1" --alias "${name#/}" "$NET" "$c"
}

# Wait until a robot is online in /robots with telemetry newer than $2 (UTC ms) and its log
# shows an MQTT connect after $2. Prints the ms it took.
wait_reconnected() {
  local r=$1 since=$2 timeout_s=${3:-60} start
  start=$(now_ms)
  until [ "$(robot_status "$r")" = online ] && [ "$(robot_last_seen "$r")" -gt "$since" ] 2>/dev/null &&
        docker compose logs --since "$(secs "$since")" "$r" 2>&1 | grep -q "Connected to Mosquitto"; do
    [ $(( $(now_ms) - start )) -gt $(( timeout_s * 1000 )) ] && { log "$r did not reconnect within ${timeout_s} s"; return 1; }
    sleep 0.5
  done
  echo $(( $(now_ms) - start ))
}

# Temporary mosquitto_sub container. Prints "<arrival unix s.ns> <payload>" per message.
# The credentials come from the mosquitto service's own environment.
watch_start() {
  docker compose run -d --rm --no-deps --name "$1" --entrypoint sh mosquitto \
    -c "exec mosquitto_sub -h mosquitto -u \"\$MQTT_USER\" -P \"\$MQTT_PASSWORD\" -q 1 -F '%U %p' -t '$2'" >/dev/null
  sleep 2   # let it subscribe
}
watch_stop() {   # name outfile
  docker logs "$1" >"$2" 2>/dev/null || true
  docker rm -f "$1" >/dev/null 2>&1 || true
}
