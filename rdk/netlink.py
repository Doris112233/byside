"""
连中继服务器的 WebSocket 客户端 —— 零依赖，只用标准库。

板子这一端要的东西很少：连上、发 JSON、收 JSON、断了自己回来。
所以没必要拖一个 websockets 库进来，RFC6455 的客户端子集一百来行就够。

    link = NetLink("ws://1.2.3.4:8778/ws", room="home", seat="black",
                   on_msg=lambda m: print(m))
    link.start()
    link.send({"t": "move", "i": 7, "j": 7, "c": 1})

断线重连时会带上收到的最后一个序号，服务端据此补发 ——
「回合跳动、断线丢子」就是缺这一层。
"""
import base64
import json
import os
import socket
import struct
import threading
import time
import urllib.parse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
FAST = {"frame", "ink", "ping", "pong", "cursor"}       # 丢了就丢了，不排队重发


class NetLink:
    def __init__(self, url, room=None, seat=None, on_msg=None, on_state=None,
                 user=None, kind="web", name=""):
        """user 是好友码。带上它，服务端就知道「这是谁的设备」——
        主人走进一局游戏时，板子会被一起带进去，不用单独配房间。"""
        self.url = url
        self.user = (user or "").upper() or None
        self.kind = kind
        self.name = name
        self.room = room or (f"u:{self.user}" if self.user else "default")
        self.seat = seat or ((self.user + ("#board" if kind == "board" else "")) if self.user else "?")
        self.on_msg = on_msg or (lambda m: None)
        self.on_state = on_state or (lambda s: None)
        self.last_seq = 0
        self.sock = None
        self.connected = False
        self.peers = 0
        self.status = "未连接"
        self._stop = False
        self._lock = threading.Lock()
        self._pending = []          # 断线期间攒下的必达消息

    # ---------- 对外 ----------
    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()
        return self

    def stop(self):
        """礼貌地走：先发 WebSocket 关闭帧，服务端立刻知道这个设备下线了。"""
        self._stop = True
        with self._lock:
            s = self.sock
            if s is not None:
                try:
                    s.sendall(self._frame(b"\x03\xe8", 0x8))   # 1000 = 正常关闭
                except Exception:
                    pass
        self._close()

    def send(self, msg):
        """必达类消息在断线时排队，连上就补发；快通路消息直接丢。"""
        data = json.dumps(msg, ensure_ascii=False)
        with self._lock:
            s = self.sock
            if s is not None:
                try:
                    s.sendall(self._frame(data))
                    return True
                except Exception:
                    pass
            if msg.get("t") not in FAST:
                self._pending.append(msg)
                del self._pending[:-200]
        return False

    # ---------- 内部 ----------
    def _loop(self):
        delay = 1
        while not self._stop:
            try:
                self._connect()
                delay = 1
                self._read_forever()
            except Exception as e:
                self.status = f"断开: {type(e).__name__} {e}"
            self.connected = False
            self._close()
            if self._stop:
                return
            time.sleep(delay)
            delay = min(delay * 2, 10)

    def _connect(self):
        u = urllib.parse.urlparse(self.url)
        host = u.hostname
        port = u.port or (443 if u.scheme == "wss" else 80)
        path = u.path or "/ws"
        params = {"room": self.room, "seat": self.seat, "since": self.last_seq}
        if self.user:
            params.update(user=self.user, kind=self.kind)
            if self.name:
                params["name"] = self.name
        q = urllib.parse.urlencode(params)
        self.status = "连接中…"
        s = socket.create_connection((host, port), timeout=8)
        s.settimeout(None)
        if u.scheme == "wss":
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False          # 自签证书，局域网内够用
            ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {path}?{q} HTTP/1.1\r\nHost: {host}:{port}\r\n"
               f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                raise ConnectionError("握手时对端关闭")
            buf += chunk
        if b"101" not in buf.split(b"\r\n")[0]:
            raise ConnectionError("握手失败: " + buf.split(b"\r\n")[0].decode("latin1"))
        self._rest = buf.split(b"\r\n\r\n", 1)[1]
        with self._lock:
            self.sock = s
        self.connected = True
        self.status = f"已连接 房间「{self.room}」"
        self._flush()

    def _flush(self):
        with self._lock:
            q, self._pending = self._pending, []
        for m in q:
            self.send(m)

    def _frame(self, text, op=0x1):
        """客户端发出的帧必须加掩码（RFC6455 要求）。"""
        p = text.encode() if isinstance(text, str) else text
        n = len(p)
        h = bytearray([0x80 | op])
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126); h += struct.pack("!H", n)
        else:
            h.append(0x80 | 127); h += struct.pack("!Q", n)
        m = os.urandom(4)
        h += m
        return bytes(h) + bytes(b ^ m[i % 4] for i, b in enumerate(p))

    def _read_forever(self):
        buf = self._rest
        frags = bytearray()
        while not self._stop:
            while True:
                r = self._parse(buf)
                if r is None:
                    break
                fin, op, payload, buf = r
                if op == 0x8:
                    raise ConnectionError("对端关闭")
                if op == 0x9:                       # ping → pong
                    with self._lock:
                        if self.sock:
                            self.sock.sendall(self._frame(payload, 0xA))
                    continue
                if op == 0xA:
                    continue
                frags += payload
                if fin:
                    self._dispatch(bytes(frags))
                    frags = bytearray()
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("对端关闭")
            buf += chunk

    @staticmethod
    def _parse(buf):
        if len(buf) < 2:
            return None
        fin = bool(buf[0] & 0x80); op = buf[0] & 0x0F
        masked = bool(buf[1] & 0x80); n = buf[1] & 0x7F; off = 2
        if n == 126:
            if len(buf) < 4: return None
            n = struct.unpack("!H", buf[2:4])[0]; off = 4
        elif n == 127:
            if len(buf) < 10: return None
            n = struct.unpack("!Q", buf[2:10])[0]; off = 10
        mask = None
        if masked:
            if len(buf) < off + 4: return None
            mask = buf[off:off + 4]; off += 4
        if len(buf) < off + n:
            return None
        p = bytearray(buf[off:off + n])
        if mask:
            for i in range(len(p)):
                p[i] ^= mask[i % 4]
        return fin, op, bytes(p), buf[off + n:]

    def _dispatch(self, raw):
        try:
            m = json.loads(raw.decode("utf-8"))
        except Exception:
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

    def _close(self):
        with self._lock:
            s, self.sock = self.sock, None
        if s:
            # 先 shutdown 再 close。另一个线程正阻塞在 recv 上时，光 close
            # 在 macOS 上不会立刻发 FIN —— 服务端要等心跳超时（最长 10 秒）
            # 才知道板子下线了，这段时间里对方看到的「在线」是假的。
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                s.close()
            except Exception:
                pass
