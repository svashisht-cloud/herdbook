#!/usr/bin/env bash
# Failure scenarios with pass/fail asserts. Each scenario records its start time, injects a
# fault, restores, WAITS for every robot's queue.db to drain, and only then runs the gap
# report scoped to its start (a gap report taken before the drain is invalid: live data is
# sent before backlog, so the database has temporary holes).
#
# Per (robot_id, boot_id): 0 seq gaps and 0 ts gaps over 1 s. A hole between two boot_ids
# after a kill is expected and labelled, not failed.
#
#   1. robot cut 60 s (robot3)        outbox; offline via Last Will; no gaps
#   2. broker restart, 30 s down      outbox on all robots; retained status recovers
#   3. DB outage 60 s                 ingest persistent session + DB retry; ingest stays up
#   4. kill mid-drain (robot4)        ack-after-commit + dedupe; redelivery observed
#   5. MinIO down during clip upload  clip retry; recording -> ready exactly once
#   6. 5-minute cut (robot1)          drain order: live first, backlog oldest first, <= 50 msg/s
#
# Usage: scripts/failure_demo.sh [--quick] [--scenario N] [--no-reset]
#   --quick       scenarios 1-3 only
#   --scenario N  only scenario N
#   --no-reset    skip scripts/reset.sh (default: reset first)
# Exits non-zero if any scenario fails.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SCENARIOS=(1 2 3 4 5 6)
RESET=1
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) SCENARIOS=(1 2 3) ;;
    --scenario) SCENARIOS=("${2:?--scenario needs a number}"); shift ;;
    --no-reset) RESET=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
for n in "${SCENARIOS[@]}"; do case "$n" in [1-6]) ;; *) echo "no scenario $n" >&2; exit 2 ;; esac; done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/herdbook-failure.XXXXXX")
WATCHERS=()
BG_PIDS=()
RESULTS=()
FAILED=0

cleanup() {
  local r p w
  for p in ${BG_PIDS[@]+"${BG_PIDS[@]}"}; do kill "$p" 2>/dev/null || true; done
  for w in ${WATCHERS[@]+"${WATCHERS[@]}"}; do docker rm -f "$w" >/dev/null 2>&1 || true; done
  # Undo any fault left behind by an error or Ctrl-C.
  docker compose start mosquitto timescaledb minio >/dev/null 2>&1 || true
  for r in "${ROBOTS[@]}"; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$(ctr "$r")" 2>/dev/null)" = true ]; then
      net_restore "$r" 2>/dev/null || true
    else
      docker compose start "$r" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# record N name fault numbers verdict
record() {
  RESULTS+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"$5")
  [ "$5" = PASS ] || FAILED=1
  printf '\n>>> RESULT %s | %s | %s | %s | %s\n\n' "$1" "$2" "$3" "$4" "$5"
}

