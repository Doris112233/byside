from .base import Detector, GridResult
from .classic import ClassicDetector
from .tracker import StoneTracker


def make_detector(kind: str, model: str = "") -> Detector:
    """按名字造检测器。onnx 的依赖是懒加载的，没装 onnxruntime 也不影响 classic。"""
    if kind == "classic":
        return ClassicDetector()
    if kind == "onnx":
        if not model:
            raise ValueError("--detector onnx 需要 --model best.onnx")
        from .onnx import OnnxStoneDetector
        return OnnxStoneDetector(model)
    raise ValueError(f"不认识的检测器：{kind}")


__all__ = ["Detector", "GridResult", "ClassicDetector", "StoneTracker", "make_detector"]
