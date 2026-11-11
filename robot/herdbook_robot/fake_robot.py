"""fake_robot node. Stub: declares robot_id, logs once, spins."""

import math
import random

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data

from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from geometry_msgs.msg import Quaternion
from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState, PointCloud2
from sensor_msgs_py import point_cloud2
from std_msgs.msg import Header

# The yard loop is an ellipse, in metres.
CENTER_X, CENTER_Y = 50.0, 30.0
RADIUS_X, RADIUS_Y = 40.0, 20.0
LAP_SECONDS = 120.0               # one full lap; speed ends up between ~1 and ~2 m/s
DRAIN_PER_SECOND = 1.0 / 3600.0   # 100% of battery per hour
NUM_POINTS = 1500

def yaw_to_quaternion(yaw):
    """A robot that only turns flat rotates around z, so x and y stay 0."""
    return Quaternion(x=0.0, y=0.0, z=math.sin(yaw / 2.0), w=math.cos(yaw / 2.0))

class FakeRobot(Node):

    def __init__(self):
        super().__init__('fake_robot')
        self.robot_id = self.declare_parameter('robot_id', 'robot0').value
        
        # robot1..robot4 start a quarter lap apart and at different charge levels.
        digits = ''.join(c for c in self.robot_id if c.isdigit())
        index = max(int(digits) - 1, 0) if digits else 0
        self.phase = index * math.pi / 2.0
        self.start_battery = 1.0 - 0.1 * index
        
        self.odom_pub = self.create_publisher(Odometry, 'odom', 10)
        self.battery_pub = self.create_publisher(BatteryState, 'battery', 10)
        self.diag_pub = self.create_publisher(DiagnosticArray, 'diagnostics', 10)
        self.points_pub = self.create_publisher(PointCloud2, 'points', qos_profile_sensor_data)
        
        self.t0 = self.get_clock().now()
        self.tick_timer = self.create_timer(0.1, self.on_tick)      # 10 Hz
        self.points_timer = self.create_timer(0.2, self.on_points)  # 5 Hz

        
        self.get_logger().info(f'fake_robot started for {self.robot_id}')

    def state(self, t):
        """Where the robot is t seconds after start, from the ellipse formula."""
        w = 2.0 * math.pi / LAP_SECONDS
        a = w * t + self.phase
        x = CENTER_X + RADIUS_X * math.cos(a)
        y = CENTER_Y + RADIUS_Y * math.sin(a)
        # Velocity is the derivative of position.
        vx = -RADIUS_X * w * math.sin(a)
        vy = RADIUS_Y * w * math.cos(a)
        speed = math.hypot(vx, vy)
        heading = math.atan2(vy, vx)
        # How fast the heading turns. For an ellipse this simplifies to rx*ry*w^3 / speed^2.
        yaw_rate = RADIUS_X * RADIUS_Y * w ** 3 / speed ** 2
        return x, y, heading, speed, yaw_rate
    
    def on_tick(self):
        now = self.get_clock().now()
        t = (now - self.t0).nanoseconds / 1e9
        stamp = now.to_msg()
        x, y, heading, speed, yaw_rate = self.state(t)

        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        odom.pose.pose.position.x = x
        odom.pose.pose.position.y = y
        odom.pose.pose.orientation = yaw_to_quaternion(heading)
        odom.twist.twist.linear.x = speed       # twist is in the robot's frame: forward speed
        odom.twist.twist.angular.z = yaw_rate
        self.odom_pub.publish(odom)

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
        ]
        diag = DiagnosticArray()
        diag.header.stamp = stamp
        diag.status = [status]
        self.diag_pub.publish(diag)
            
    def on_points(self):
        header = Header()
        header.stamp = self.get_clock().now().to_msg()
        header.frame_id = 'base_link'
        # A noisy ring ~10 m around the robot, 0-2 m tall: looks like a wall in Foxglove.
        points = []
        for _ in range(NUM_POINTS):
            angle = random.uniform(0.0, 2.0 * math.pi)
            r = random.gauss(10.0, 0.3)
            points.append((r * math.cos(angle), r * math.sin(angle), random.uniform(0.0, 2.0)))
        self.points_pub.publish(point_cloud2.create_cloud_xyz32(header, points))
    
    
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
