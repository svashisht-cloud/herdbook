from glob import glob

from setuptools import find_packages, setup

package_name = 'herdbook_robot'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Shubh',
    maintainer_email='shubhv2@gmail.com',
    description='Herdbook simulated robot: fake_robot, edge_agent and event_recorder nodes.',
    license='TODO: License declaration',
    entry_points={
        'console_scripts': [
            'fake_robot = herdbook_robot.fake_robot:main',
            'edge_agent = herdbook_robot.edge_agent:main',
            'event_recorder = herdbook_robot.event_recorder:main',
        ],
    },
)