# Gap check since $1 (UTC ms). $2: robot whose restart is expected (kill), or empty.
# Prints details to stderr and one summary line to stdout; returns 1 on an unexpected gap.
check_gaps() {
  "$HB_ROOT/scripts/gap_report.sh" --tsv "$1" >"$WORK/gaps.tsv"
  python3 - "$WORK/gaps.tsv" "${2:-}" <<'PY'
import sys
path, expect_restart = sys.argv[1], sys.argv[2]
boots, queues, problems, notes = {}, {}, [], []
for line in open(path):
    f = line.rstrip("\n").split("\t")
    if f[0] == "gap":
        robot, boot = f[1], f[2]
        rows, mn, mx, sg, tg, missing, gfrom, gto, maxdts, mints, maxts = map(int, f[3:])
        boots.setdefault(robot, []).append(dict(boot=boot, rows=rows, mn=mn, mx=mx, sg=sg, tg=tg,
            missing=missing, gfrom=gfrom, gto=gto, maxdts=maxdts, mints=mints, maxts=maxts))
    elif f[0] == "queue":
        queues[f[1]] = f[2]
total = 0
for robot in ("robot1", "robot2", "robot3", "robot4"):
    bl = sorted(boots.get(robot, []), key=lambda b: b["mints"])
    if not bl:
        problems.append(f"{robot}: no telemetry in the window")
        continue
    for b in bl:
        total += b["rows"]
        print(f"   {robot} boot {b['boot']}: {b['rows']} rows, seq {b['mn']}-{b['mx']}, "
              f"seq gaps {b['sg']}, ts gaps >1 s {b['tg']}", file=sys.stderr)
        if b["sg"]:
            problems.append(f"{robot} boot {b['boot']}: {b['sg']} seq gap(s), {b['missing']} rows missing, "
                            f"first gap seq {b['gfrom']}->{b['gto']}")
        if b["tg"]:
            problems.append(f"{robot} boot {b['boot']}: {b['tg']} ts gap(s) over 1 s, largest {b['maxdts'] / 1000:.1f} s")
    for prev, nxt in zip(bl, bl[1:]):
        hole = (nxt["mints"] - prev["maxts"]) / 1000
        if robot == expect_restart:
            notes.append(f"{robot}: expected: kill->restart hole, {hole:.1f} s")
        else:
            problems.append(f"{robot}: unexpected restart (boot {prev['boot']} -> {nxt['boot']}, hole {hole:.1f} s)")
for robot, q in sorted(queues.items()):
    if q not in ("0", "1"):
        problems.append(f"{robot}: queue.db not drained ({q} rows)")
for n in notes:
    print("   " + n, file=sys.stderr)
for p in problems:
    print("   GAP: " + p, file=sys.stderr)
summary = f"{total} rows, " + ("; ".join(problems) if problems else "0 seq gaps, 0 ts gaps")
if notes:
    summary += "; " + "; ".join(notes)
print(summary)
sys.exit(1 if problems else 0)
PY
}

# Rows in the window vs distinct keys. Prints "rows distinct_key distinct_boot_seq".
dup_counts() {
  psql_q -At -F ' ' -c "SELECT count(*), count(DISTINCT (robot_id, seq, ts)), count(DISTINCT (robot_id, boot_id, seq))
                        FROM telemetry WHERE ts >= to_timestamp($1 / 1000.0)"
}

# Before each scenario: everything up, online and drained.
precheck() {
  local start; start=$(now_ms)
  until all_online; do
    [ $(( $(now_ms) - start )) -gt 120000 ] && die "fleet not online before scenario $1"
    sleep 1
  done
  wait_drained 120 || die "queues not drained before scenario $1"
}

# ---------------------------------------------------------------------------------------

scenario1() {
  local name="robot cut 60 s" fault="network disconnect robot3, 60 s" T0 tcut toff trest tconn tdrain gaps v=PASS
  log "== 1. $name"
  precheck 1; T0=$(now_ms)
  net_cut robot3; tcut=$(now_ms)
  until [ "$(robot_status robot3)" = offline ]; do
    [ $(( $(now_ms) - tcut )) -gt 30000 ] && { record 1 "$name" "$fault" "robot3 never went offline" FAIL; net_restore robot3; return; }
    sleep 0.5
  done
  toff=$(now_ms); log "   offline in /robots after $(secs $((toff - tcut))) s"
  sleep_until_ms $((tcut + 60000))
  log "   robot3 queue at restore: $(queue_rows robot3) rows"
  net_restore robot3; trest=$(now_ms)
  tconn=$(wait_reconnected robot3 "$trest" 60) || { record 1 "$name" "$fault" "robot3 did not reconnect" FAIL; return; }
  wait_drained 180 || v=FAIL; tdrain=$(now_ms)
  gaps=$(check_gaps "$T0") || v=FAIL
  record 1 "$name" "$fault" "offline after $(secs $((toff - tcut))) s; reconnect $(secs "$tconn") s; queue empty $(secs $((tdrain - trest))) s after restore; $gaps" "$v"
}

