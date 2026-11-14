# Herdbook architecture

This file records what is built and why. When a decision is made or changed, update this file in the same change.

The plan doc lives outside the repo; this file carries everything from it that work in the repo needs. If `docs/design.md` disagrees with this file, this file wins. Flag the mismatch.

## What it is

Simulated ROS 2 robots stream telemetry to a cloud backend over MQTT. Faults upload short MCAP clips to object storage. A dashboard shows the fleet live.

It's a portfolio demo: ROS 1 on-vehicle fleet tooling (from Outrider), redesigned from scratch on ROS 2 with a cloud backend.

## Done means

- 4 simulated robots, each with its own edge agent, start with one `docker compose up`.
- The dashboard shows each robot's position, battery and online/degraded/offline state, live.
- A fault produces an MCAP clip in object storage that opens in Foxglove.
- Cutting a robot's network for 60 s loses no data; it backfills on reconnect.
- There's a README with the architecture, trade-offs and a recording.

## Out of scope

Gazebo or Nav2, auth and multi-tenancy, Kubernetes, alerting, a C++ recorder. No features, services or dependencies beyond this file.

## Stack (fixed)

| Layer | Choice |
|---|---|
| ROS | ROS 2 Jazzy, `ros:jazzy` base image |
| Robot nodes | Python, `rclpy` |
| Robot → cloud | MQTT via Mosquitto, QoS 1 |
| Payload | JSON with a per-robot `seq` |
| Offline buffer | SQLite queue on each robot |
| Event clips | `rosbag2_py` writer, MCAP storage |
| Object storage | MinIO, S3 API via boto3 |
| Ingest + API | One FastAPI service: MQTT subscriber, REST, WebSocket |
| Telemetry DB | Postgres + TimescaleDB |
| Dashboard | React + Vite, 2D SVG map, plain WebSocket |
| Packaging | One `infra/docker-compose.yml` |

## Repo layout

```
robot/          one ament_python ROS 2 package: fake_robot, edge_agent, event_recorder + launch file
cloud/ingest/   FastAPI service: MQTT -> DB, REST, WebSocket
dashboard/      React + Vite app
infra/          docker-compose.yml, Mosquitto config, init.sql, .env (gitignored)
scripts/        reset.sh, failure_demo.sh, gap_report.sh, outage_kill_test.sh, recording_cue.sh,
                robot.sh (fault/cut/restore one robot), lib.sh (shared helpers)
Makefile        shortcuts: up, reset, gaps, fault/cut/restore ROBOT=robotN, failure, failure-quick, cue
docs/           design.md, architecture diagram
```

## Data flow

ROS topics never leave a robot. Inside each robot:

- **fake_robot** publishes at 10 Hz: `odom` (nav_msgs/Odometry), `battery` (sensor_msgs/BatteryState) and `diagnostics` (diagnostic_msgs/DiagnosticArray). Events (`event`, a JSON string in std_msgs/String such as `obstacle_stop`) are published by hand (see the decisions log). It also publishes `points` (PointCloud2, 1–2k points at 5 Hz).
- **edge_agent** subscribes to `odom`, `battery` and `diagnostics`, downsamples to 2 Hz and publishes to MQTT. It also forwards each update on the `incident` topic to `fleet/{robot_id}/events`. Every telemetry message and incident update goes into a SQLite outbox (`/data/queue.db`) first; nothing is published directly. A 10 Hz sender tick publishes only while connected, in priority order: every event row, then live telemetry (the last 2 s), then backlog telemetry oldest first at up to 50 msg/s. It deletes a row only after the broker acks it. Status isn't queued: it's published on every (re)connect and on change.
- **event_recorder** subscribes with `raw=True` and keeps 30 s of serialized `points`, `odom`, `diagnostics` and `event` in a ring buffer. On an `event` it publishes a `recording` update on the ROS topic `incident` right away, records 30 s more, writes one MCAP to `/data/clips` and uploads it to MinIO's `incidents` bucket with key `{robot_id}/{event_ts}.mcap` (event_ts in UTC ms, of the clip's first event), retrying with backoff. After the upload it publishes `ready` on `incident` for every event in the clip. edge_agent forwards each `incident` update to `fleet/{robot_id}/events`. Large files never go over MQTT.

