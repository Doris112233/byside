"""向量化的 classify_abs 必须和逐行对应原版的 classify_abs_ref 逐位一致，否则就不是优化而是改算法。"""
import numpy as np
import pytest

from byside_sensor.calib.homography import grid_backproject
from byside_sensor.capture import synth
from byside_sensor.detect.classic import ClassicDetector, classify_abs, classify_abs_ref
from byside_sensor.protocol import constants

N = constants().n


@pytest.mark.parametrize("seed", [1, 7, 42])
@pytest.mark.parametrize("seat", [None, "black", "white"])
def test_vectorized_matches_reference(seed, seat):
    img, _truth, quad = synth.make_board(seed=seed)
    bp = grid_backproject(quad, N)
    ref = classify_abs_ref(img, bp, N, seat=seat)
    fast = classify_abs(img, bp, N, seat=seat)
    assert np.array_equal(ref.cls, fast.cls)
    assert np.allclose(ref.score, fast.score, atol=1e-4)
    assert ref.cell == fast.cell


def test_detector_accepts_color_frames():
    img, truth, quad = synth.make_board(seed=3)
    bgr = np.repeat(img[:, :, None], 3, axis=2)
    res = ClassicDetector().classify(bgr, grid_backproject(quad, N), N, None)
    assert res.cls is not None
    # 合成图上应该基本全对
    assert (res.cls == truth).mean() > 0.98


def test_too_small_cell_gives_no_result():
    quad = [[0, 0], [10, 0], [10, 10], [0, 10]]
    res = classify_abs(np.zeros((20, 20), np.uint8), grid_backproject(quad, N), N)
    assert res.cls is None and res.cell < 4
