import math

from byside_sensor.calib.homography import apply_h, cell_size, grid_backproject, homography
from byside_sensor.calib.surface import Surface


def test_homography_roundtrip_identity_square():
    h = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [100, 0], [100, 100], [0, 100]])
    assert h is not None
    x, y = apply_h(h, 0.5, 0.25)
    assert math.isclose(x, 50) and math.isclose(y, 25)


def test_grid_backproject_corners_and_cell():
    quad = [[100, 100], [800, 100], [800, 800], [100, 800]]
    bp = grid_backproject(quad, 15)
    assert bp is not None
    assert bp(0, 0) == (100, 100)
    x, y = bp(14, 14)
    assert math.isclose(x, 800) and math.isclose(y, 800)
    assert math.isclose(cell_size(bp), 50)


def test_degenerate_quad_returns_none():
    assert homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [0, 0], [0, 0], [0, 0]]) is None


def test_surface_normalized_quad_scales_with_shape():
    s = Surface(15)
    s.set_quad([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]])
    bp = s.backproject((720, 1280))
    assert bp is not None
    x, y = bp(0, 0)
    assert math.isclose(x, 128) and math.isclose(y, 72)
    assert s.corners_px((720, 1280))[2] == (1152, 648)
