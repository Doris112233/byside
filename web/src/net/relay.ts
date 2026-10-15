/* 和中继的那条 WebSocket。
   人有好友码，默认待在自己的房间 u:码；进会话时整个人（连同桌上的板子）搬进会话房间。
   序号按房间计，换房间要清零 —— 服务端会先发 _joined 再重放。
   断线期间的慢通路消息排进队列，连上后补发；快通路的丢了就丢了。 */
import { relayBase } from '../config';
import { $ } from '../dom';
import { RELIABLE, type AnyMessage } from '../protocol/messages';
import { me, state, store } from '../state';
import { dispatch } from './dispatch';

const base = relayBase();
let ws: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let tries = 0;
let lastSeq = 0;
let room: string | null = null;
let netOk = false;
const queue: AnyMessage[] = [];
const MAX_QUEUE = 200;

interface Ask { t: string; channel?: unknown; ok: (m: AnyMessage | null) => void; timer: ReturnType<typeof setTimeout> }
const asks: Ask[] = [];

let badgeLabel: () => string = () => '';
/** 右下角那枚小标后半截写什么（声网 / 原生），由 rtc 模块提供 */
export function setBadgeLabel(fn: () => string): void {
  badgeLabel = fn;
  badge();
}

function url(): string {
  const m = me();
  const q = new URLSearchParams({ user: m.code, kind: 'web', name: m.name, since: String(lastSeq) });
  if (room) q.set('room', room);
  return base + '?' + q.toString();
}

export function connect(): void {
  let sock: WebSocket;
  try {
    sock = new WebSocket(url());
  } catch {
    retry();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    tries = 0;
    setNet(true);
    send({ t: 'who', codes: [me().code, ...store.friends.map((f) => f.code)] });
    if (state.session) send({ t: 'busy', on: true });
    flush();
  };
  sock.onmessage = (e) => {
    let m: AnyMessage;
    try {
      m = JSON.parse(String(e.data)) as AnyMessage;
    } catch {
      return;
    }
    if (m.t === '_joined') {
      if (m.room !== room) {
        room = String(m.room);
        lastSeq = 0;
      }
      return;
    }
    if (typeof m.seq === 'number' && m.seq > lastSeq) lastSeq = m.seq;
    if (m.t === '_peers') return;
    const i = asks.findIndex((a) => a.t === m.t && a.channel === m.channel);
    if (i >= 0) {
      const a = asks.splice(i, 1)[0]!;
      clearTimeout(a.timer);
      a.ok(m);
      return;
    }
    if (m.seat === me().code) return; // 自己网页发出去又被重放回来的
    dispatch(m);
  };
  sock.onclose = () => {
    if (ws === sock) {
      ws = null;
      setNet(false);
      retry();
    }
  };
  sock.onerror = () => {};
}

function retry(): void {
  tries++;
  if (timer) clearTimeout(timer);
  timer = setTimeout(connect, Math.min(3000, 500 * Math.pow(1.5, Math.min(tries, 6))));
}

function raw(m: AnyMessage): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(m));
      return true;
    } catch {
      /* 落到下面排队 */
    }
  }
  return false;
}

/** 发一条。慢通路类型发不出去就排队，连上后按顺序补发 */
export function send(m: AnyMessage): boolean {
  m.seat = me().code;
  if (raw(m)) return true;
  if (RELIABLE.has(m.t)) {
    queue.push(m);
    if (queue.length > MAX_QUEUE) queue.shift();
  }
  return false;
}

function flush(): void {
  while (queue.length) {
    const m = queue[0]!;
    if (!raw(m)) return;
    queue.shift();
  }
}

export function join(r: string): void {
  send({ t: 'join', room: r, all: true });
}

/** 发一条并等同类型的回复（目前只用来要声网 token） */
export function ask(m: AnyMessage, ms = 6000): Promise<AnyMessage | null> {
  return new Promise((ok) => {
    const a: Ask = {
      t: m.t,
      channel: m.channel,
      ok,
      timer: setTimeout(() => {
        const i = asks.indexOf(a);
        if (i >= 0) asks.splice(i, 1);
        ok(null);
      }, ms),
    };
    asks.push(a);
    if (!raw({ ...m, seat: me().code })) {
      clearTimeout(a.timer);
      asks.splice(asks.indexOf(a), 1);
      ok(null);
    }
  });
}

export function queued(): number {
  return queue.length;
}

function setNet(ok: boolean): void {
  netOk = ok;
  const n = $('net');
  n.classList.toggle('ok', ok);
  const label = badgeLabel();
  n.querySelector('span')!.textContent = (ok ? '已连上' : '连接中') + (label ? ' · ' + label : '');
}
export function badge(): void {
  setNet(netOk);
}
