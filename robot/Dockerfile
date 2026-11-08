FROM ros:jazzy

# rosbag2_py and the MCAP storage plugin come with ros-base on Jazzy; listing them
# keeps the dependency explicit. boto3 comes from apt so pip doesn't shadow the
# system Python libraries that ROS tools rely on.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip \
        python3-boto3 \
        ros-jazzy-rosbag2-py \
        ros-jazzy-rosbag2-storage-mcap \
    && rm -rf /var/lib/apt/lists/*

# paho-mqtt 2.x for the current callback API (Ubuntu 24.04's apt package is 1.x).
# The flag is needed because Ubuntu 24.04 marks the system Python as externally managed.
RUN pip3 install --no-cache-dir --break-system-packages "paho-mqtt>=2.1,<3"

WORKDIR /ws