scenario2() {
  local name="broker restart" fault="mosquitto stopped 30 s" T0 tstart tonline tdrain gaps retained v=PASS
  log "== 2. $name"
  precheck 2; T0=$(now_ms)
  docker compose stop mosquitto >/dev/null
  sleep 30
  docker compose start mosquitto >/dev/null; tstart=$(now_ms)
  until all_online "$tstart"; do
    [ $(( $(now_ms) - tstart )) -gt 60000 ] && { v=FAIL; break; }
    sleep 0.5
  done
  tonline=$(now_ms)
  wait_drained 180 || v=FAIL; tdrain=$(now_ms)
  # Retained status as a new subscriber sees it (exit code 27 = -W timeout, expected).
  retained=$(docker compose exec -T mosquitto sh -c \
    'mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t "fleet/+/status" -v --retained-only -W 3' 2>/dev/null || true)
  log "   retained: $(echo "$retained" | tr '\n' ' ')"
  [ "$(echo "$retained" | grep -c ' online$')" = 4 ] || v=FAIL
  gaps=$(check_gaps "$T0") || v=FAIL
  record 2 "$name" "$fault" "all online $(secs $((tonline - tstart))) s after broker start; queues empty $(secs $((tdrain - tstart))) s; retained online: $(echo "$retained" | grep -c ' online$')/4; $gaps" "$v"
}

scenario3() {
  local name="DB outage" fault="timescaledb stopped 60 s" T0 before after tstart tcaught retries gaps d v=PASS
  log "== 3. $name"
  precheck 3; T0=$(now_ms)
  before=$(docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' "$(ctr ingest)")
  docker compose stop timescaledb >/dev/null
  sleep 30
  [ "$(docker inspect -f '{{.State.Running}}' "$(ctr ingest)")" = true ] || v=FAIL
  sleep 30
  docker compose start timescaledb >/dev/null; tstart=$(now_ms)
  # Caught up: every robot's newest row in the DB is within 2 s of now.
  until [ "$(psql_q -At -c "SELECT count(*) FROM (SELECT robot_id FROM telemetry WHERE ts >= now() - interval '2 seconds' GROUP BY robot_id) s" 2>/dev/null)" = 4 ]; do
    [ $(( $(now_ms) - tstart )) -gt 120000 ] && { v=FAIL; break; }
    sleep 0.5
  done
  tcaught=$(now_ms)
  wait_drained 180 || v=FAIL
  after=$(docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' "$(ctr ingest)")
  [ "$before" = "$after" ] || { log "   ingest restarted: $before -> $after"; v=FAIL; }
  retries=$(docker compose logs --since "$(secs "$T0")" ingest 2>&1 | grep -c "Database error, retrying" || true)
  read -r rows k1 k2 <<<"$(dup_counts "$T0")"
  [ "$rows" = "$k1" ] && [ "$rows" = "$k2" ] || v=FAIL
  gaps=$(check_gaps "$T0") || v=FAIL
  record 3 "$name" "$fault" "ingest up, not restarted ($retries DB retries logged); caught up $(secs $((tcaught - tstart))) s after DB start; rows $rows = distinct keys $k1; $gaps" "$v"
}

scenario4() {
  local name="kill mid-drain" fault="cut robot4 90 s, SIGKILL mid-drain" T0 depth q tkill pct tstart attempt gaps v=PASS
  log "== 4. $name"
  precheck 4; T0=$(now_ms)
  WATCHERS+=(hb-watch-robot4); watch_start hb-watch-robot4 fleet/robot4/telemetry
  for attempt in 1 2; do
    net_cut robot4; sleep 90
    depth=$(queue_rows robot4)
    net_restore robot4
    log "   restored with $depth rows queued; waiting for 20-80% drained"
    tkill=; local t=$(now_ms)
    while [ $(( $(now_ms) - t )) -lt 60000 ]; do
      q=$(queue_rows robot4)
      [ "$q" = "?" ] && { sleep 0.1; continue; }
      if [ "$q" -le $(( depth * 80 / 100 )) ] && [ "$q" -ge $(( depth * 20 / 100 )) ]; then
        docker compose kill -s SIGKILL robot4 >/dev/null; tkill=$(now_ms)
        pct=$(( (depth - q) * 100 / depth )); break
      fi
      [ "$q" -lt $(( depth * 20 / 100 )) ] && break   # missed the window
      sleep 0.1
    done
    [ -n "$tkill" ] && break
    log "   missed the 20-80% window (queue at $q of $depth); attempt $attempt"
    wait_drained 120 || true
  done
  [ -n "$tkill" ] || { record 4 "$name" "$fault" "could not kill inside the 20-80% window" FAIL; return; }
  log "   killed robot4 with $q of $depth rows left (${pct}% drained)"
  docker compose start robot4 >/dev/null; tstart=$(now_ms)
  wait_reconnected robot4 "$tstart" 120 >/dev/null || v=FAIL
  wait_drained 180 || v=FAIL
  sleep 2
  watch_stop hb-watch-robot4 "$WORK/watch4.log"
  local redeliv
  redeliv=$(python3 - "$WORK/watch4.log" "$tkill" <<'PY'
import json, sys
seen, dups, after_kill = {}, 0, 0
tkill = int(sys.argv[2])
for line in open(sys.argv[1]):
    try:
        arrival, payload = line.split(" ", 1)
        m = json.loads(payload)
    except ValueError:
        continue
    k = (m["boot_id"], m["seq"])
    if k in seen:
        dups += 1
        if float(arrival) * 1000 > tkill:
            after_kill += 1
    seen[k] = seen.get(k, 0) + 1
print(len(seen), dups, after_kill)
PY
)
  read -r distinct dups dups_after <<<"$redeliv"
  log "   MQTT watcher: $distinct distinct (boot_id, seq), $dups duplicate deliveries ($dups_after after the kill)"
  [ "$dups_after" -gt 0 ] || { log "   redelivery after the kill not observed"; v=FAIL; }
  read -r rows k1 k2 <<<"$(dup_counts "$T0")"
  [ "$rows" = "$k1" ] && [ "$rows" = "$k2" ] || v=FAIL
  gaps=$(check_gaps "$T0" robot4) || v=FAIL
  record 4 "$name" "$fault" "killed at ${pct}% drained ($q/$depth left); redelivered $dups_after rows after kill ($dups dup deliveries total), DB rows $rows = distinct keys $k1; $gaps" "$v"
}

scenario5() {
  local name="MinIO down during upload" fault="event on robot2, minio stopped 60 s from +20 s" T0 tev inc id status tstop tstart tready
  local clips retries url code rows pushes left gaps v=PASS
  log "== 5. $name"
  precheck 5; T0=$(now_ms)
  # Listen on /ws from inside the ingest container (it ships websockets); lives 300 s max.
  docker compose exec -T ingest python -c '
import asyncio, json, sys, time, websockets
async def main(dur):
    end = time.time() + dur
    async with websockets.connect("ws://127.0.0.1:8000/ws") as ws:
        print("connected", flush=True)
        while time.time() < end:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), end - time.time()))
            except asyncio.TimeoutError:
                break
            if m.get("type") == "incident":
                print(json.dumps(m["incident"]), flush=True)
