"""MQTT -> TimescaleDB.

paho runs its network loop on its own thread, and on_message runs there. It
writes each message in one transaction and commits before returning. paho sends
the PUBACK only after on_message returns, so the ack follows the commit
(decisions log: Ingest MQTT handling).

This thread owns one dedicated DB connection. New rows are handed to the event
loop with call_soon_threadsafe, so a slow WebSocket never blocks this thread.
"""

import json
import logging
import os
import time

import paho.mqtt.client as mqtt
import psycopg
from psycopg.types.json import Jsonb

log = logging.getLogger("ingest.mqtt")

TOPICS = ("fleet/+/telemetry", "fleet/+/status", "fleet/+/events")
STATUSES = ("online", "degraded", "offline")
KEEPALIVE_S = 60          # not the robots' 5 s: on_message blocks during DB retries (decisions log)
BACKOFF_START_S = 1.0
BACKOFF_MAX_S = 10.0

# Integer ms -> timestamptz, exactly: no float rounding.
TS = "timestamptz 'epoch' + %s * interval '1 millisecond'"

INSERT_TELEMETRY = f"""
INSERT INTO telemetry (robot_id, boot_id, seq, ts, x, y, heading, speed, battery, mode)
VALUES (%s, %s, %s, {TS}, %s, %s, %s, %s, %s, %s)
ON CONFLICT (robot_id, seq, ts) DO NOTHING
"""

# Forward only: a backfilled (older) row never moves a robot backwards.
# RETURNING gives a row only if the state was inserted or advanced.
ADVANCE_ROBOT = f"""
INSERT INTO robots (robot_id, last_seen, last_state)
VALUES (%s, {TS}, %s)
ON CONFLICT (robot_id) DO UPDATE
    SET last_seen = EXCLUDED.last_seen, last_state = EXCLUDED.last_state
    WHERE robots.last_seen IS NULL OR EXCLUDED.last_seen > robots.last_seen
RETURNING 1
"""

UPSERT_STATUS = """
INSERT INTO robots (robot_id, status) VALUES (%s, %s)
ON CONFLICT (robot_id) DO UPDATE SET status = EXCLUDED.status
"""

INSERT_INCIDENT = f"""
INSERT INTO incidents (robot_id, ts, type, mcap_key, size_bytes)
VALUES (%s, {TS}, %s, %s, %s)
ON CONFLICT (mcap_key) DO NOTHING
"""

TELEMETRY_FIELDS = ("robot_id", "boot_id", "seq", "ts", "x", "y", "heading", "speed", "battery", "mode")


class BadMessage(ValueError):
    pass


def _int(d, key):
    v = d.get(key)
    if not isinstance(v, int) or isinstance(v, bool):
        raise BadMessage(f"{key} must be an integer")
    return v


def _num_or_none(d, key):
    v = d.get(key)
    if v is None:
        return None
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        raise BadMessage(f"{key} must be a number or null")
    return float(v)


def _str(d, key, required=True):
    v = d.get(key)
    if v is None and not required:
        return None
    if not isinstance(v, str):
        raise BadMessage(f"{key} must be a string")
    return v


def _json_object(payload, robot_id):
    try:
        d = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BadMessage(f"not JSON: {exc}") from None
    if not isinstance(d, dict):
        raise BadMessage("not a JSON object")
    if d.get("robot_id") != robot_id:
        raise BadMessage("robot_id does not match the topic")
    return d


def parse_telemetry(payload, robot_id):
    d = _json_object(payload, robot_id)
    return {
        "robot_id": robot_id,
        "boot_id": _int(d, "boot_id"),
        "seq": _int(d, "seq"),
        "ts": _int(d, "ts"),
        "x": _num_or_none(d, "x"),
        "y": _num_or_none(d, "y"),
        "heading": _num_or_none(d, "heading"),
        "speed": _num_or_none(d, "speed"),
        "battery": _num_or_none(d, "battery"),
        "mode": _str(d, "mode", required=False),
    }


def parse_event(payload, robot_id):
    d = _json_object(payload, robot_id)
    size = d.get("size_bytes")
    if size is not None and (not isinstance(size, int) or isinstance(size, bool)):
        raise BadMessage("size_bytes must be an integer or null")
    return {
        "robot_id": robot_id,
        "seq": _int(d, "seq"),
        "ts": _int(d, "ts"),
        "type": _str(d, "type"),
        "mcap_key": _str(d, "mcap_key"),
        "size_bytes": size,
    }