In the cloud, ingest (client ID `ingest`, persistent session) subscribes to `fleet/+/telemetry`, `fleet/+/status` and `fleet/+/events` at QoS 1 and writes to TimescaleDB, committing each message before it's acked. Malformed messages are logged and skipped. It serves on 127.0.0.1:8000 (all timestamps as UTC ms):

- `GET /robots`
- `GET /robots/{id}/telemetry?since=` (default: the last 10 minutes)
- `GET /incidents?since=` (default: the last 24 h)
- `GET /incidents/{id}/download` (`{"url": ...}`, a 15-minute presigned MinIO URL signed for `MINIO_PUBLIC_URL`; 404 unless the incident is `ready`)
- a `/ws` WebSocket that pushes `{"type":"telemetry",...}` for telemetry that advanced a robot's state (not backfill), `{"type":"status","robot_id","status"}`, and `{"type":"incident","incident":{...}}` (the incident row, nested because it has its own `type`; pushed on insert and on the change to `ready`). A slow or dead client is dropped without delaying the others

## MQTT contract

| Topic | Payload | QoS, retained |
|---|---|---|
| `fleet/{robot_id}/telemetry` | robot_id, boot_id, seq, ts, x, y, heading, speed, battery, mode | 1, no |
| `fleet/{robot_id}/status` | `online`, `degraded` or `offline` (Last Will is `offline`) | 1, yes |
| `fleet/{robot_id}/events` | robot_id, seq, event_ts, type, status (`recording` or `ready`), mcap_key, size_bytes (both null until `ready`) | 1, no |

- `ts` and `event_ts` are UTC milliseconds. `seq` counts up per robot, with a separate counter per topic.
- The Last Will sets status to `offline` (retained). The robot publishes its current state (`online` or `degraded`, retained) on every (re)connect and whenever it changes.
- Keepalive is 5 s.
- `mcap_key` is the object key inside the `incidents` bucket: `{robot_id}/{event_ts}.mcap`, event_ts in UTC ms. The bucket name isn't part of the key.
- `ts`, `event_ts` and `boot_id` are UTC ms integers. `battery` is a fraction from 0.0 to 1.0 (null if unknown). `mode` is always `driving`.

## Tables

| Table | Columns | Notes |
|---|---|---|
| `telemetry` | robot_id, boot_id, seq, ts, x, y, heading, speed, battery, mode | Hypertable on `ts`; unique on (robot_id, seq, ts); inserts use `ON CONFLICT DO NOTHING` |
| `robots` | robot_id, last_seen, status, last_state | last_seen and last_state (JSON) come from telemetry and only move forward (newer ts wins); `status` comes from the status topic: `online`, `degraded` or `offline` (default `offline`) |
| `incidents` | id, robot_id, event_ts, type, status, mcap_key, size_bytes | One row per event; unique on (robot_id, event_ts). status is `recording` or `ready`; mcap_key (not unique: overlapping events share a clip) and size_bytes are null until `ready`. Upserts move status forward only |

## Decisions log

Each entry has the format: decision — choice. Why.

### Step 0: infra (done)

