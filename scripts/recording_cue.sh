#!/usr/bin/env bash
# Prints the 60-90 s recording order with the exact commands. Doesn't run anything.
cat <<'CUE'
Recording cue (60-90 s). Start from a clean fleet: make reset

Keep visible: the dashboard tab, http://localhost:8080 (map, robot list and incidents panel),
next to one terminal at the repo root. Click robot3 on the map so its chart is open.

  0 s   Dashboard live: 4 green robots moving on the floor map.
  5 s   make cut ROBOT=robot3
        robot3 freezes on the map (its data stops). It can't publish `degraded` with no network,
        so it stays green until the broker's Last Will lands: grey/offline in about 8 s.
 15 s   make fault ROBOT=robot2
        A new incident for robot2 appears as `recording`; ~30 s later it flips to `ready`
        (the after-window plus the upload). Keep the incidents panel in shot.
 50 s   make restore ROBOT=robot3        (cut was ~45 s; run it when robot2's incident is ready)
        robot3 turns green and jumps to its live position within a second or two; the
        backlog drains behind it in a few seconds (live data first, then oldest first).
 60 s   make gaps
        Every (robot, boot) row: seq_gaps 0, ts_gaps_over_1s 0; every queue.db at 0.
        (Run it after the drain: a gap report taken mid-drain shows temporary holes.)
CUE
