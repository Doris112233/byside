"""准确率门槛：合成测试集 ≥ 99%，遮挡保护不漏。和 tools/eval.py 是同一套函数。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import eval as ev  # noqa: E402


def test_synthetic_accuracy():
    r = ev.run_synthetic(6, "black")
    assert r["acc"] >= 99.0, r


def test_occlusion_never_leaks():
    leaked, trials = ev.run_occlusion("black", trials=3)
    assert leaked == 0