- **Telemetry unique key** — (robot_id, seq, ts), not (robot_id, seq). TimescaleDB requires the time column in every unique key on a hypertable. A redelivered message carries the same `ts`, so it still dedupes.
- **MinIO image** — `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a community build. MinIO pulled its public images: the Docker Hub repo was deleted, and Quay has required login since Sept 2026.
- **Mosquitto auth** — the password file is built from `infra/.env` at container start. The entrypoint deletes the old file first, because `mosquitto_passwd -c` won't overwrite one and the file is on the data volume, so every restart after the first used to fail. This also picks up `.env` password changes on restart.
- **Port exposure** — every published port binds to 127.0.0.1.
- **Bucket** — a one-shot `minio-init` service creates the `incidents` bucket.

### Step 1: fake fleet (done)

- **Battery** — drains 100%/h from a per-robot start level and resets to 100% at 20%, like a battery swap. Clamping at 0 made every robot show 0% within an hour while still driving.
- **How robots run** — one container per robot: four named compose services, `robot1` to `robot4`, built from a shared `x-robot` YAML template, not `deploy.replicas`. Fixed IDs keep DB rows and retained MQTT status clean. Each robot gets its own named volume (`/data`) for its SQLite outbox and pending clips. The Step 2 and Step 6 checks stop or disconnect one robot's container.
- **ROS graph visibility** — isolated, with `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` in the template. This mimics real fleets: MQTT is the only path off a robot, and a robot can't receive another robot's topics. Nodes still run under the namespace `/<robot_id>` so MCAP clips are self-describing. To inspect a robot, use `docker compose exec robotN ...`.
- **Package** — one `ament_python` package in `robot/`. There are no custom messages; events are JSON in `std_msgs/String`.
- **Code in containers** — `robot/` is bind-mounted read-only, not baked into the image. This gives a fast dev loop: edit, then `docker compose restart robotN`. Restarting one robot runs the new code on that robot only; the others keep the old code until they restart.
- **Build** — each container runs `colcon build --symlink-install` in its own `/ws` at startup, then launches. With no shared build dir there's no 4-way build race and no build output in the repo, and a restart also picks up `setup.py` changes. It costs a few seconds per start.
- **Package name** — `herdbook_robot`, with console_scripts `fake_robot`, `edge_agent`, `event_recorder` and launch file `robot.launch.py` (arg `robot_id`). `robot/` is the package root, mounted at `/ws/src/herdbook_robot`. The nodes are stubs until their behavior is written.
- **Start command** — an inline `bash -c` `command:` in the `x-robot` template that builds, sources `/ws/install/setup.bash`, then `exec ros2 launch ... robot_id:=$ROBOT_ID`. It runs after the `ros:jazzy` entrypoint, which sources `/opt/ros/jazzy`. The Dockerfile is unchanged. All four services share one image tag, `fleet-robot`.
- **Sourcing in exec shells** — after building, the start command appends `source /ws/install/setup.bash` to `/root/.bashrc` once. `docker compose exec` skips the entrypoint, but an interactive bash reads `.bashrc`. This keeps the Dockerfile unchanged, and the line only appears once `/ws/install` exists.
- **Template merging** — YAML `<<` is shallow, and lists don't merge. The template anchors its env map (`*robot-env`) and its source mount (`*robot-src`). Each robot merges `*robot-env` into its own `environment` and lists `*robot-src` next to its own `/data` volume.
- **Robot motion** — position is calculated from time on one fixed loop (an ellipse), with a per-robot phase offset. It's the least code and easy to check on the map. The cost: no real stops, `mode` is always `driving`, and an `obstacle_stop` can't stop a robot.
- **Events** — manual only. From a shell inside the robot: `ros2 topic pub --once /robot1/event std_msgs/msg/String "{data: '{\"type\": \"obstacle_stop\"}'}"`. fake_robot has no event timer. A clip is about 5–10 MB, so automatic events would fill storage fast. Revisit at Step 8 with a slow timer plus a MinIO expiry rule.
- **Point-cloud QoS** — best effort on the publisher and every subscriber (`qos_profile_sensor_data`). A late scan is worthless, so there are no retries, and small gaps in clips are acceptable. A reliable subscriber gets nothing from this topic.

### Step 2: edge agent (done)

- **Threading** — paho runs its network loop in its own thread (`loop_start()`), and ROS runs `rclpy.spin()` on the main thread. paho handles reconnects and backoff, so the 2 Hz timer keeps capturing telemetry during an outage. paho callbacks never touch SQLite. They put events on a `queue.Queue`, and one ROS timer owns the only SQLite connection (built in Step 6).
- **Restarts** — telemetry carries `boot_id`, edge_agent's start time in UTC ms, and `seq` restarts at 0 on each boot. A restart is a significant event: after an `offline`, a new `boot_id` means the robot restarted, and the same `boot_id` means the network dropped. Each MQTT topic has its own `seq` counter, so events never leave holes in telemetry's `seq`. The unique key stays (robot_id, seq, ts), because boots reuse `seq` but never `ts`.
- **Downsampling** — a 2 Hz timer builds each message from the newest odom, battery and diagnostics. Each topic has its own freshness threshold (1 s for all three here; real diagnostics often run at 1 Hz and would need longer). If any topic is stale, the timer skips the send.
- **Degraded status** — `fleet/{robot_id}/status` is `online`, `degraded` or `offline`, retained, QoS 1. edge_agent publishes `degraded` when any topic goes stale and `online` when all are fresh again. It publishes only when the state changes, plus its current state on every (re)connect. The Last Will stays `offline`. This separates "connected but its data is stale" from "gone" without adding nullable telemetry fields. A brief `degraded` at startup, before the first messages arrive, is expected.
- **MQTT settings** — `MQTT_HOST`, `MQTT_PORT`, `MQTT_USER` and `MQTT_PASSWORD` are set once in the `x-robot` env map. The credentials come from `infra/.env`, the same variables mosquitto uses. One source of truth, and nothing secret in the repo.
- **Robot stop signal** — `stop_signal: SIGINT` in the `x-robot` template. `ros2 launch` runs as PID 1 and handles only SIGINT, and Linux drops signals that PID 1 has no handler for. With Docker's default SIGTERM, `docker compose stop` did nothing until Docker SIGKILLed the container (exit 137): no node ran its shutdown, and `offline` came from the Last Will. With SIGINT, launch forwards SIGINT to every node, edge_agent publishes `offline` itself, and the stop takes under 0.5 s.

### Step 3: ingest (done)

- **Ingest MQTT session** — persistent session (clean_session=False, fixed client ID `ingest`), subscribed at QoS 1. The broker queues ingest's messages while it's down (up to max_queued_messages; see the next bullet), so ingest restarts leave no gaps. Ingest doesn't rely on Mosquitto persistence. No check depends on queued messages surviving a broker restart, and persistence only half-covers a restart (a crash loses everything since the last save). It stays on in mosquitto.conf for retained status.
- **Broker queue for ingest** — max_queued_messages 100000 (the default of 1,000 is about 2 min at 8 msg/s). Covers a database outage of about 3.5 h for roughly 25 MB of broker memory; past that the broker drops messages. At scale: a durable log such as Kafka.
- **Ingest MQTT handling** — paho on its own thread; on_message writes to the database and commits before returning. paho acks only after on_message returns, so the ack follows the commit. A crash before the commit means the broker redelivers, and dedupe absorbs any copy. New rows are handed to FastAPI's event loop thread-safely for the WebSocket, without blocking the paho thread. REST endpoints are plain `def` so blocking DB calls run in FastAPI's thread pool. At scale: manual acks, so one commit can ack a batch.
- **Ingest keepalive** — 60 s (paho default), not the robots' 5 s. on_message blocks while it retries a down database, so with 5 s the broker would drop ingest about 7.5 s into an outage. The persistent session would cover it, but it adds churn.
- **Robot state moves forward only** — robots.last_seen and last_state update only when the incoming ts is newer, so a message that arrives after newer data (a late redelivery, or backlog sent after live data) is stored but can't move a robot backwards. The WebSocket pushes only telemetry that advanced a robot's state; backfilled rows go to the database only.
- **Bad message vs database down** — a payload that doesn't parse or validate is logged and skipped (which acks it), so it can't be redelivered forever. A database error is retried with backoff inside on_message (1 s doubling to 10 s), so nothing is acked and the broker holds everything else. on_message catches every exception, because paho 2 stops its network thread when a callback raises.
- **Incident object key** — {robot_id}/{event_ts}.mcap in bucket incidents; the bucket name isn't repeated in the key.
- **Presigned URLs** — signed for MINIO_PUBLIC_URL (http://localhost:9000), because a signature covers the host: a URL signed for minio:9000 doesn't work in a browser and can't be rewritten.

### Step 4: dashboard (done)

- **Dashboard serving** — an nginx container serves the built app and proxies /api and /ws to ingest. That gives one `docker compose up` for the whole demo and one origin (no CORS), and it's the shape Step 8 deploys. Day-to-day UI work can use Vite's dev server with the same proxy paths.
- **Map coordinates** — ROS y points up and SVG y points down, so the map flips y. The floor has fixed bounds of 0–100 × 0–60 m.
- **Robot color comes from status only** — offline is grey and degraded is amber; the dashboard never guesses. A banner shows while the dashboard's own WebSocket is down, because otherwise every robot would freeze while still looking online.
- **WebSocket reconnect** — reconnect with backoff (1 s doubling to 10 s) and reload GET /robots on every (re)connect, because a WebSocket doesn't replay what was missed.
- **Reload everything on reconnect** — after a WebSocket reconnect, the open chart refetches its 10 minutes and the incidents list refetches its 24 h too, not just the robot list.

### Step 5: event clips (done)

- **Incident first, clip later** — every event becomes an incident immediately with status `recording`. When its clip is uploaded, the same incident is updated to `ready` with mcap_key and size_bytes. An incident is identified by (robot_id, event_ts). Each event gets its own incident, even when two share a clip, and an incident stuck at `recording` reveals a lost clip.
- **Incident status moves forward only** — ingest upserts on (robot_id, event_ts) and never moves `ready` back to `recording`, so late or redelivered messages can't undo a finished incident.
- **Clip handoff** — event_recorder publishes incident updates on a ROS topic `incident` (std_msgs/String JSON) with reliable + transient_local QoS, depth 10. If edge_agent restarts, it receives recent updates again, and the forward-only upsert absorbs the repeats. An update is lost only if both nodes restart before the handoff. `ready` is sent only after the upload succeeds.
- **Recorder QoS** — `points` is subscribed best-effort (sensor data QoS), matching its publisher; a reliable subscriber would get nothing.
- **Clip durability** — clips are written to /data/clips and deleted only after a successful upload (retry with backoff, 1 s doubling to 60 s, in a background thread so buffering continues). On startup, leftover clips are uploaded and their `ready` updates published.
- **Overlapping events** — an event during the 30 s after-window doesn't start a new clip. It gets its own incident pointing to the current clip, and the clip includes the `event` topic.
- **Incident window** — GET /incidents takes `since` (UTC ms), defaulting to the last 24 h. The dashboard shows the last 24 h; older incidents stay in the database.
- **Robot storage credentials** — minio-init creates a robot user whose policy allows only PutObject on the incidents bucket. Robots never hold root keys.

### Step 6: store-and-forward (done)

- **Failing test first** — `scripts/outage_kill_test.sh` stops the broker, fires an event on robot4, SIGKILLs robot4 20 s later, then restarts both. On the Step 5 code no incident row appeared and robot4's old boot had 1 row in the outage window (sent 89 ms after the stop); the ~42 samples paho held in memory were lost. On the Step 6 code the incident row appears (`recording`, as the killed recorder's partial clip is lost by design) and the old boot_id has 43 rows up to 88 ms before the kill, with no seq gaps. The script stays for Step 7.
- **Outbox contents** — one SQLite table holds telemetry and incident updates, each with class `event` or `telemetry`. Status is not queued: it's retained current state, so a queued `degraded` from minutes ago replayed after reconnect would be wrong. edge_agent publishes the current status on every (re)connect instead, as before.
- **Payload frozen at enqueue** — the JSON payload, with boot_id, seq and ts, is built once when the sample is taken and sent byte for byte. Rows left over from an earlier boot go out with their original boot_id and seq, so they land in the right place, and seq counters (one per topic) are assigned at enqueue.
- **One SQLite owner** — telemetry and incident callbacks append to an in-memory list on the ROS thread; the 10 Hz sender tick writes it to SQLite. paho callbacks only put `connected`, `disconnected` and `ack` tuples on a `queue.Queue`. The connection keeps `check_same_thread=True`, so a violation fails loudly. Cost: a crash loses at most the last tick (under 100 ms) of samples.
- **Ack path, at-least-once** — each tick drains the callback queue, deletes acked rows, inserts new rows, commits once, then sends. A row is on disk before it's sent and deleted only after its PUBACK, processed in a later tick than the send, so the mid → row id map is always filled first. On disconnect the in-flight map is cleared and unacked rows are sent again; paho also resends its own unacked messages on reconnect. Both cause bounded duplicates, which ingest's `ON CONFLICT DO NOTHING` absorbs (a kill mid-drain re-sent 5 rows; the DB kept one each). Nothing is published while disconnected, so paho's in-memory queue doesn't grow.
- **SQLite settings** — WAL, synchronous=NORMAL. A committed row survives a process crash (the case that matters on a robot); only an OS crash or power loss can lose the last transactions. One commit per tick keeps writes at 10/s.
- **Queue cap and drop policy** — QUEUE_CAP (env, default 100000 rows, about 14 h of telemetry). When full, the oldest telemetry rows are dropped, never events; the running total is logged every 10 s while it grows. The resulting seq gap is the visible signal of data loss. Rows in flight count toward the cap, so a few more rows drop in the first second after a reconnect at the cap.
- **Drain cap** — live plus backlog telemetry share a budget of 50 msg/s (5 per tick), with at most 20 backlog rows in flight; events and live rows are never throttled. Measured: about 48 msg/s per robot. Four robots draining at once stay at about 200 msg/s into one ingest.
- **Drain order** — events first, then live telemetry (enqueued in the last 2 s), then backlog oldest first. Ingest is idempotent and order-independent (dedupe on insert; robot state moves forward only), so out-of-order delivery costs no correctness, and current state matters more than contiguous history: the dashboard is live within one tick of a reconnect (last_seen lag stayed under 0.5 s during a drain). Trade-off: the database has temporary holes until the drain finishes, so gap reports are valid only after every queue has drained.
- **Reconnect backoff** — `reconnect_delay_set(1, 5)`. paho 2.2's default max is 120 s (checked in the image); 5 s gets robots back within a few seconds of the broker (measured: 1.8 s after it reported running).
- **Failure scripts** — `scripts/gap_report.sh [since_ms]` reports per (robot_id, boot_id) row count, min/max seq, seq gaps and ts gaps over 1 s using window functions, plus the rows left in each queue.db. It takes a start time because older test data has real gaps from before Step 6.

### Step 7: failure testing (in progress)

- **Reset script scope** — `scripts/reset.sh` runs `docker compose down -v`, then `up -d --build`, and returns only when minio-init has exited 0, ingest has logged its subscription and all 4 robots are `online` in GET /robots. It wipes every volume (DB, broker, MinIO, each robot's queue.db and clips), so every test run and the recording start from the same state. It never touches `infra/.env`.
- **Failure script scope** — `scripts/failure_demo.sh` runs six scenarios with pass/fail asserts, each proving logged decisions: 1, robot3 cut 60 s (outbox); 2, broker down 30 s (ingest persistent session, retained status); 3, DB down 60 s (ingest DB retry, ack after commit, ingest stays up); 4, robot4 SIGKILLed mid-drain (ack-after-commit and dedupe, with redelivery shown by a temporary mosquitto_sub); 5, MinIO down during a clip upload (clip retry, forward-only incident status, exactly one `ready`); 6, robot1 cut 5 min (outbox and drain order: lag stays live, backlog arrives oldest first at ≤ 50 msg/s). `--quick` runs 1–3, `--scenario N` runs one, `--no-reset` skips the reset. It exits non-zero on any failed assert.
- **Drain before report** — a scenario's gap report runs only after every robot's queue.db is empty (0 rows, or 1 row under 1 s old, which is in flight), and covers only rows since the scenario's start. Live data is sent before backlog, so a report taken mid-drain shows holes that aren't losses. `gap_report.sh --tsv` gives the script the same SQL in machine-readable form.
- **Fault injection method** — one robot is cut with `docker network disconnect` and restored with `docker network connect` using compose's aliases (service name and container name); the robot keeps running, as on a real network drop. Shared services (broker, DB, MinIO) are stopped and started as containers. Events are fired before a cut or on robots that still have a network, with `timeout 5`, because `ros2 topic pub` hangs without one.
- **Expected holes after a kill** — a hole between two boot_ids of the killed robot is labelled `expected: kill->restart hole, N s` and doesn't fail. Nothing ran in that time, so there is nothing to recover. A new boot_id on any other robot fails as an unexpected restart. Seq and ts gaps within one boot_id always fail.

## Planned

- **Reference write-up and failure tests (Step 7)** — the README becomes a write-up of the trade-offs and failure behavior, plus a script anyone can run that cuts a robot's network, restarts the broker, takes the database down, and prints a per-robot gap report.
- **Interactive trigger — deferred.** A button needs a cloud -> edge command channel (new MQTT contract, stale-command handling) and is an abuse surface on a public deploy with no auth. Revisit at Step 8: slow auto-timer vs. button with TTL'd commands, per-robot cooldown and endpoint rate limit.
- **Drop-in kit (possible Step 9)** — a config-driven edge_agent (topics, rates, fields, clip triggers), proven by replaying a public real-robot recording. Build only if founder conversations show demand.

## Known limitations

- **Shared robot upload key** — robots share one put-only MinIO key on the whole incidents bucket, so a compromised robot can overwrite another robot's clip. Fix: per-robot users with a prefix-scoped policy (out of scope).
- **Lost clips stay `recording`** — a lost clip (writer failure, or a partial clip deleted on restart) leaves its incident at `recording` permanently. There's no `failed` status, because upload retries are unbounded, so lost and slow look the same.
- **Offline buffer is bounded** — unsent telemetry and incident updates survive an edge_agent crash or container kill (SQLite outbox), except the last tick (under 100 ms) not yet written. The buffer holds at most QUEUE_CAP rows; past that the oldest telemetry is dropped, leaving a seq gap.
- **queue.db and clips share `/data`** — the outbox and the clips waiting for upload sit on the same per-robot volume, with no disk quota between them. A long outage plus many events could fill the disk for both.
- **`ros2 topic pub` hangs without a network** — in a container with no network, `ros2 topic pub` hangs, so failure scripts fire events before a cut or on robots that still have a network, never inside a cut container, and wrap pubs in `timeout 5`.
- **Floor realism skipped** — The map is a fixed ellipse, mode is always driving, no tf, no IMU. Chosen to spend the time on failure testing and a write-up. Widening mode later changes the MQTT contract, the ingest validation and the dashboard.
- **Not tested** — Postgres data loss (a lost or corrupted volume), broker persistence loss, and clock skew between robots and the cloud (ts and boot_id are robot wall-clock times).
- **Fault injection is container-level** — disconnects and stopped containers, not real packet loss, latency, reordering or a flapping link.
- **No migrations** — init.sql runs only on the first DB init. A schema change needs `docker volume rm fleet_pgdata` (and loses the data).

## Conventions

- Robot IDs are `robot1` to `robot4`. Each comes from the `ROBOT_ID` env var, passes to the launch argument `robot_id`, and then to the node parameter `robot_id`.
- Node code uses relative topic names (`odom`, not `/odom`) so the namespace applies.
- Secrets live in `infra/.env` and never go into git.
