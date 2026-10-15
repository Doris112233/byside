"""场景清单。pipeline 按 messages 把消息派给场景，game 消息切当前场景。"""
from __future__ import annotations

from .base import BoardScene
from .gomoku import GomokuScene
from .origami import OrigamiScene

SCENE_IDS = ("gomoku", "origami", "chat")

__all__ = ["BoardScene", "GomokuScene", "OrigamiScene", "SCENE_IDS"]
