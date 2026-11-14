#!/usr/bin/env bash
# One-robot fault injection, for the Makefile and the recording.
#
#   scripts/robot.sh fault   robotN   fire obstacle_stop (timeout 5 ros2 topic pub --once)
#   scripts/robot.sh cut     robotN   docker network disconnect (the robot keeps running)
#   scripts/robot.sh restore robotN   reconnect with the same network and aliases, then wait
#                                     until the robot is back on MQTT and online
set -euo pipefail
source "$(dirname "$0")/lib.sh"

ACTION=${1:-} R=${2:-}
case "$R" in robot[1-4]) ;; *) echo "usage: $0 {fault|cut|restore} robot1..robot4" >&2; exit 2 ;; esac

case "$ACTION" in
  fault)
    is_attached "$R" || die "$R is cut; ros2 topic pub hangs without a network. Restore it first."
    fire_event "$R" && echo "obstacle_stop fired on $R"
    ;;
  cut)
    is_attached "$R" && net_cut "$R"
    echo "$R cut from $NET (expect offline within ~8 s: 1.5 x the 5 s keepalive)"
    ;;
  restore)
    t=$(now_ms)
    net_restore "$R"
    docker inspect -f "{{json (index .NetworkSettings.Networks \"$NET\").Aliases}}" "$(ctr "$R")" | sed "s/^/$R aliases on $NET: /"
    ms=$(wait_reconnected "$R" "$t" 60) || exit 1
    echo "$R reconnected to MQTT and online after $(secs "$ms") s; rows still queued: $(queue_rows "$R")"
    ;;
  *) echo "usage: $0 {fault|cut|restore} robot1..robot4" >&2; exit 2 ;;
esac
