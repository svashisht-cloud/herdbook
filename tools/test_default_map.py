"""Checks for the generated default map. Run: python3 -m unittest discover tools"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_default_map as m  # noqa: E402

PGM = m.OUT_DIR / "yard.pgm"
YAML = m.OUT_DIR / "yard.yaml"


def read_pgm(path):
    data = path.read_bytes()
    tokens, i = [], 0
    while len(tokens) < 4:
        while data[i:i + 1].isspace():
            i += 1
        if data[i:i + 1] == b"#":
            while data[i:i + 1] != b"\n":
                i += 1
            continue
        start = i
        while not data[i:i + 1].isspace():
            i += 1
        tokens.append(data[start:i].decode())
    i += 1  # the single whitespace after maxval
    magic, w, h, maxval = tokens[0], int(tokens[1]), int(tokens[2]), int(tokens[3])
    pixels = data[i:]
    return magic, w, h, maxval, pixels


class DefaultMapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.magic, cls.w, cls.h, cls.maxval, cls.px = read_pgm(PGM)
        cls.yaml = YAML.read_text()

    def free_at(self, x, y):
        """Map-frame metres -> is that pixel free? PGM row 0 is the top, so flip y."""
        i = int(x / m.RESOLUTION)
        j = int(y / m.RESOLUTION)
        row = self.h - 1 - j
        return self.px[row * self.w + i] == m.FREE

    def test_header_matches_yaml(self):
        self.assertEqual(self.magic, "P5")
        self.assertEqual(self.maxval, 255)
        self.assertEqual((self.w, self.h), (1000, 600))
        self.assertEqual(len(self.px), self.w * self.h)
        for line in ("image: yard.pgm", "resolution: 0.1", "origin: [0, 0, 0]", "negate: 0",
                     "occupied_thresh: 0.65", "free_thresh: 0.25"):
            self.assertIn(line, self.yaml)

    def test_robot_loop_plus_margin_is_free(self):
        # All 4 robots drive the same ellipse (phases index * pi/2), so check the whole loop.
        cx, cy, rx, ry = m.robot_loop()
        margin = m.SAFETY_MARGIN_M
        offsets = [(dx * m.RESOLUTION, dy * m.RESOLUTION)
                   for dx in range(-30, 31) for dy in range(-30, 31)
                   if math.hypot(dx, dy) * m.RESOLUTION <= margin]
        for k in range(3600):
            a = 2 * math.pi * k / 3600
            x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
            for dx, dy in offsets[::7]:  # a sparse disk is enough at 0.1 m pixels
                self.assertTrue(self.free_at(x + dx, y + dy), f"blocked near ({x:.1f}, {y:.1f})")

    def test_marker_only_in_top_right(self):
        self.assertFalse(self.free_at(94, 54))  # marker
        self.assertTrue(self.free_at(91.5, 51.5))  # its notch
        for x, y in ((6, 54), (94, 6), (6, 6)):  # mirrored corners stay empty
            self.assertTrue(self.free_at(x, y), f"({x}, {y}) should be free")

    def test_outer_wall(self):
        self.assertFalse(self.free_at(0.2, 30))
        self.assertFalse(self.free_at(50, 59.8))

    def test_generator_is_deterministic(self):
        self.assertEqual(m.pgm_bytes(), PGM.read_bytes())


if __name__ == "__main__":
    unittest.main()
