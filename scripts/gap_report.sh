#!/usr/bin/env bash
# Per-robot, per-boot telemetry gap report.
#
# For each (robot_id, boot_id): row count, min/max seq, the number of seq gaps (a step
# of more than 1) and the number of ts gaps over 1 s (normal spacing is 0.5 s). Then the
# number of rows still waiting in each robot's outbox (queue.db).
#
# Only valid after every robot's queue has drained: robots send live telemetry before
# their backlog, so the database has temporary holes until the drain finishes. Check
# that the "rows in queue.db" lines are all 0 before reading the gap columns.
#
# A seq gap within one boot_id means lost data (for example, rows dropped at QUEUE_CAP).
# A hole between two boot_ids is a restart, not a gap.
#
# Usage: scripts/gap_report.sh [--tsv] [since_ms]   (only rows with ts >= since_ms, UTC ms; default: all)
#   --tsv: machine-readable, for failure_demo.sh. One tab-separated line per (robot_id, boot_id):
#          gap robot_id boot_id rows min_seq max_seq seq_gaps ts_gaps_over_1s missing_seq
#              first_gap_from first_gap_to max_dts_ms min_ts_ms max_ts_ms
#          then "queue robotN rows" per robot.
set -euo pipefail
cd "$(dirname "$0")/../infra"

TSV=0
if [ "${1:-}" = --tsv ]; then TSV=1; shift; fi
SINCE_MS=${1:-0}
case "$SINCE_MS" in (*[!0-9]*|'') echo "since_ms must be an integer (UTC ms)" >&2; exit 2;; esac

psql_q() { docker compose exec -T timescaledb sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q "$@"' sh "$@"; }

GAPS="
WITH t AS (
  SELECT robot_id, boot_id, seq, ts,
         seq - lag(seq) OVER w AS dseq,
         extract(epoch FROM ts - lag(ts) OVER w) * 1000 AS dts_ms
  FROM telemetry
  WHERE ts >= to_timestamp($SINCE_MS / 1000.0)
  WINDOW w AS (PARTITION BY robot_id, boot_id ORDER BY seq)
)"

if [ "$TSV" = 1 ]; then
  # Gaps are disjoint and ordered by seq, so the smallest gap start pairs with the smallest gap end.
  psql_q -At -F $'\t' -c "$GAPS
SELECT 'gap', robot_id, boot_id, count(*), min(seq), max(seq),
       count(*) FILTER (WHERE dseq > 1),
       count(*) FILTER (WHERE dts_ms > 1000),
       coalesce(sum(dseq - 1) FILTER (WHERE dseq > 1), 0),
       coalesce(min(seq - dseq) FILTER (WHERE dseq > 1), -1),
       coalesce(min(seq) FILTER (WHERE dseq > 1), -1),
       coalesce(round(max(dts_ms)), 0),
       (extract(epoch FROM min(ts)) * 1000)::bigint,
       (extract(epoch FROM max(ts)) * 1000)::bigint
FROM t GROUP BY robot_id, boot_id ORDER BY robot_id, boot_id;"
else
  psql_q -c "$GAPS
SELECT robot_id, boot_id, count(*) AS rows, min(seq) AS min_seq, max(seq) AS max_seq,
       count(*) FILTER (WHERE dseq > 1) AS seq_gaps,
       count(*) FILTER (WHERE dts_ms > 1000) AS ts_gaps_over_1s
FROM t
GROUP BY robot_id, boot_id
ORDER BY robot_id, boot_id;"
fi

for r in robot1 robot2 robot3 robot4; do
  n=$(docker compose exec -T "$r" python3 -c '
import os, sqlite3
p = "/data/queue.db"
print(sqlite3.connect(f"file:{p}?mode=ro", uri=True).execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
      if os.path.exists(p) else "no queue.db")
' 2>/dev/null || echo "unreachable")
  if [ "$TSV" = 1 ]; then printf 'queue\t%s\t%s\n' "$r" "$n"; else echo "rows in queue.db, $r: $n"; fi
done