asyncio.run(main(300))' >"$WORK/ws5.log" 2>&1 &
  BG_PIDS+=($!)
  local t=$(now_ms); until grep -q connected "$WORK/ws5.log"; do [ $(( $(now_ms) - t )) -gt 15000 ] && die "WS listener did not connect"; sleep 0.2; done
  fire_event robot2 || { record 5 "$name" "$fault" "ros2 topic pub failed" FAIL; return; }
  tev=$(now_ms)
  t=$tev
  until inc=$(curl -fsS "$API/incidents?since=$T0" | python3 -c '
import json, sys
rows = [r for r in json.load(sys.stdin) if r["robot_id"] == "robot2"]
print(rows[0]["id"], rows[0]["status"]) if rows else sys.exit(1)' 2>/dev/null); do
    [ $(( $(now_ms) - t )) -gt 15000 ] && { record 5 "$name" "$fault" "no incident row" FAIL; return; }
    sleep 0.5
  done
  read -r id status <<<"$inc"; log "   incident $id: $status"
  sleep_until_ms $((tev + 20000))
  docker compose stop minio >/dev/null; tstop=$(now_ms); log "   minio stopped"
  sleep_until_ms $((tstop + 55000))
  status=$(curl -fsS "$API/incidents?since=$T0" | python3 -c "import json,sys; print([r['status'] for r in json.load(sys.stdin) if r['id']==$id][0])" 2>/dev/null) || status=unknown
  clips=$(docker exec "$(ctr robot2)" find /data/clips -name '*.mcap' | grep -c .  || true)
  retries=$(docker compose logs --since "$(secs "$T0")" robot2 2>&1 | grep -c "failed, retrying" || true)
  log "   during the outage: status=$status, .mcap files in /data/clips=$clips, upload retries logged=$retries"
  [ "$status" = recording ] && [ "$clips" -ge 1 ] && [ "$retries" -ge 1 ] || v=FAIL
  sleep_until_ms $((tstop + 60000))
  docker compose start minio >/dev/null; tstart=$(now_ms); log "   minio started"
  until [ "$(curl -fsS "$API/incidents?since=$T0" | python3 -c "import json,sys; print([r['status'] for r in json.load(sys.stdin) if r['id']==$id][0])" 2>/dev/null)" = ready ]; do
    [ $(( $(now_ms) - tstart )) -gt 120000 ] && { record 5 "$name" "$fault" "incident never became ready" FAIL; return; }
    sleep 0.5
  done
  tready=$(now_ms)
  url=$(curl -fsS "$API/incidents/$id/download" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])' 2>/dev/null) || url=
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null) || code=none
  sleep 3
  rows=$(psql_q -At -c "SELECT count(*) FROM incidents WHERE event_ts >= to_timestamp($T0 / 1000.0)")
  pushes=$(python3 -c '
import json, sys
n = 0
for line in open(sys.argv[1]):
    try:
        i = json.loads(line)
    except ValueError:
        continue
    n += i.get("id") == int(sys.argv[2]) and i.get("status") == "ready"
print(n)' "$WORK/ws5.log" "$id")
  left=$(docker exec "$(ctr robot2)" sh -c 'ls -A /data/clips | wc -l' | tr -d ' ')
  log "   ready $(secs $((tready - tstart))) s after minio start; download HTTP $code; incident rows $rows; ready pushes $pushes; files left in /data/clips $left"
  [ "$code" = 200 ] && [ "$rows" = 1 ] && [ "$pushes" = 1 ] && [ "$left" = 0 ] || v=FAIL
  wait_drained 120 || v=FAIL
  gaps=$(check_gaps "$T0") || v=FAIL
  record 5 "$name" "$fault" "recording during outage, clip held, $retries retries logged; ready $(secs $((tready - tstart))) s after MinIO start; download $code; $rows row, $pushes ready push, clips dir empty; $gaps" "$v"
}

