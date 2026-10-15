from byside_sensor.protocol import BLACK, EMPTY, WHITE, constants


def test_constants_match_shared_json():
    c = constants()
    assert c.n == 15
    assert (BLACK, WHITE, EMPTY) == (c.raw["stone"]["black"], c.raw["stone"]["white"], c.raw["stone"]["empty"])
    assert "icon" in c.fast and "move" not in c.fast
    assert len(c.patterns) == 4 and all(len(p) == 4 and all(len(r) == 4 for r in p) for p in c.patterns)
    # 投影环的内沿必须比识别内圆大，否则投影会被当成真棋子
    assert c.ring_inner_cells > c.detect_inner_cells


def test_classic_inner_radius_matches_constants():
    from byside_sensor.detect.classic import INNER_R
    assert INNER_R == constants().detect_inner_cells
