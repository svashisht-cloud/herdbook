"""event_recorder: turns an `event` into an incident and a 60 s MCAP clip.

It keeps the last 30 s of serialized points, odom, diagnostics and event in a
ring buffer. On an event it publishes a `recording` incident update right away,
records 30 s more, writes one MCAP to /data/clips, uploads it to MinIO and then
publishes `ready` for every event in the clip (decisions log: Step 5).

Threads: subscriptions and timers run on the ROS thread and own the ring buffer
and the open clip. One worker thread writes and uploads clips; it never touches
rclpy. Jobs go to it on `self.jobs`, and finished uploads come back on
`self.done`, which a ROS timer drains to publish `ready` and delete the files.
"""

import collections
import json
import os
import queue
import shutil
import threading
import time

import boto3
import rclpy
import rosbag2_py
from botocore.config import Config
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data
from rclpy.serialization import deserialize_message

from diagnostic_msgs.msg import DiagnosticArray
from nav_msgs.msg import Odometry
from sensor_msgs.msg import PointCloud2
from std_msgs.msg import String

WINDOW_NS = 30 * 10**9           # 30 s before the event, and 30 s after it
CLIPS_DIR = "/data/clips"
BACKOFF_START_S = 1.0
BACKOFF_MAX_S = 60.0

# Recorded topics: relative name -> (message class, ROS type string).
RECORDED = {
    "points": (PointCloud2, "sensor_msgs/msg/PointCloud2"),
    "odom": (Odometry, "nav_msgs/msg/Odometry"),
    "diagnostics": (DiagnosticArray, "diagnostic_msgs/msg/DiagnosticArray"),
    "event": (String, "std_msgs/msg/String"),
}

# Handoff to edge_agent: a restarted edge_agent gets recent updates again (decisions log).
INCIDENT_QOS = QoSProfile(
    depth=10, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL
)


class Clip:
    def __init__(self, event_ts, key, end_ns, messages):
        self.event_ts = event_ts      # first event's ts, UTC ms; names the file and the key
        self.key = key
        self.end_ns = end_ns
        self.messages = messages      # list of (topic, bytes, t_ns)
        self.events = []              # [{"event_ts", "type"}]


