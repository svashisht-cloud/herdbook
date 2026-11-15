"""fake_robot node: a warehouse robot driving a timed route through the floor in floor.json.

Publishes odom, battery, diagnostics (with the current mode) and tf at 10 Hz, and a
simulated lidar scan of the floor's walls and racks on points at 5 Hz.
"""

import json
import math
import os

import numpy as np
import rclpy
from ament_index_python.packages import get_package_share_directory
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data

from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from geometry_msgs.msg import Quaternion, TransformStamped
from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState, PointCloud2
from sensor_msgs_py import point_cloud2
from std_msgs.msg import Header
from tf2_msgs.msg import TFMessage

from herdbook_robot.route import plan_routes

DRAIN_PER_SECOND = 1.0 / 3600.0   # 100% of battery per hour

# Simulated lidar.
NUM_RAYS = 360
POINTS_PER_HIT = 4   # stacked vertically up the obstacle's height
MAX_RANGE = 25.0     # m
RANGE_NOISE = 0.02   # m


def yaw_to_quaternion(yaw):
    """A robot that only turns flat rotates around z, so x and y stay 0."""
    return Quaternion(x=0.0, y=0.0, z=math.sin(yaw / 2.0), w=math.cos(yaw / 2.0))


def load_floor():
    path = os.path.join(get_package_share_directory('herdbook_robot'), 'config', 'floor.json')
    with open(path) as f:
        return json.load(f)


