/* 房间：一局游戏的状态同步。
   慢通路消息分配序号、存进日志、断线能重放；state / reset 变成快照并清日志；
   role 和 game 单独保留（sticky），不然板子重连后拿不到这局认什么色。 */
import { LOG_MAX, ROOM_GC_MS } from './config.ts';
import { log } from './log.ts';
import type { Conn, Msg, Room } from './types.ts';

export class Rooms {
  readonly rooms = new Map<string, Room>();

  get(name: string): Room {
    let r = this.rooms.get(name);
    if (!r) {
      r = { name, clients: new Set(), seq: 0, log: [], snapshot: null, sticky: new Map(), emptyAt: 0 };
      this.rooms.set(name, r);
    }
    return r;
  }

  /** 进房间：补齐快照、保留项和增量。客户端带 since 回来时只补缺的那段；补不上就靠快照兜底。 */
  enter(c: Conn, name: string, since = 0): void {
    const r = this.get(name);
    c.room = r;
    r.clients.add(c);
    const out: { seq: number; text: string }[] = [];
    let from = since;
    if (r.snapshot && r.snapshot.seq > from) {
      out.push(r.snapshot);
      from = r.snapshot.seq;
    }
    for (const s of r.sticky.values()) if (s.seq > since && s.seq !== r.snapshot?.seq) out.push(s);
    for (const e of r.log) if (e.seq > from) out.push(e);
    out.sort((a, b) => a.seq - b.seq);
    /* _joined 必须先到：序号是按房间计的，客户端得先知道「换了房间」、把自己的 lastSeq 清零，
       再收重放 —— 顺序反了，旧房间的大序号会把新房间的小序号全吞掉。 */
    c.send(JSON.stringify({ t: '_joined', room: name, seat: c.seat, head: r.seq, peers: r.clients.size, replayed: out.length }));
    for (const x of out) c.send(x.text);
    this.announce(r);
  }

  leave(c: Conn): void {
    const r = c.room;
    if (!r) return;
    r.clients.delete(c);
    c.room = null;
    if (r.clients.size === 0) r.emptyAt = Date.now();
    else this.announce(r);
  }

  /** 快通路：转发即忘 */
  relay(r: Room, from: Conn | null, text: string): void {
    for (const c of r.clients) {
      if (c === from) continue;
      c.send(text);
    }
  }

  /** 慢通路：分配序号、记日志、转发。返回带 seq 的消息文本。 */
  record(r: Room, from: Conn, m: Msg): string {
    const seq = ++r.seq;
    m.seq = seq;
    const text = JSON.stringify(m);
    const entry = { seq, text };
    if (m.t === 'role' && typeof m.code === 'string') r.sticky.set('role:' + m.code, entry);
    else if (m.t === 'game') r.sticky.set('game', entry);
    else r.log.push(entry);
    if (r.log.length > LOG_MAX) r.log.shift();
    if (m.t === 'state' || m.t === 'reset') {
      r.snapshot = entry;
      r.log.length = 0;
    }
    this.relay(r, from, text);
    return text;
  }

  announce(r: Room): void {
    if (!r.clients.size) return;
    const msg = JSON.stringify({ t: '_peers', n: r.clients.size, seats: [...r.clients].map((x) => x.seat) });
    for (const c of r.clients) c.send(msg);
  }

  /** 空了十分钟的房间回收；两边都在重连时状态要还在 */
  gc(now = Date.now()): void {
    for (const [name, r] of this.rooms) {
      if (r.clients.size === 0 && r.emptyAt && now - r.emptyAt > ROOM_GC_MS) {
        this.rooms.delete(name);
        log('房间「' + name + '」空置十分钟，回收');
      }
    }
  }

  connections(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.clients.size;
    return n;
  }
}
