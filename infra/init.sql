-- Runs once, on an empty data volume. The TimescaleDB image already creates the
-- extension in POSTGRES_DB, so IF NOT EXISTS keeps this file safe to re-run.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Telemetry: one row per message, deduped so QoS 1 redeliveries are harmless.
-- TimescaleDB requires every unique key on a hypertable to include the time
-- column, so the dedupe key is (robot_id, seq, ts), not (robot_id, seq).
-- That still dedupes correctly: a redelivered message carries the same ts.
CREATE TABLE IF NOT EXISTS telemetry (
    robot_id  TEXT             NOT NULL,
    boot_id   BIGINT           NOT NULL,
    seq       BIGINT           NOT NULL,
    ts        TIMESTAMPTZ      NOT NULL,
    x         DOUBLE PRECISION,
    y         DOUBLE PRECISION,
    heading   DOUBLE PRECISION,
    speed     DOUBLE PRECISION,
    battery   DOUBLE PRECISION,
    mode      TEXT,
    CONSTRAINT telemetry_dedupe UNIQUE (robot_id, seq, ts)
);
SELECT create_hypertable('telemetry', by_range('ts'), if_not_exists => TRUE);

-- Serves GET /robots/{id}/telemetry?since=
CREATE INDEX IF NOT EXISTS telemetry_robot_ts ON telemetry (robot_id, ts DESC);

-- Latest state per robot, upserted on every message.
CREATE TABLE IF NOT EXISTS robots (
    robot_id   TEXT PRIMARY KEY,
    last_seen  TIMESTAMPTZ,
    status     TEXT    NOT NULL DEFAULT 'offline',  -- online | degraded | offline
    last_state JSONB
);

-- One row per MCAP clip. mcap_key is unique per clip, so it is the dedupe key
-- for redelivered event messages.
CREATE TABLE IF NOT EXISTS incidents (
    id         BIGSERIAL PRIMARY KEY,
    robot_id   TEXT        NOT NULL,
    ts         TIMESTAMPTZ NOT NULL,
    type       TEXT        NOT NULL,
    mcap_key   TEXT        NOT NULL UNIQUE,
    size_bytes BIGINT
);
CREATE INDEX IF NOT EXISTS incidents_ts ON incidents (ts DESC);