class EventRecorder(Node):

    def __init__(self):
        super().__init__("event_recorder")
        self.robot_id = self.declare_parameter("robot_id", "robot0").value
        self.bucket = os.environ["MINIO_BUCKET"]
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["MINIO_ENDPOINT"],
            aws_access_key_id=os.environ["MINIO_ROBOT_USER"],
            aws_secret_access_key=os.environ["MINIO_ROBOT_PASSWORD"],
            region_name="us-east-1",
            # Our own backoff governs retries, so each failure is logged.
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                          retries={"max_attempts": 1}, connect_timeout=5, read_timeout=30),
        )

        # ROS thread only.
        self.ring = {name: collections.deque() for name in RECORDED}
        self.clip = None
        self.full_name = {}   # relative topic -> namespaced name, as stored in the MCAP

        self.incident_pub = self.create_publisher(String, "incident", INCIDENT_QOS)
        for name, (msg_type, _) in RECORDED.items():
            qos = qos_profile_sensor_data if name == "points" else 10
            sub = self.create_subscription(
                msg_type, name, lambda data, n=name: self.on_message(n, data), qos, raw=True
            )
            self.full_name[name] = sub.topic_name

        self.jobs = queue.Queue()
        self.done = queue.Queue()
        os.makedirs(CLIPS_DIR, exist_ok=True)
        self.recover_leftovers()
        self.worker = threading.Thread(target=self.work, daemon=True)
        self.worker.start()

        self.create_timer(0.5, self.on_timer)
        self.get_logger().info(f"event_recorder started for {self.robot_id}")

    # ---------- ROS thread ----------

    def on_message(self, name, data):
        now = time.time_ns()
        ring = self.ring[name]
        ring.append((name, data, now))
        while ring and ring[0][2] < now - WINDOW_NS:
            ring.popleft()
        if self.clip is not None:
            self.clip.messages.append((name, data, now))
        if name == "event":
            self.on_event(data, now)

    def on_event(self, data, now_ns):
        event_ts = now_ns // 10**6
        try:
            event_type = str(json.loads(deserialize_message(data, String).data).get("type", "unknown"))
        except Exception:
            event_type = "unknown"
            self.get_logger().warning("Event is not a JSON object; recording it as 'unknown'")

        self.publish_incident(event_ts, event_type, "recording", None, None)

        if self.clip is None:
            key = f"{self.robot_id}/{event_ts}.mcap"
            # The ring already holds this event, so the snapshot includes it.
            snapshot = sorted((m for ring in self.ring.values() for m in ring), key=lambda m: m[2])
            self.clip = Clip(event_ts, key, now_ns + WINDOW_NS, snapshot)
            self.get_logger().info(f"Event {event_type} at {event_ts}: recording clip {key}")
        else:
            # Overlap: its own incident, pointing to the clip in progress (decisions log).
            self.get_logger().info(f"Event {event_type} at {event_ts}: joins clip {self.clip.key}")
        self.clip.events.append({"event_ts": event_ts, "type": event_type})

    def on_timer(self):
        if self.clip is not None and time.time_ns() >= self.clip.end_ns:
            clip, self.clip = self.clip, None
            clip.messages.sort(key=lambda m: m[2])
            self.jobs.put(("write", clip))

        while True:
            try:
                key, size, events, paths = self.done.get_nowait()
            except queue.Empty:
                break
            for e in events:
                self.publish_incident(e["event_ts"], e["type"], "ready", key, size)
            # Delete only after `ready` is published: a crash before this re-uploads
            # and republishes, and the forward-only upsert absorbs the repeat.
            for p in paths:
                if os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                else:
                    _remove(p)
            self.get_logger().info(f"Clip {key} ready ({size} bytes, {len(events)} event(s))")

    def publish_incident(self, event_ts, event_type, status, key, size):
        update = {"event_ts": event_ts, "type": event_type, "status": status,
                  "mcap_key": key, "size_bytes": size}
        self.incident_pub.publish(String(data=json.dumps(update)))

    def recover_leftovers(self):
        """Finish clips from a previous run: a sidecar marks a completely written clip."""
        sidecars = {f[:-5] for f in os.listdir(CLIPS_DIR) if f.endswith(".json")}
        for entry in sorted(os.listdir(CLIPS_DIR)):
            path = os.path.join(CLIPS_DIR, entry)
            if os.path.isdir(path) and entry not in sidecars:
                self.get_logger().warning(f"Deleting partial clip {path}")
                shutil.rmtree(path, ignore_errors=True)
        for stem in sorted(sidecars):
            sidecar = os.path.join(CLIPS_DIR, stem + ".json")
            mcap = os.path.join(CLIPS_DIR, stem, f"{stem}_0.mcap")
            try:
                with open(sidecar) as f:
                    meta = json.load(f)
            except (OSError, ValueError):
                meta = None
            if meta is None or not os.path.isfile(mcap):
                self.get_logger().warning(f"Deleting unusable leftover clip {stem}")
                _remove(sidecar)
                shutil.rmtree(os.path.join(CLIPS_DIR, stem), ignore_errors=True)
                continue
            self.get_logger().info(f"Uploading leftover clip {meta['mcap_key']}")
            self.jobs.put(("upload", (meta["mcap_key"], meta["events"], mcap,
                                      [os.path.join(CLIPS_DIR, stem), sidecar])))

    # ---------- worker thread ----------

    def work(self):
        while True:
            kind, job = self.jobs.get()
            try:
                if kind == "write":
                    job = self.write_clip(job)
                self.upload(*job)
            except Exception as exc:
                # A clip that can't be written is lost; its incidents stay `recording`.
                self.get_logger().error(f"Clip job failed: {exc}")

    def write_clip(self, clip):
        stem = str(clip.event_ts)
        bag_dir = os.path.join(CLIPS_DIR, stem)
        writer = rosbag2_py.SequentialWriter()
        writer.open(
            rosbag2_py.StorageOptions(uri=bag_dir, storage_id="mcap"),
            rosbag2_py.ConverterOptions(input_serialization_format="cdr",
                                        output_serialization_format="cdr"),
        )
        for topic_id, (name, (_, type_str)) in enumerate(RECORDED.items()):
            writer.create_topic(rosbag2_py.TopicMetadata(
                id=topic_id, name=self.full_name[name], type=type_str, serialization_format="cdr"))
        for name, data, t_ns in clip.messages:
            writer.write(self.full_name[name], data, t_ns)
        del writer   # closes the bag

        # The sidecar is written last (tmp + rename), so it only exists for a complete clip.
        sidecar = os.path.join(CLIPS_DIR, stem + ".json")
        with open(sidecar + ".tmp", "w") as f:
            json.dump({"mcap_key": clip.key, "events": clip.events}, f)
        os.replace(sidecar + ".tmp", sidecar)
        mcap = os.path.join(bag_dir, f"{stem}_0.mcap")
        return clip.key, clip.events, mcap, [bag_dir, sidecar]

    def upload(self, key, events, mcap, paths):
        size = os.path.getsize(mcap)
        backoff = BACKOFF_START_S
        while True:
            try:
                # One PUT, not multipart: the robot policy grants PutObject only.
                with open(mcap, "rb") as f:
                    self.s3.put_object(Bucket=self.bucket, Key=key, Body=f, ContentLength=size)
                break
            except Exception as exc:
                first_line = (str(exc).strip().splitlines() or [type(exc).__name__])[0]
                self.get_logger().warning(
                    f"Upload of {key} failed, retrying in {backoff:.0f} s: {first_line}")
                time.sleep(backoff)
                backoff = min(backoff * 2, BACKOFF_MAX_S)
        self.done.put((key, size, events, paths))


def _remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def main(args=None):
    rclpy.init(args=args)
    node = EventRecorder()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
