# Herdbook architecture

This file records what is built and why. When a decision is made or changed, update this file in the same change.

The plan doc lives outside the repo; this file carries everything from it that work in the repo needs. If `docs/design.md` disagrees with this file, this file wins. Flag the mismatch.

## What it is

Simulated ROS 2 robots stream telemetry to a cloud backend over MQTT. Faults upload short MCAP clips to object storage. A dashboard shows the fleet live.

It's a portfolio demo: ROS 1 on-vehicle fleet tooling (from Outrider), redesigned from scratch on ROS 2 with a cloud backend.

## Done means

- 4 simulated robots, each with its own edge agent, start with one `docker compose up`.
- The dashboard shows each robot's position, battery and online/offline state, live.
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
docs/           design.md, architecture diagram
```

## Data flow

ROS topics never leave a robot. Inside each robot:

- **fake_robot** publishes at 10 Hz: `odom` (nav_msgs/Odometry), `battery` (sensor_msgs/BatteryState) and `diagnostics` (diagnostic_msgs/DiagnosticArray). Events (`event`, a JSON string in std_msgs/String such as `obstacle_stop`) are published by hand (see the decisions log). It also publishes `points` (PointCloud2, 1–2k points at 5 Hz).
- **edge_agent** subscribes to `odom`, `battery` and `diagnostics`, downsamples to 2 Hz and publishes to MQTT. Every outgoing message goes into its SQLite queue first. A sender loop publishes in order and deletes a row only when the broker acks it. On reconnect it drains the backlog at a capped rate.
- **event_recorder** subscribes with `raw=True` and keeps 30 s of serialized `points`, `odom` and `diagnostics` in a ring buffer. On an `event` it records 30 s more, writes one MCAP and uploads it to MinIO at `incidents/{robot_id}/{event_ts}.mcap`, retrying with backoff. It then hands the metadata to edge_agent. Large files never go over MQTT.

In the cloud, ingest subscribes to `fleet/+/telemetry`, `fleet/+/status` and `fleet/+/events` and writes to TimescaleDB. It serves:

- `GET /robots`
- `GET /robots/{id}/telemetry?since=`
- `GET /incidents`
- `GET /incidents/{id}/download` (a presigned MinIO URL)
- a `/ws` WebSocket that pushes new telemetry rows and status changes

## MQTT contract

| Topic | Payload | QoS, retained |
|---|---|---|
| `fleet/{robot_id}/telemetry` | robot_id, seq, ts, x, y, heading, speed, battery, mode | 1, no |
| `fleet/{robot_id}/status` | `online` or `offline` (Last Will) | 1, yes |
| `fleet/{robot_id}/events` | robot_id, seq, ts, type, mcap_key, size_bytes | 1, no |

- `ts` is UTC milliseconds. `seq` counts up per robot.
- The Last Will sets status to `offline` (retained). The robot publishes `online` (retained) on connect.
- Keepalive is 5 s.

## Tables

| Table | Columns | Notes |
|---|---|---|
| `telemetry` | robot_id, seq, ts, x, y, heading, speed, battery, mode | Hypertable on `ts`; unique on (robot_id, seq, ts); inserts use `ON CONFLICT DO NOTHING` |
| `robots` | robot_id, last_seen, online, last_state | Updated on every message |
| `incidents` | id, robot_id, ts, type, mcap_key, size_bytes | One row per clip |

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
- **How robots run** — one container per robot: four named compose services, `robot1` to `robot4`, built from a shared `x-robot` YAML template, not `deploy.replicas`. Fixed IDs keep DB rows and retained MQTT status clean. Each robot gets its own named volume for its SQLite queue (Step 6). The Step 2 and Step 6 checks stop or disconnect one robot's container.
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

## Conventions

- Robot IDs are `robot1` to `robot4`. Each comes from the `ROBOT_ID` env var, passes to the launch argument `robot_id`, and then to the node parameter `robot_id`.
- Node code uses relative topic names (`odom`, not `/odom`) so the namespace applies.
- Secrets live in `infra/.env` and never go into git.