class FakeRobot(Node):

    def __init__(self):
        super().__init__('fake_robot')
        self.robot_id = self.declare_parameter('robot_id', 'robot0').value

        floor = load_floor()
        routes, offsets, self.spacing = plan_routes(floor['route'])

        # robotN takes assignment N-1: its own station and aisles, and a start offset that
        # keeps it clear of the others. Charge levels differ per robot.
        digits = ''.join(c for c in self.robot_id if c.isdigit())
        index = (max(int(digits) - 1, 0) if digits else 0) % len(routes)
        self.route, self.offset = routes[index], offsets[index]
        self.start_battery = 1.0 - 0.1 * index

        # Lidar targets: every wall and rack as an axis-aligned box with a height.
        boxes = [(r, floor['wall_height']) for r in floor['walls']]
        boxes += [(r, floor['rack_height']) for r in floor['racks']]
        self.boxes = np.array([b for b, _ in boxes], dtype=np.float64)    # (B, 4): x0 y0 x1 y1
        self.box_heights = np.array([h for _, h in boxes], dtype=np.float64)
        self.ray_angles = np.linspace(0.0, 2.0 * math.pi, NUM_RAYS, endpoint=False)
        self.rng = np.random.default_rng()

        self.odom_pub = self.create_publisher(Odometry, 'odom', 10)
        self.battery_pub = self.create_publisher(BatteryState, 'battery', 10)
        self.diag_pub = self.create_publisher(DiagnosticArray, 'diagnostics', 10)
        self.tf_pub = self.create_publisher(TFMessage, 'tf', 10)
        self.points_pub = self.create_publisher(PointCloud2, 'points', qos_profile_sensor_data)

        self.t0 = self.get_clock().now()
        self.tick_timer = self.create_timer(0.1, self.on_tick)      # 10 Hz
        self.points_timer = self.create_timer(0.2, self.on_points)  # 5 Hz

        self.get_logger().info(
            f'fake_robot started for {self.robot_id}: route cycle {self.route.cycle:.0f} s, '
            f'offset {self.offset:.1f} s, closest approach between robots {self.spacing:.1f} m'
        )

    def state(self, now):
        """Seconds since start (for the battery) and the pose. The route runs on wall-clock
        time, shared by every robot, so the spacing holds when one robot restarts."""
        t = (now - self.t0).nanoseconds / 1e9
        return t, self.route.state(now.nanoseconds / 1e9 + self.offset)

    def on_tick(self):
        now = self.get_clock().now()
        stamp = now.to_msg()
        t, (x, y, heading, speed, yaw_rate, mode) = self.state(now)
        orientation = yaw_to_quaternion(heading)

        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        odom.pose.pose.position.x = x
        odom.pose.pose.position.y = y
        odom.pose.pose.orientation = orientation
        odom.twist.twist.linear.x = speed       # twist is in the robot's frame: forward speed
        odom.twist.twist.angular.z = yaw_rate
        self.odom_pub.publish(odom)

        # Same pose as odom, so Foxglove can place base_link (and the lidar) in the odom frame.
        tf = TransformStamped()
        tf.header.stamp = stamp
        tf.header.frame_id = 'odom'
        tf.child_frame_id = 'base_link'
        tf.transform.translation.x = x
        tf.transform.translation.y = y
        tf.transform.rotation = orientation
        self.tf_pub.publish(TFMessage(transforms=[tf]))

        used = (1.0 - self.start_battery) + DRAIN_PER_SECOND * t
        pct = 1.0 - (used % 0.8)

        battery = BatteryState()
        battery.header.stamp = stamp
        battery.percentage = pct                # 0.0 to 1.0, not 0 to 100
        battery.voltage = 44.0 + 6.0 * pct      # pretend 48 V pack
        battery.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        battery.present = True
        self.battery_pub.publish(battery)

        status = DiagnosticStatus()
        status.level = DiagnosticStatus.OK      # a bytes constant, not an int
        status.name = 'drive'
        status.message = 'OK'
        status.hardware_id = self.robot_id
        status.values = [
            KeyValue(key='speed', value=f'{speed:.2f}'),
            KeyValue(key='battery', value=f'{pct:.3f}'),
            KeyValue(key='mode', value=mode),   # edge_agent reads telemetry's mode from here
        ]
        diag = DiagnosticArray()
        diag.header.stamp = stamp
        diag.status = [status]
        self.diag_pub.publish(diag)

    def on_points(self):
        now = self.get_clock().now()
        _, (x, y, heading, _, _, _) = self.state(now)
        header = Header()
        header.stamp = now.to_msg()
        header.frame_id = 'base_link'
        self.points_pub.publish(point_cloud2.create_cloud_xyz32(header, self.scan(x, y, heading)))

    def scan(self, x, y, heading):
        """Cast rays from the robot against every box (slab test); stack points on each hit."""
        world = heading + self.ray_angles
        dx, dy = np.cos(world), np.sin(world)
        dx = np.where(np.abs(dx) < 1e-9, 1e-9, dx)[:, None]
        dy = np.where(np.abs(dy) < 1e-9, 1e-9, dy)[:, None]
        bx0, by0, bx1, by1 = (self.boxes[:, k][None, :] for k in range(4))
        tx1, tx2 = (bx0 - x) / dx, (bx1 - x) / dx
        ty1, ty2 = (by0 - y) / dy, (by1 - y) / dy
        t_near = np.maximum(np.minimum(tx1, tx2), np.minimum(ty1, ty2))
        t_far = np.minimum(np.maximum(tx1, tx2), np.maximum(ty1, ty2))
        t = np.where((t_near <= t_far) & (t_near > 0.0), t_near, np.inf)   # (rays, boxes)

        nearest = np.argmin(t, axis=1)
        dist = t[np.arange(NUM_RAYS), nearest]
        hit = dist < MAX_RANGE
        angles = np.repeat(self.ray_angles[hit], POINTS_PER_HIT)
        dist = np.repeat(dist[hit], POINTS_PER_HIT)
        dist = dist + self.rng.normal(0.0, RANGE_NOISE, dist.shape)
        z = self.rng.uniform(0.0, 1.0, dist.shape) * np.repeat(self.box_heights[nearest[hit]], POINTS_PER_HIT)
        # Ray angles are relative to the robot, so this is already base_link.
        return np.column_stack((dist * np.cos(angles), dist * np.sin(angles), z)).astype(np.float32)


def main(args=None):
    rclpy.init(args=args)
    node = FakeRobot()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
