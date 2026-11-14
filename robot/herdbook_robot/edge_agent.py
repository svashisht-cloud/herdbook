"""edge_agent: turns the robot's ROS topics into MQTT messages for the cloud.

Every 0.5 s it builds one telemetry message from the newest odom, battery and
diagnostics for fleet/{robot_id}/telemetry. Each incident update from
event_recorder (ROS topic `incident`) becomes a message for fleet/{robot_id}/events.
Both go through a SQLite outbox (/data/queue.db) first; nothing is published
directly. fleet/{robot_id}/status (online, degraded or offline, retained) is not
queued: it's current state, published on every (re)connect and on change.

Store-and-forward: a 10 Hz sender tick writes new messages to the outbox,
commits, and then, only while connected, publishes at QoS 1 in priority order:
every event row, then live telemetry (last 2 s), then backlog telemetry oldest
first, capped at 50 msg/s and 20 in flight. A row is deleted only after the
broker's PUBACK. On disconnect the in-flight map is cleared and unacked rows are
sent again (at-least-once; ingest dedupes).

Threads: ROS callbacks and both timers run on the ROS thread. paho runs its
network loop and on_connect, on_disconnect and on_publish on its own thread.
paho callbacks never touch SQLite: they put small tuples on `self.link_events`,
which the sender tick drains. The sender tick owns the only SQLite connection
(check_same_thread=True, so a violation fails loudly). `state`, `connected` and
`stopping` are shared for status publishing, so they sit behind `self.lock`.
"""

import json
import math
import os
import queue
import sqlite3
import threading
import time

import paho.mqtt.client as mqtt
import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from diagnostic_msgs.msg import DiagnosticArray
from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState
from std_msgs.msg import String

TOPICS = ("odom", "battery", "diagnostics")
FRESHNESS_S = 1.0          # a topic older than this counts as stale
TELEMETRY_PERIOD_S = 0.5   # 2 Hz
# Matches event_recorder's publisher: a restarted edge_agent gets recent updates again.
INCIDENT_QOS = QoSProfile(
    depth=10, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL
)
MODE = "driving"           # always driving: the motion is a fixed loop with no stops (decisions log)

QUEUE_PATH = "/data/queue.db"   # the robot's named volume: survives restarts and crashes
SENDER_PERIOD_S = 0.1           # 10 Hz sender tick
LIVE_WINDOW_MS = 2000           # telemetry enqueued within this window counts as live
BACKLOG_PER_TICK = 5            # 50 msg/s budget for live + backlog telemetry
BACKLOG_MAX_IN_FLIGHT = 20
DROP_LOG_PERIOD_S = 10.0