scenario6() {
  local name="5-minute outage" fault="network disconnect robot1, 300 s" T0 depth trest tconn tdrain gaps v=PASS
  log "== 6. $name"
  precheck 6; T0=$(now_ms)
  WATCHERS+=(hb-watch-robot1); watch_start hb-watch-robot1 fleet/robot1/telemetry
  net_cut robot1
  sleep 300
  depth=$(queue_rows robot1)
  # Sample now - last_seen for every robot every 0.5 s through the drain.
  python3 - "$API" >"$WORK/lag6.log" <<'PY' &
import json, sys, time, urllib.request
while True:
    t = time.time() * 1000
    try:
        rows = json.load(urllib.request.urlopen(sys.argv[1] + "/robots", timeout=2))
        print(int(t), " ".join(f"{r['robot_id']}:{int(t - (r['last_seen'] or 0))}:{r['status']}" for r in rows), flush=True)
    except Exception:
        pass
    time.sleep(max(0, 0.5 - (time.time() * 1000 - t) / 1000))
PY
  BG_PIDS+=($!); local sampler=$!
  net_restore robot1; trest=$(now_ms)
  log "   restored with $depth rows queued"
  tconn=$(wait_reconnected robot1 "$trest" 60) || { record 6 "$name" "$fault" "robot1 did not reconnect" FAIL; return; }
  tconn=$((trest + tconn))
  wait_drained 600 || v=FAIL; tdrain=$(now_ms)
  kill "$sampler" 2>/dev/null || true
  sleep 2
  watch_stop hb-watch-robot1 "$WORK/watch6.log"
  local analysis
  analysis=$(python3 - "$WORK/lag6.log" "$WORK/watch6.log" "$trest" "$tconn" "$tdrain" <<'PY'
import json, sys
lagf, watchf = sys.argv[1], sys.argv[2]
trest, tconn, tdrain = map(int, sys.argv[3:6])
# Lag while backlog drains: from robot1's reconnect until its queue is empty.
r1, others = [], []
for line in open(lagf):
    t, *rest = line.split()
    t = int(t)
    for item in rest:
        rid, lag, _ = item.split(":")
        if rid == "robot1" and tconn <= t <= tdrain:
            r1.append(int(lag))
        elif rid != "robot1":
            others.append(int(lag))
# Backlog = rows older than 3 s when they arrived; check they arrive oldest first.
backlog, seen, maxseq, inversions = [], set(), {}, 0
for line in open(watchf):
    try:
        arrival, payload = line.split(" ", 1)
        m = json.loads(payload)
    except ValueError:
        continue
    a = float(arrival) * 1000
    if a < trest or a - m["ts"] <= 3000:
        continue
    k = (m["boot_id"], m["seq"])
    if k in seen:
        continue                                  # re-send after reconnect, not an order violation
    seen.add(k)
    if m["seq"] < maxseq.get(m["boot_id"], -1):
        inversions += 1
    maxseq[m["boot_id"]] = max(maxseq.get(m["boot_id"], -1), m["seq"])
    backlog.append(a)
span = (backlog[-1] - backlog[0]) / 1000 if len(backlog) > 1 else 0
rate = len(backlog) / span if span else 0
print(max(r1) if r1 else -1, len(r1), max(others) if others else -1, len(backlog), f"{rate:.1f}", inversions)
PY
)
  local r1max r1n omax nback rate inv
  read -r r1max r1n omax nback rate inv <<<"$analysis"
  log "   robot1 lag during drain: max $r1max ms over $r1n samples; robot2-4 max lag $omax ms"
  log "   backlog: $nback rows at $rate msg/s, $inv out-of-order; drain $(secs $((tdrain - tconn))) s"
  log "   strict FIFO would have started robot1's lag near 300 s and only reached live when the backlog finished"
  [ "$r1n" -gt 0 ] && [ "$r1max" -lt 3000 ] && [ "$omax" -lt 3000 ] && [ "$inv" = 0 ] && [ "$nback" -gt 0 ] || v=FAIL
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) <= 55 else 1)' "$rate" || v=FAIL
  gaps=$(check_gaps "$T0") || v=FAIL
  record 6 "$name" "$fault" "robot1 lag max $(secs "$r1max") s during drain ($r1n samples; strict FIFO would start near 300 s); backlog $nback rows oldest first ($inv inversions) at $rate msg/s; drain $(secs $((tdrain - tconn))) s; robot2-4 max lag $(secs "$omax") s; $gaps" "$v"
}

# ---------------------------------------------------------------------------------------

T_ALL=$(now_ms)
if [ "$RESET" = 1 ]; then "$HB_ROOT/scripts/reset.sh"; fi
for n in "${SCENARIOS[@]}"; do
  ts=$(now_ms)
  "scenario$n"
  log "   scenario $n took $(secs $(( $(now_ms) - ts ))) s"
done

echo
echo "================================ failure test results ================================"
printf '%-2s  %-26s  %-48s  %s\n' "#" "scenario" "fault" "result"
for row in ${RESULTS[@]+"${RESULTS[@]}"}; do
  IFS=$'\t' read -r n name fault numbers verdict <<<"$row"
  printf '%-2s  %-26s  %-48s  %s\n' "$n" "$name" "$fault" "$verdict"
  printf '      %s\n' "$numbers"
done
echo "total time: $(secs $(( $(now_ms) - T_ALL ))) s"
if [ "$FAILED" = 1 ]; then echo "FAILED: at least one scenario found an unexpected gap or failed an assert"; exit 1; fi
echo "ALL PASS"