def parse_status(payload):
    try:
        status = payload.decode("utf-8")
    except UnicodeDecodeError:
        raise BadMessage("status is not UTF-8") from None
    if status not in STATUSES:
        raise BadMessage(f"unknown status {status[:40]!r}")
    return status


class MqttIngest:
    def __init__(self, dsn, loop, push):
        """push(msg) runs on the event loop; it must not block."""
        self.dsn = dsn
        self.loop = loop
        self.push = push
        self.conn = None   # paho thread only

        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="ingest",
            clean_session=False,
            protocol=mqtt.MQTTv311,
        )
        self.client.username_pw_set(os.environ["MQTT_USER"], os.environ["MQTT_PASSWORD"])
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)

    def start(self):
        host = os.environ["MQTT_HOST"]
        port = int(os.getenv("MQTT_PORT", "1883"))
        self.client.connect_async(host, port, keepalive=KEEPALIVE_S)
        self.client.loop_start()
        log.info("MQTT connecting to %s:%s as client 'ingest'", host, port)

    def stop(self):
        self.client.disconnect()
        self.client.loop_stop()
        if self.conn is not None:
            self.conn.close()

    # ---------- paho thread ----------

    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log.error("MQTT connection failed: %s", reason_code)
            return
        # Subscribe here, so it also happens after every reconnect.
        client.subscribe([(t, 1) for t in TOPICS])
        log.info("MQTT connected (session_present=%s), subscribed to %s at QoS 1",
                 flags.session_present, ", ".join(TOPICS))

    def on_disconnect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log.warning("MQTT disconnected: %s", reason_code)
        else:
            log.info("MQTT disconnected: %s", reason_code)

    def on_message(self, client, userdata, msg):
        # paho 2 stops its network thread if a callback raises: catch everything.
        try:
            self.handle(msg.topic, msg.payload)
        except Exception:
            log.exception("Unexpected error handling %s; message skipped", msg.topic)

    def handle(self, topic, payload):
        parts = topic.split("/")
        if len(parts) != 3 or parts[0] != "fleet" or not parts[1]:
            log.warning("Skipping message on unexpected topic %s", topic)
            return
        robot_id, kind = parts[1], parts[2]
        try:
            if kind == "telemetry":
                row = parse_telemetry(payload, robot_id)
                write = lambda cur: self.write_telemetry(cur, row)
            elif kind == "status":
                status = parse_status(payload)
                write = lambda cur: self.write_status(cur, robot_id, status)
            elif kind == "events":
                event = parse_event(payload, robot_id)
                write = lambda cur: self.write_event(cur, event)
            else:
                raise BadMessage(f"unknown kind {kind!r}")
        except BadMessage as exc:
            # Returning acks it, so a bad message can't be redelivered forever.
            log.warning("Skipping bad message on %s: %s", topic, exc)
            return

        to_push = self.write_with_retry(write)
        if to_push is not None:
            self.loop.call_soon_threadsafe(self.push, to_push)

    def write_with_retry(self, write):
        """Retry DB errors with backoff, never returning (so never acking) until committed."""
        backoff = BACKOFF_START_S
        while True:
            try:
                if self.conn is None or self.conn.closed:
                    self.conn = psycopg.connect(self.dsn, connect_timeout=5)
                    log.info("Database connected")
                with self.conn.transaction():
                    with self.conn.cursor() as cur:
                        return write(cur)
            except psycopg.Error as exc:
                first_line = (str(exc).strip().splitlines() or [type(exc).__name__])[0]
                log.error("Database error, retrying in %.0f s: %s", backoff, first_line)
                if self.conn is not None:
                    try:
                        self.conn.close()
                    except Exception:
                        pass
                    self.conn = None
                time.sleep(backoff)
                backoff = min(backoff * 2, BACKOFF_MAX_S)

    # Each write runs inside one transaction; the return value is what to push.

    def write_telemetry(self, cur, row):
        cur.execute(INSERT_TELEMETRY, [row[f] for f in TELEMETRY_FIELDS])
        cur.execute(ADVANCE_ROBOT, (row["robot_id"], row["ts"], Jsonb(row)))
        advanced = cur.fetchone() is not None
        # Only telemetry that advanced the robot goes live; backfill goes to the DB only.
        return {"type": "telemetry", **row} if advanced else None

    def write_status(self, cur, robot_id, status):
        cur.execute(UPSERT_STATUS, (robot_id, status))
        return {"type": "status", "robot_id": robot_id, "status": status}

    def write_event(self, cur, event):
        cur.execute(INSERT_INCIDENT, (event["robot_id"], event["ts"], event["type"],
                                      event["mcap_key"], event["size_bytes"]))
        return None
