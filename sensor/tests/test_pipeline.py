"""流水线用合成帧跑一遍：标定 → 检测 → 跟踪 → 发 move；板端场景收 role / move / reset。"""
import numpy as np

from byside_sensor.calib.homography import grid_backproject
from byside_sensor.capture import synth
from byside_sensor.config import Calibration, SensorConfig
from byside_sensor.detect import ClassicDetector
from byside_sensor.pipeline import Pipeline
from byside_sensor.protocol import BLACK, WHITE, constants

N = constants().n


class FakeLink:
    def __init__(self):
        self.sent = []
        self.room = "u:AAAAAA"
        self.status = "fake"
        self.peers = 1
        self.on_msg = None

    def send(self, m):
        self.sent.append(m)
        return True

    def stop(self):
        pass


def make_pipeline(user="AAAAAA"):
    cfg = SensorConfig(source="synth", user=user, proc_width=0, auto_calib=False)
    img, truth, quad = synth.make_board(seed=11)
    h, w = img.shape
    calib = Calibration(quad=[[x / w, y / h] for x, y in quad])
    link = FakeLink()
    p = Pipeline(cfg, calib, ClassicDetector(), link)
    return p, link, img, truth


def test_board_only_reports_after_role_and_only_its_colour():
    p, link, img, truth = make_pipeline()
    bgr = np.repeat(img[:, :, None], 3, axis=2)
    # 没收到 role 之前不认子
    for _ in range(8):
        assert p.step(bgr) == []
    p.on_message({"t": "role", "code": "AAAAAA", "color": 1})
    assert p.seat == "black"
    changes = []
    for _ in range(8):
        changes += p.step(bgr)
    got = {(i, j): c for i, j, c, _ in changes}
    exp = {(k % N, k // N): BLACK for k, v in enumerate(truth) if v == BLACK}
    assert got == exp
    assert all(c == BLACK for c in got.values())


def test_remote_moves_and_reset_tracked_by_scene():
    p, link, _img, _truth = make_pipeline()
    p.on_message({"t": "move", "i": 3, "j": 4, "c": WHITE})
    assert p.gomoku.snapshot()["remote"][4 * N + 3] == WHITE
    p.on_message({"t": "state", "moves": [[1, 1, BLACK], [2, 2, WHITE]]})
    r = p.gomoku.snapshot()["remote"]
    assert r[N + 1] == BLACK and r[2 * N + 2] == WHITE and r[4 * N + 3] == 0
    p.on_message({"t": "reset"})
    assert p.gomoku.snapshot()["remote"].sum() == 0
    p.on_message({"t": "req"})
    assert link.sent[-1]["t"] == "state"


def test_room_change_clears_seat_and_scene_switch():
    p, link, _img, _truth = make_pipeline()
    p.on_message({"t": "role", "code": "AAAAAA", "color": 2})
    assert p.seat == "white"
    p.on_message({"t": "_room", "room": "s-xyz"})
    assert p.seat is None and p.room == "s-xyz"
    p.on_message({"t": "game", "g": "origami"})
    assert p.scene == "origami"
    p.on_message({"t": "step", "n": 3})
    assert p.origami.snapshot()["step"] == 3


def test_calib_toggle_notifies_web_with_owner_code(tmp_path, monkeypatch):
    p, link, _img, _truth = make_pipeline()
    p.apply_config({"mode": "calib"})
    assert link.sent[-1] == {"t": "calib", "on": True, "code": "AAAAAA"}
    p.apply_config({"quad": [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]})
    assert p.surface.quad[2] == [.9, .9]
    assert p.state_dict()["quad"] == p.surface.quad
