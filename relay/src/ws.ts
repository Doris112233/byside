/* WebSocket 接入：握手参数 → Conn；心跳；断开清理。协议本身在 router.ts。 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { CODE_LEN, FRAME_MAX } from './config.ts';
import { log } from './log.ts';
import type { Presence } from './presence.ts';
import type { Rooms } from './rooms.ts';
import type { Router } from './router.ts';
import type { Conn, Kind } from './types.ts';

export interface Hub {
  rooms: Rooms;
  presence: Presence;
  router: Router;
}

export function parseQuery(url: string): { code: string; kind: Kind; room: string; since: number; seat: string; name: string } {
  const u = new URL(url || '/', 'http://x');
  const code = (u.searchParams.get('user') ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, Math.max(CODE_LEN, 12));
  const kind: Kind = u.searchParams.get('kind') === 'board' ? 'board' : 'web';
  const room = (u.searchParams.get('room') ?? (code ? 'u:' + code : 'default')).slice(0, 64);
  const since = Math.max(0, Number(u.searchParams.get('since') ?? 0) || 0);
  const seat = (u.searchParams.get('seat') ?? (code ? code + (kind === 'board' ? '#board' : '') : '?')).slice(0, 24);
  const name = (u.searchParams.get('name') ?? '').slice(0, 16);
  return { code, kind, room, since, seat, name };
}

export class WsGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: FRAME_MAX });
  private readonly conns = new Set<Conn>();
  private readonly hub: Hub;
  private cid = 0;

  constructor(hub: Hub) {
    this.hub = hub;
  }

  /** 挂到 http(s) 服务器的 upgrade 事件上 */
  upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, req.url ?? '/'));
  };

  private accept(ws: WebSocket, url: string): void {
    const q = parseQuery(url);
    const c: Conn = {
      id: ++this.cid,
      code: q.code,
      kind: q.kind,
      seat: q.seat,
      name: q.name,
      room: null,
      watching: new Set(),
      alive: true,
      closed: false,
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text, (err) => { if (err) this.close(c); });
      },
      destroy: () => { try { ws.terminate(); } catch { /* 已断 */ } },
    };
    this.conns.add(c);
    this.hub.presence.add(c);
    this.hub.rooms.enter(c, q.room, q.since);
    log('#' + c.id + ' 接入 ' + (c.code ? c.code + '(' + c.kind + ') ' : '') + '房间「' + q.room + '」');

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.hub.router.handle(c, data.toString());
    });
    ws.on('pong', () => { c.alive = true; });
    ws.on('error', () => this.close(c));
    ws.on('close', () => this.close(c));
  }

  private close(c: Conn): void {
    if (c.closed) return;
    c.closed = true;
    this.conns.delete(c);
    const roomName = c.room?.name;
    this.hub.rooms.leave(c);
    this.hub.presence.remove(c);
    c.destroy();
    if (roomName) log('#' + c.id + ' 离开房间「' + roomName + '」');
  }

  /** 心跳：5 秒一次，一轮没回 pong 就踢掉。板子、被杀掉的标签页直接断 TCP，不心跳对方会一直看到「在线」。 */
  heartbeat(): void {
    for (const c of this.conns) {
      if (!c.alive) { this.close(c); continue; }
      c.alive = false;
    }
    for (const ws of this.wss.clients) {
      try { ws.ping(); } catch { /* 断了会在 close 里处理 */ }
    }
  }

  size(): number {
    return this.conns.size;
  }
}
