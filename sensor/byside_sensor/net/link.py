"""连中继的 WebSocket 客户端（websocket-client）。

板子这一端要的东西很少：连上、发 JSON、收 JSON、断了自己回来。
断线重连时带上收到的最后一个序号，服务端据此补发；断线期间的慢通路消息排队，连上就补发。

    link = NetLink("ws://1.2.3.4:8778/ws", user="K7M2QX", kind="board", on_msg=print).start()
    link.send({"t": "move", "i": 7, "j": 7, "c": 1})
"""
from __future__ import annotations

import json
import ssl
import threading
import time
import urllib.parse
from collections.abc import Callable

import websocket

from byside_sensor.protocol import Message, constants

OnMsg = Callable[[Message], None]


class NetLink:
    def __init__(self, url: str, room: str | None = None, seat: str | None = None, on_msg: OnMsg | None = None,
                 user: str | None = None, kind: str = "web", name: str = "", insecure_tls: bool = False):
        """user 是好友码。带上它，服务端就知道「这是谁的设备」——主人走进一局游戏时，板子会被一起带进去。"""
        self.url = url
        self.user = (user or "").upper() or None
        self.kind = kind
        self.name = name
        self.room = room or (f"u:{self.user}" if self.user else "default")
        self.seat = seat or ((self.user + ("#board" if kind == "board" else "")) if self.user else "?")
        self.on_msg: OnMsg = on_msg or (lambda m: None)
        self.insecure_tls = insecure_tls
        self.last_seq = 0
        self.connected = False
        self.peers = 0
        self.status = "未连接"
        self._fast = constants().fast
        self._ws: websocket.WebSocketApp | None = None
        self._stop = False
        self._lock = threading.Lock()
        self._pending: list[Message] = []   # 断线期间攒下的必达消息

    # ---------- 对外 ----------
    def start(self) -> NetLink:
        threading.Thread(target=self._loop, daemon=True, name="netlink").start()
        return self

    def stop(self) -> None:
        self._stop = True
        ws = self._ws
        if ws:
            try:
                ws.close()
            except Exception:
                pass

    def send(self, msg: Message) -> bool:
        """必达类消息在断线时排队，连上就补发；快通路消息直接丢。"""
        data = json.dumps(msg, ensure_ascii=False)
        ws = self._ws
        if ws and self.connected:
            try:
                ws.send(data)
                return True
            except Exception:
                pass
        if msg.get("t") not in self._fast:
            with self._lock:
                self._pending.append(msg)
                del self._pending[:-200]
        return False

    # ---------- 内部 ----------
    def _url(self) -> str:
        params = {"room": self.room, "seat": self.seat, "since": self.last_seq}
        if self.user:
            params.update(user=self.user, kind=self.kind)
            if self.name:
                params["name"] = self.name
        return self.url + ("&" if "?" in self.url else "?") + urllib.parse.urlencode(params)

    def _loop(self) -> None:
        delay = 1
        while not self._stop:
            self.status = "连接中…"
            ws = websocket.WebSocketApp(
                self._url(), on_open=self._on_open, on_message=self._on_message,
                on_close=self._on_close, on_error=self._on_error,
            )
            self._ws = ws
            sslopt = {"cert_reqs": ssl.CERT_NONE} if self.insecure_tls else None
            try:
                ws.run_forever(sslopt=sslopt, ping_interval=0)
            except Exception as e:
                self.status = f"断开: {type(e).__name__} {e}"
            self.connected = False
            self._ws = None
            if self._stop:
                return
            time.sleep(delay)
            delay = min(delay * 2, 10)
            if self.connected:
                delay = 1

    def _on_open(self, ws) -> None:
        self.connected = True
        self.status = f"已连接 房间「{self.room}」"
        with self._lock:
            q, self._pending = self._pending, []
        for m in q:
            self.send(m)

    def _on_close(self, ws, code, reason) -> None:
        self.connected = False
        self.status = f"断开: {code or ''} {reason or ''}".strip()

    def _on_error(self, ws, err) -> None:
        self.status = f"断开: {type(err).__name__} {err}"

    def _on_message(self, ws, raw) -> None:
        try:
            m = json.loads(raw)
        except Exception:
            return
        if not isinstance(m, dict):
            return
        seq = m.get("seq")
        if isinstance(seq, int) and seq > self.last_seq:
            self.last_seq = seq
        t = m.get("t")
        if t == "_joined":
            room = m.get("room")
            if room and room != self.room:
                # 换了房间：序号是按房间计的，旧的作废。重连时要回到这个新房间。
                self.room = room
                self.last_seq = 0
                self.on_msg({"t": "_room", "room": room})
            self.peers = m.get("peers", 0)
            self.status = f"已连接 房间「{self.room}」"
            if m.get("replayed"):
                print(f"[net] 补发 {m['replayed']} 条", flush=True)
            return
        if t == "_peers":
            self.peers = m.get("n", 0)
            return
        if t == "ping":
            self.send({"t": "pong"})
            return
        if m.get("seat") == self.seat:
            return
        self.on_msg(m)
