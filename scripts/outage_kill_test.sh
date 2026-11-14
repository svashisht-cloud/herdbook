#!/usr/bin/env bash
# Outage + crash test: does data captured during a broker outage survive a robot crash?
#
#   1. stop the broker (robots keep their Docker network, so ros2 still works inside them)
#   2. fire an event on robot4
#   3. 20 s later, SIGKILL robot4 (no graceful shutdown)
#   4. start the broker, then robot4
#   5. once robot4 is back, print robot4's incidents since step 1 and its telemetry in the
#      outage window, grouped by boot_id
#
# Pass: the incident row exists and the old boot_id has rows up to the kill with no seq gaps.
# The hole between the kill and the restart is real (nothing was running) and expected.
#
# Usage: scripts/outage_kill_test.sh     (run with the whole stack up)
set -euo pipefail
cd "$(dirname "$0")/../infra"

ROBOT=robot4
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
psql_q() { docker compose exec -T timescaledb sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q "$@"' sh "$@"; }
queue_rows() {
  # Rows waiting in the robot's outbox; "none" if there is no queue.db (pre-Step-6 code).
  docker compose exec -T "$ROBOT" python3 -c '
import os, sqlite3
p = "/data/queue.db"
if not os.path.exists(p):
    print("none")
else:
    print(sqlite3.connect(f"file:{p}?mode=ro", uri=True).execute("SELECT COUNT(*) FROM outbox").fetchone()[0])
' 2>/dev/null || echo "?"
}

T0=$(now_ms)
echo "== 1. T0=$T0: stopping mosquitto"
docker compose stop mosquitto

echo "== 2. firing obstacle_stop on $ROBOT"
# timeout: ros2 topic pub can hang (e.g. a container with no network); --once exits after one send.
docker compose exec -T "$ROBOT" bash -c "source /ws/install/setup.bash && timeout 5 ros2 topic pub --once /$ROBOT/event std_msgs/msg/String \"{data: '{\\\"type\\\": \\\"obstacle_stop\\\"}'}\"" \
  || echo "   (ros2 topic pub exited non-zero)"

echo "== 3. waiting 20 s, then SIGKILL $ROBOT"
sleep 20
T_KILL=$(now_ms)
docker compose kill -s SIGKILL "$ROBOT"
echo "   T_KILL=$T_KILL"

echo "== 4. starting mosquitto, then $ROBOT"
docker compose start mosquitto
docker compose start "$ROBOT"
T_RESTART=$(now_ms)
echo "   T_RESTART=$T_RESTART"

echo "== 5. waiting for $ROBOT to reconnect (telemetry from a new boot_id)"
for i in $(seq 1 120); do
  n=$(psql_q -At -c "SELECT count(*) FROM telemetry WHERE robot_id='$ROBOT' AND boot_id > $T_KILL AND ts > to_timestamp($T_KILL/1000.0)")
  [ "$n" -gt 0 ] && break
  sleep 1
done
[ "$n" -gt 0 ] || { echo "   $ROBOT did not reconnect within 120 s"; exit 1; }
echo "   reconnected after ~${i} s; waiting for its queue to drain"
for i in $(seq 1 60); do
  q=$(queue_rows)
  { [ "$q" = "none" ] || [ "$q" = "0" ]; } && break
  sleep 1
done
echo "   rows in $ROBOT queue.db: $q"
sleep 5

echo
echo "== incidents for $ROBOT with event_ts >= T0"
psql_q -c "SELECT id, robot_id, (extract(epoch FROM event_ts)*1000)::bigint AS event_ts_ms, type, status, mcap_key
           FROM incidents WHERE robot_id='$ROBOT' AND event_ts >= to_timestamp($T0/1000.0) ORDER BY event_ts"

echo "== $ROBOT telemetry with ts in [T0, T_RESTART], by boot_id"
psql_q -c "SELECT boot_id, count(*) AS rows, min(seq) AS min_seq, max(seq) AS max_seq,
                  (extract(epoch FROM min(ts))*1000)::bigint - $T0 AS first_ms_after_t0,
                  (extract(epoch FROM max(ts))*1000)::bigint - $T_KILL AS last_ms_vs_kill
           FROM telemetry WHERE robot_id='$ROBOT'
             AND ts BETWEEN to_timestamp($T0/1000.0) AND to_timestamp($T_RESTART/1000.0)
           GROUP BY boot_id ORDER BY boot_id"

echo "T0=$T0 T_KILL=$T_KILL T_RESTART=$T_RESTART  (gap check: scripts/gap_report.sh $T0)"