class EdgeAgent(Node):
    def __init__(self):
        super().__init__("edge_agent")

        # 1. Configuration
        self.robot_id = self.declare_parameter("robot_id", "robot0").value
        host = os.environ["MQTT_HOST"]
        port = int(os.getenv("MQTT_PORT", "1883"))
        user = os.environ["MQTT_USER"]
        password = os.environ["MQTT_PASSWORD"]

        self.queue_cap = int(os.getenv("QUEUE_CAP", "100000"))
        self.boot_id = int(time.time() * 1000)   # UTC ms at start: a new value means a restart
        self.seq = 0                              # ROS thread only
        self.event_seq = 0                        # own counter: events never leave holes in telemetry's seq

        self.status_topic = f"fleet/{self.robot_id}/status"
        self.telemetry_topic = f"fleet/{self.robot_id}/telemetry"
        self.events_topic = f"fleet/{self.robot_id}/events"

        # Shared between the ROS thread and paho's thread: always use the lock.
        self.lock = threading.Lock()
        self.state = "degraded"    # nothing has arrived yet, so every topic is stale
        self.connected = False
        self.stopping = False

        # ROS thread only: no lock needed.
        self.latest = dict.fromkeys(TOPICS)
        self.arrival_times = dict.fromkeys(TOPICS)

        # Outbox, ROS thread only. Messages wait in `pending` until the next sender
        # tick writes them to SQLite: only the tick uses the connection.
        self.pending = []                 # (topic, payload, enqueued_at, class)
        self.link_events = queue.Queue()  # from paho callbacks: ("connected",), ("disconnected",), ("ack", mid)
        self.link_up = False              # the sender's view of the connection, from link_events
        self.inflight = {}                # mid -> outbox row id
        self.inflight_backlog = set()     # row ids of backlog rows in flight
        self.dropped = 0                  # telemetry rows dropped at the cap, this boot
        self.dropped_logged = 0
        self.last_drop_log = time.monotonic()
        self.db = self.open_outbox()
        self.queued = self.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]

        # 2. MQTT
        self.mqtt = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.robot_id,
            protocol=mqtt.MQTTv311,
        )
        self.mqtt.username_pw_set(user, password)
        self.mqtt.will_set(self.status_topic, payload="offline", qos=1, retain=True)
        self.mqtt.on_connect = self.on_connect
        self.mqtt.on_disconnect = self.on_disconnect
        self.mqtt.on_publish = self.on_publish
        # paho's default max backoff is 120 s; 5 s gets a robot back soon after the broker.
        self.mqtt.reconnect_delay_set(min_delay=1, max_delay=5)

        # 3. ROS subscriptions
        self.create_subscription(Odometry, "odom", lambda m: self.update_latest("odom", m), 10)
        self.create_subscription(BatteryState, "battery", lambda m: self.update_latest("battery", m), 10)
        self.create_subscription(
            DiagnosticArray, "diagnostics", lambda m: self.update_latest("diagnostics", m), 10
        )

        self.create_subscription(String, "incident", self.forward_incident, INCIDENT_QOS)

        # 4. Telemetry at 2 Hz, and the sender that drains the outbox at 10 Hz
        self.timer = self.create_timer(TELEMETRY_PERIOD_S, self.publish_telemetry)
        self.sender = self.create_timer(SENDER_PERIOD_S, self.sender_tick)

        # 5. Connect in the background: the agent starts even if the broker is down.
        self.mqtt.connect_async(host, port, keepalive=5)
        self.mqtt.loop_start()

        self.get_logger().info(
            f"edge_agent started for {self.robot_id}, boot_id={self.boot_id}, "
            f"{self.queued} rows queued from earlier boots, cap={self.queue_cap}"
        )

    def open_outbox(self):
        db = sqlite3.connect(QUEUE_PATH)   # check_same_thread=True (the default): ROS thread only
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        db.execute(
            """CREATE TABLE IF NOT EXISTS outbox (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   topic TEXT NOT NULL,
                   payload TEXT NOT NULL,
                   enqueued_at INTEGER NOT NULL,
                   class TEXT NOT NULL CHECK (class IN ('event', 'telemetry'))
               )"""
        )
        db.execute("CREATE INDEX IF NOT EXISTS outbox_class_id ON outbox (class, id)")
        db.execute("CREATE INDEX IF NOT EXISTS outbox_class_enqueued ON outbox (class, enqueued_at)")
        db.commit()
        return db

    # ---------- paho thread ----------

    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.get_logger().error(f"MQTT connection failed: {reason_code}")
            return
        with self.lock:
            if self.stopping:
                return
            self.connected = True
            state = self.state
            # Read and publish under one lock, so a timer tick can't publish a
            # newer state in between and then be overwritten by this older one.
            self.publish_status(state)
        self.link_events.put(("connected",))
        self.get_logger().info(f"Connected to Mosquitto, state={state}")

    def on_disconnect(self, client, userdata, flags, reason_code, properties):
        with self.lock:
            self.connected = False
        self.link_events.put(("disconnected",))
        if reason_code.is_failure:
            self.get_logger().warning(f"MQTT disconnected: {reason_code}")
        else:
            self.get_logger().info(f"MQTT disconnected: {reason_code}")

    def on_publish(self, client, userdata, mid, reason_code, properties):
        # QoS 1: called when the broker's PUBACK arrives. The sender tick deletes the row.
        self.link_events.put(("ack", mid))

    # ---------- ROS thread ----------

    def update_latest(self, topic, msg):
        self.latest[topic] = msg
        self.arrival_times[topic] = time.monotonic()

    def publish_status(self, state):
        return self.mqtt.publish(self.status_topic, payload=state, qos=1, retain=True)

    def publish_telemetry(self):
        now = time.monotonic()
        fresh = all(
            self.arrival_times[name] is not None and now - self.arrival_times[name] <= FRESHNESS_S
            for name in TOPICS
        )
        new_state = "online" if fresh else "degraded"

        with self.lock:
            if self.stopping:
                return
            state_changed = new_state != self.state
            self.state = new_state
            # Only while connected: on_connect republishes the current state after
            # every reconnect, and a status queued while offline could arrive after it.
            if state_changed and self.connected:
                self.publish_status(new_state)

        if state_changed:
            self.get_logger().info(f"Robot state changed: {new_state}")

        if not fresh:
            return   # skip telemetry while any topic is stale

        self.enqueue(self.telemetry_topic, self.build_telemetry(), "telemetry")

    def build_telemetry(self):
        """One message from the newest samples. Diagnostics only counts toward freshness."""
        odom = self.latest["odom"]
        pct = self.latest["battery"].percentage   # 0.0-1.0, as in ROS
        position = odom.pose.pose.position
        q = odom.pose.pose.orientation
        velocity = odom.twist.twist.linear

        message = {
            "robot_id": self.robot_id,
            "boot_id": self.boot_id,
            "seq": self.seq,
            "ts": int(time.time() * 1000),   # UTC ms
            "x": position.x,
            "y": position.y,
            "heading": math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y ** 2 + q.z ** 2)),
            "speed": math.hypot(velocity.x, velocity.y),
            "battery": pct if math.isfinite(pct) else None,
            "mode": MODE,
        }
        # seq numbers the sample, not the send attempt: it goes up once per message
        # built, whatever happens to the send.
        self.seq += 1
        return message

    def forward_incident(self, msg):
        """Incident updates go out whatever the robot's state: degraded doesn't block them."""
        try:
            update = json.loads(msg.data)
            message = {
                "robot_id": self.robot_id,
                "seq": self.event_seq,
                "event_ts": int(update["event_ts"]),
                "type": update["type"],
                "status": update["status"],
                "mcap_key": update.get("mcap_key"),
                "size_bytes": update.get("size_bytes"),
            }
        except (ValueError, KeyError, TypeError) as exc:
            self.get_logger().warning(f"Skipping bad incident update: {exc}")
            return
        self.event_seq += 1
        self.enqueue(self.events_topic, message, "event")

    def enqueue(self, topic, message, cls):
        """Freeze the payload now (boot_id and seq included); the next sender tick stores it."""
        self.pending.append((topic, json.dumps(message), int(time.time() * 1000), cls))

    # ---------- sender tick: the only code that uses self.db ----------

    def sender_tick(self):
        if self.stopping:
            return
        # 1. Connection changes and acks from paho. An ack is always processed in a
        #    later tick than its send, so its mid is already in self.inflight.
        acked = []
        while True:
            try:
                item = self.link_events.get_nowait()
            except queue.Empty:
                break
            if item[0] == "connected":
                self.link_up = True
                self.get_logger().info(f"Sender: connected, {self.queued + len(self.pending)} rows queued")
            elif item[0] == "disconnected":
                # Unacked rows stay in SQLite and are sent again after the reconnect.
                self.link_up = False
                self.inflight.clear()
                self.inflight_backlog.clear()
            else:
                row_id = self.inflight.pop(item[1], None)
                if row_id is not None:
                    self.inflight_backlog.discard(row_id)
                    acked.append((row_id,))
        if acked:
            cur = self.db.executemany("DELETE FROM outbox WHERE id = ?", acked)
            self.queued -= cur.rowcount

        # 2. New messages, then the cap: drop the oldest telemetry, never events.
        if self.pending:
            self.db.executemany(
                "INSERT INTO outbox (topic, payload, enqueued_at, class) VALUES (?, ?, ?, ?)", self.pending
            )
            self.queued += len(self.pending)
            self.pending.clear()
        if self.queued > self.queue_cap:
            cur = self.db.execute(
                "DELETE FROM outbox WHERE id IN "
                "(SELECT id FROM outbox WHERE class = 'telemetry' ORDER BY id LIMIT ?)",
                (self.queued - self.queue_cap,),
            )
            self.queued -= cur.rowcount
            self.dropped += cur.rowcount

        # 3. One commit per tick. Every row is on disk before it's sent.
        self.db.commit()

        now = time.monotonic()
        if self.dropped != self.dropped_logged and now - self.last_drop_log >= DROP_LOG_PERIOD_S:
            self.get_logger().warning(
                f"Outbox full (cap {self.queue_cap}): {self.dropped} oldest telemetry rows dropped this boot"
            )
            self.dropped_logged = self.dropped
            self.last_drop_log = now

        # 4. Send only while connected, so paho's in-memory queue never grows.
        if not self.link_up:
            return
        in_flight = set(self.inflight.values())

        # a. every unsent event row, never throttled
        for row in self.db.execute("SELECT id, topic, payload FROM outbox WHERE class = 'event' ORDER BY id"):
            if row[0] not in in_flight:
                self.publish_row(row)

        # b. live telemetry, never throttled
        live_since = int(time.time() * 1000) - LIVE_WINDOW_MS
        live_sent = 0
        for row in self.db.execute(
            "SELECT id, topic, payload FROM outbox WHERE class = 'telemetry' AND enqueued_at >= ? ORDER BY id",
            (live_since,),
        ):
            if row[0] not in in_flight:
                self.publish_row(row)
                live_sent += 1

        # c. backlog, oldest first, within what's left of the budget
        budget = min(BACKLOG_PER_TICK - live_sent, BACKLOG_MAX_IN_FLIGHT - len(self.inflight_backlog))
        if budget <= 0:
            return
        rows = self.db.execute(
            "SELECT id, topic, payload FROM outbox WHERE class = 'telemetry' AND enqueued_at < ? "
            "ORDER BY id LIMIT ?",
            (live_since, budget + len(self.inflight_backlog)),
        ).fetchall()
        for row in rows:
            if budget <= 0:
                break
            if row[0] not in in_flight and self.publish_row(row):
                self.inflight_backlog.add(row[0])
                budget -= 1

    def publish_row(self, row):
        row_id, topic, payload = row
        info = self.mqtt.publish(topic, payload, qos=1)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            # Most likely the connection just dropped; the row stays queued.
            self.get_logger().warning(f"Publish to {topic} failed: {mqtt.error_string(info.rc)}")
            return False
        self.inflight[info.mid] = row_id
        return True

    def close_outbox(self):
        """Store anything still pending, then close. Same thread as the sender tick."""
        if self.pending:
            self.db.executemany(
                "INSERT INTO outbox (topic, payload, enqueued_at, class) VALUES (?, ?, ?, ?)", self.pending
            )
            self.pending.clear()
        self.db.commit()
        self.db.close()

    # ---------- shutdown (after spin has stopped) ----------

    def shutdown(self):
        """Publish offline explicitly: a clean disconnect does not trigger the Last Will."""
        with self.lock:
            if self.stopping:
                return
            self.stopping = True
            info = self.publish_status("offline") if self.connected else None

        # Wait outside the lock: paho's thread may need it (on_disconnect) before it
        # can process the broker's ack.
        if info is not None and info.rc == mqtt.MQTT_ERR_SUCCESS:
            try:
                info.wait_for_publish(timeout=3.0)
            except (ValueError, RuntimeError) as exc:
                self.get_logger().warning(f"Offline publish failed: {exc}")
            if not info.is_published():
                self.get_logger().warning("Offline status was not acknowledged")

        self.mqtt.disconnect()
        self.mqtt.loop_stop()
        self.close_outbox()
        self.get_logger().info("edge_agent stopped")


def main(args=None):
    rclpy.init(args=args)
    node = EdgeAgent()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()