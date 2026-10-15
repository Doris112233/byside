"""多相机：一体机上有三只广角，各自看桌面的一部分。

现在的 pipeline 只用第一只；这个类先把「同时开几只、按 camera_id 取帧」的形状定下来，
以后融合（各相机 → 同一个桌面坐标系）加在 calib/surface 里，不用再改采集层。
"""
from __future__ import annotations

from .source import Frame, FrameSource


class CameraRig:
    def __init__(self, sources: dict[str, FrameSource]):
        if not sources:
            raise ValueError("至少要一只相机")
        self.sources = sources

    @classmethod
    def open(cls, specs: dict[str, str], **kw) -> "CameraRig":
        return cls({cid: FrameSource.open(spec, camera_id=cid, **kw) for cid, spec in specs.items()})

    @property
    def primary(self) -> FrameSource:
        return next(iter(self.sources.values()))

    def read_all(self) -> dict[str, Frame]:
        out: dict[str, Frame] = {}
        for cid, s in self.sources.items():
            f = s.read_frame()
            if f is not None:
                out[cid] = f
        return out

    def close(self) -> None:
        for s in self.sources.values():
            s.close()
