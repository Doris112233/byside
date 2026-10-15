"""NetLink 不连网也能测的部分：断线排队、_joined 换房间、过滤自己的消息。"""
from byside_sensor.net.link import NetLink


def test_slow_messages_queue_while_offline_and_fast_ones_drop():
    link = NetLink("ws://127.0.0.1:1/ws", user="AAAAAA", kind="board")
    assert link.seat == "AAAAAA#board" and link.room == "u:AAAAAA"
    assert link.send({"t": "move", "i": 1, "j": 1, "c": 1}) is False
    assert link.send({"t": "icon", "k": "heart"}) is False
    assert [m["t"] for m in link._pending] == ["move"]


def test_joined_switches_room_and_resets_seq():
    got = []
    link = NetLink("ws://127.0.0.1:1/ws", user="AAAAAA", kind="board", on_msg=got.append)
    link._on_message(None, '{"t":"move","i":1,"j":2,"c":1,"seq":9}')
    assert link.last_seq == 9 and got[-1]["t"] == "move"
    link._on_message(None, '{"t":"_joined","room":"s-1","peers":2,"replayed":0}')
    assert link.room == "s-1" and link.last_seq == 0 and got[-1] == {"t": "_room", "room": "s-1"}
    link._on_message(None, '{"t":"move","i":1,"j":2,"c":1,"seat":"AAAAAA#board"}')
    assert got[-1]["t"] == "_room"  # 自己发的被过滤
    link._on_message(None, 'not json')
    assert len(got) == 2
