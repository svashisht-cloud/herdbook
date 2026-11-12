"""edge_agent: turns the robot's ROS topics into MQTT messages for the cloud.

Every 0.5 s it builds one telemetry message from the newest odom, battery and
diagnostics and publishes it to fleet/{robot_id}/telemetry at QoS 1. It keeps
fleet/{robot_id}/status at online, degraded or offline (retained).

Threads: ROS callbacks and the 2 Hz timer run on the ROS thread. paho runs its
network loop, on_connect and on_disconnect on its own thread. Only `state`,
`connected` and `stopping` are shared, so only they sit behind `self.lock`.
"""

import json
import math
import os
import threading
import time

import paho.mqtt.client as mqtt
import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node

from diagnostic_msgs.msg import DiagnosticArray
from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState

TOPICS = ("odom", "battery", "diagnostics")
FRESHNESS_S = 1.0          # a topic older than this counts as stale
TELEMETRY_PERIOD_S = 0.5   # 2 Hz
MODE = "driving"           # always driving: the motion is a fixed loop with no stops (decisions log)


class EdgeAgent(Node):
    def __init__(self):
        super().__init__("edge_agent")

        # 1. Configuration
        self.robot_id = self.declare_parameter("robot_id", "robot0").value
        host = os.environ["MQTT_HOST"]
        port = int(os.getenv("MQTT_PORT", "1883"))
        user = os.environ["MQTT_USER"]
        password = os.environ["MQTT_PASSWORD"]

        self.boot_id = int(time.time() * 1000)   # UTC ms at start: a new value means a restart
        self.seq = 0                              # ROS thread only

        self.status_topic = f"fleet/{self.robot_id}/status"
        self.telemetry_topic = f"fleet/{self.robot_id}/telemetry"

        # Shared between the ROS thread and paho's thread: always use the lock.
        self.lock = threading.Lock()
        self.state = "degraded"    # nothing has arrived yet, so every topic is stale
        self.connected = False
        self.stopping = False

        # ROS thread only: no lock needed.
        self.latest = dict.fromkeys(TOPICS)
        self.arrival_times = dict.fromkeys(TOPICS)

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
        self.mqtt.reconnect_delay_set(min_delay=1, max_delay=30)

        # 3. ROS subscriptions
        self.create_subscription(Odometry, "odom", lambda m: self.update_latest("odom", m), 10)
        self.create_subscription(BatteryState, "battery", lambda m: self.update_latest("battery", m), 10)
        self.create_subscription(
            DiagnosticArray, "diagnostics", lambda m: self.update_latest("diagnostics", m), 10
        )

        # 4. Telemetry at 2 Hz
        self.timer = self.create_timer(TELEMETRY_PERIOD_S, self.publish_telemetry)

        # 5. Connect in the background: the agent starts even if the broker is down.
        self.mqtt.connect_async(host, port, keepalive=5)
        self.mqtt.loop_start()

        self.get_logger().info(f"edge_agent started for {self.robot_id}, boot_id={self.boot_id}")

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
        self.get_logger().info(f"Connected to Mosquitto, state={state}")

    def on_disconnect(self, client, userdata, flags, reason_code, properties):
        with self.lock:
            self.connected = False
        self.get_logger().warning(f"MQTT disconnected: {reason_code}")

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

        # Build and send are separate so Step 6's SQLite queue can sit between them.
        self.send_telemetry(self.build_telemetry())

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

    def send_telemetry(self, message):
        info = self.mqtt.publish(self.telemetry_topic, json.dumps(message), qos=1)
        # NO_CONN is expected while disconnected: paho keeps QoS 1 messages in
        # memory and sends them after it reconnects. Anything else is a real failure.
        if info.rc not in (mqtt.MQTT_ERR_SUCCESS, mqtt.MQTT_ERR_NO_CONN):
            self.get_logger().warning(f"Telemetry publish failed: {mqtt.error_string(info.rc)}")

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