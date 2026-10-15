import numpy as np

from byside_sensor.detect.tracker import StoneTracker

N = 15


def grid(*stones):
    g = np.zeros(N * N, np.int8)
    for i, j, c in stones:
        g[j * N + i] = c
    return g


def test_stone_confirmed_only_after_stable_frames():
    tr = StoneTracker(N, stable=3, clean_max=6)
    g = grid((7, 7, 1))
    assert tr.update(g) == []
    assert tr.update(g) == []
    assert tr.update(g) == [(7, 7, 1, 0)]
    assert tr.count == 1
    assert tr.update(g) == []  # 不重复报


def test_flicker_does_not_confirm():
    tr = StoneTracker(N, stable=3)
    a, b = grid((7, 7, 1)), grid()
    for g in (a, b, a, b, a):
        assert tr.update(g) == []
    assert tr.count == 0


def test_hand_occlusion_freezes_until_pattern_is_stable():
    tr = StoneTracker(N, stable=2, clean_max=3)
    base = grid((1, 1, 1))
    for _ in range(2):
        tr.update(base)
    assert tr.count == 1
    # 手伸进来：一下子多出 8 个「子」，而且每帧位置都变
    for k in range(5):
        hand = grid((1, 1, 1), *[(5 + k, j, 2) for j in range(8)])
        assert tr.update(hand) == []
        assert tr.occluded
    assert tr.count == 1
    # 同一个图样稳定 stable*3 帧：一次摆好几颗子，认了
    many = grid((1, 1, 1), (3, 3, 2), (4, 4, 2), (5, 5, 2), (6, 6, 2))
    changes = []
    for _ in range(2 * 3 + 2):
        changes += tr.update(many)
    assert not tr.occluded
    assert tr.count == 5
    assert sorted(c[:2] for c in changes) == [(3, 3), (4, 4), (5, 5), (6, 6)]
