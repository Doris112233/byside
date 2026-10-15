"""onnx 检测器不需要模型也能测的部分：框中心落格点、座位过滤、同格去重、YOLO 输出解析。"""
import numpy as np

from byside_sensor.calib.homography import cell_size, grid_backproject
from byside_sensor.detect.onnx import detections_to_grid, parse_yolo
from byside_sensor.protocol import BLACK, EMPTY, WHITE

N = 15


def test_detections_snap_to_nearest_grid_point():
    bp = grid_backproject([[100, 100], [800, 100], [800, 800], [100, 800]], N)
    cell = cell_size(bp)
    px = lambda i, j: bp(i, j)  # noqa: E731
    dets = [
        (*px(7, 7), BLACK, .9),
        (px(0, 0)[0] + cell * .3, px(0, 0)[1] - cell * .2, WHITE, .8),         # 偏一点仍归到 (0,0)
        (px(3, 4)[0] + cell * .5, px(3, 4)[1] + cell * .5, BLACK, .95),        # 正好在四个格点中间，丢弃
        (*px(14, 14), WHITE, .5), (*px(14, 14), BLACK, .7),                    # 同格点取高分
    ]
    cls, score, _ = detections_to_grid(dets, bp, N, cell)
    assert cls[7 * N + 7] == BLACK and cls[0] == WHITE and cls[14 * N + 14] == BLACK
    assert cls[4 * N + 3] == EMPTY and cls[4 * N + 4] == EMPTY
    assert int((cls != EMPTY).sum()) == 3
    assert score[14 * N + 14] == np.float32(.7)
    only_black, _, _ = detections_to_grid(dets, bp, N, cell, seat="black")
    assert only_black[0] == EMPTY and only_black[7 * N + 7] == BLACK


def test_parse_yolo_both_layouts():
    fake = np.zeros((1, 6, 8400), np.float32)
    fake[0, :, 10] = [320, 320, 30, 30, .1, .9]
    p = parse_yolo(fake, .35)
    assert len(p) == 1 and p[0][4] == 1 and abs(p[0][5] - .9) < 1e-6
    p2 = parse_yolo(fake.transpose(0, 2, 1), .35)
    assert p2 == p
