"""Start one robot's nodes under the namespace /<robot_id>."""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue

NODES = ('fake_robot', 'edge_agent', 'event_recorder')


def generate_launch_description():
    robot_id = LaunchConfiguration('robot_id')
    return LaunchDescription([
        DeclareLaunchArgument('robot_id', description='Robot ID, e.g. robot1'),
        *[
            Node(
                package='herdbook_robot',
                executable=name,
                name=name,
                namespace=robot_id,
                parameters=[{'robot_id': ParameterValue(robot_id, value_type=str)}],
                output='screen',
            )
            for name in NODES
        ],
    ])
