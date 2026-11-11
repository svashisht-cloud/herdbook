"""edge_agent node. Stub: declares robot_id, logs once, spins."""

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node


class EdgeAgent(Node):

    def __init__(self):
        super().__init__('edge_agent')
        robot_id = self.declare_parameter('robot_id', '').value
        self.get_logger().info(f'edge_agent started for {robot_id}')


def main(args=None):
    rclpy.init(args=args)
    node = EdgeAgent()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
