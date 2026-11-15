"""Warehouse routes: pure Python, no ROS, so tools/ can use the same paths as fake_robot.

Each robot's route is a closed loop of timed segments through robot/config/floor.json
(decisions log: Warehouse route, Robot spacing).
"""

import bisect
import math

# Motion limits: straight runs with a trapezoid speed profile, turns in place.
V_MAX = 1.5         # m/s
ACCEL = 0.75        # m/s^2, also used to brake
YAW_RATE = 1.0      # rad/s, turning in place
PICK_DWELL_S = 8.0  # at a pick station: mode "picking"
LIFT_DWELL_S = 5.0  # under a rack: mode "lifting"
OFFSET_STEP_S = 0.5  # time grid for the start-offset search


class Route:
    """One robot's closed loop of segments, each a pure function of time since its start.

    Segments: ('dwell', mode), ('rotate', from_heading, delta), ('drive', start, heading, length).
    Each leg: pick in the robot's bay, out to the column, down to the south lane, east to an
    aisle, up to a rack (lift), on to the north lane, west to the column, back into the bay.
    """

    def __init__(self, route, assignment):
        self.segments = []   # (t0, duration, kind, data)
        self.t = 0.0
        cx, bay_x = route['column_x'], route['bay_x']
        ys = route['station_y'][assignment['station']]
        south, north = route['south_lane_y'], route['north_lane_y']
        stops = route['rack_stop_y']

        # Floats throughout: ROS message fields reject the ints that JSON gives.
        self.pos = (float(bay_x), float(ys))
        self.heading = math.pi   # parked in the bay facing the station (west)
        for i, a in enumerate(assignment['aisles']):
            ax = route['aisle_x'][a]
            self.dwell('picking', PICK_DWELL_S)
            self.drive_to(cx, ys)
            self.drive_to(cx, south)
            self.drive_to(ax, south)
            self.drive_to(ax, stops[i % len(stops)])
            self.dwell('lifting', LIFT_DWELL_S)
            self.drive_to(ax, north)
            self.drive_to(cx, north)
            self.drive_to(cx, ys)
            self.drive_to(bay_x, ys)
        self.cycle = self.t
        self.starts = [seg[0] for seg in self.segments]

    def pad_to(self, cycle):
        """Lengthen the first pick so every robot's loop takes the same time (fixed spacing)."""
        extra = cycle - self.cycle
        t0, duration, kind, data = self.segments[0]
        self.segments = [(t0, duration + extra, kind, data)] + [
            (start + extra, d, k, dt) for start, d, k, dt in self.segments[1:]
        ]
        self.cycle = cycle
        self.starts = [seg[0] for seg in self.segments]

    def add(self, duration, kind, data):
        self.segments.append((self.t, duration, kind, data))
        self.t += duration

    def dwell(self, mode, duration):
        self.add(duration, 'dwell', (self.pos, self.heading, mode))

    def drive_to(self, x, y):
        dx, dy = x - self.pos[0], y - self.pos[1]
        length = math.hypot(dx, dy)
        if length == 0.0:
            return
        heading = math.atan2(dy, dx)
        delta = math.atan2(math.sin(heading - self.heading), math.cos(heading - self.heading))
        if abs(delta) > 1e-6:
            self.add(abs(delta) / YAW_RATE, 'rotate', (self.pos, self.heading, delta))
        self.add(drive_time(length), 'drive', (self.pos, heading, length))
        self.pos, self.heading = (float(x), float(y)), heading

    def state(self, t):
        """x, y, heading, speed, yaw_rate, mode at time t (any t; the route loops)."""
        t = t % self.cycle
        i = bisect.bisect_right(self.starts, t) - 1
        t0, duration, kind, data = self.segments[i]
        tau = t - t0
        if kind == 'dwell':
            (x, y), heading, mode = data
            return x, y, heading, 0.0, 0.0, mode
        if kind == 'rotate':
            (x, y), h0, delta = data
            rate = math.copysign(YAW_RATE, delta)
            return x, y, h0 + rate * tau, 0.0, rate, 'driving'
        (x0, y0), heading, length = data
        s, v = drive_profile(length, tau)
        return x0 + s * math.cos(heading), y0 + s * math.sin(heading), heading, v, 0.0, 'driving'


def plan_routes(route_cfg):
    """Every robot's route plus its start offset, the same on every robot.

    Offsets come from a greedy search: each robot in turn takes the offset that keeps it
    farthest from the robots already placed, over one whole cycle. Loops are padded to one
    length first, so the spacing found holds forever. Returns (routes, offsets, min spacing m).
    """
    routes = [Route(route_cfg, a) for a in route_cfg['assignments']]
    cycle = max(r.cycle for r in routes)
    for r in routes:
        r.pad_to(cycle)
    import numpy as np   # here, not at the top: the map tools import Route without numpy
    times = np.arange(0.0, cycle, OFFSET_STEP_S)
    paths = [np.array([r.state(t)[:2] for t in times]) for r in routes]
    shifts = [0]
    closest = math.inf
    for k in range(1, len(routes)):
        best_gap, best_shift = -1.0, 0
        for shift in range(len(times)):
            mine = np.roll(paths[k], -shift, axis=0)
            gap = min(
                np.min(np.linalg.norm(np.roll(paths[j], -shifts[j], axis=0) - mine, axis=1))
                for j in range(k)
            )
            if gap > best_gap:
                best_gap, best_shift = gap, shift
        shifts.append(best_shift)
        closest = min(closest, best_gap)
    return routes, [s * OFFSET_STEP_S for s in shifts], closest


def drive_time(length):
    if length >= V_MAX ** 2 / ACCEL:
        return 2.0 * V_MAX / ACCEL + (length - V_MAX ** 2 / ACCEL) / V_MAX
    return 2.0 * math.sqrt(length / ACCEL)   # never reaches V_MAX: accelerate, then brake


def drive_profile(length, tau):
    """Distance covered and speed, tau seconds into a straight run of the given length."""
    v_peak = min(V_MAX, math.sqrt(length * ACCEL))
    t_acc = v_peak / ACCEL
    d_acc = 0.5 * ACCEL * t_acc ** 2
    t_cruise = (length - 2.0 * d_acc) / v_peak
    if tau < t_acc:
        return 0.5 * ACCEL * tau ** 2, ACCEL * tau
    if tau < t_acc + t_cruise:
        return d_acc + v_peak * (tau - t_acc), v_peak
    left = max(2.0 * t_acc + t_cruise - tau, 0.0)
    return length - 0.5 * ACCEL * left ** 2, ACCEL * left
