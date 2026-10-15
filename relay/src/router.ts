/* 一条消息进来之后怎么走：
   带 to 的点名消息跨房间按好友码投递；who / join / busy / rtctoken 是对服务端说的；
   其余按房间转发：快通路即发即忘，慢通路编号、记日志。 */
import { rtcToken } from './agora-token.ts';
import { FAST, TOKEN_TTL } from './config.ts';
import { log } from './log.ts';
import type { Presence } from './presence.ts';
import type { Rooms } from './rooms.ts';
import type { Conn, Msg } from './types.ts';
import { parse } from './validate.ts';

export interface RouterDeps {
  rooms: Rooms;
  presence: Presence;
  agora: { appId: string; cert: string };
}

export class Router {
  private readonly d: RouterDeps;
  constructor(d: RouterDeps) {
    this.d = d;
  }

  handle(from: Conn, text: string): void {
    const m = parse(text);
    if (!m) return; // 坏消息不转发
    const { rooms, presence } = this.d;
    const t = m.t;

    if (t === 'ping') {
      from.send('{"t":"pong"}');
      return;
    }

    /* 点名消息：跨房间，按好友码投递给那个人的所有网页连接。
       邀请、接受、挂断、音视频信令、加好友都走这里——它们是找人，不是找房间，
       也不进日志：来电被重放到断线前，就是幽灵来电。 */
    if (typeof m.to === 'string' && from.code) {
      const to = m.to.toUpperCase();
      m.from = from.code;
      m.name = presence.meta.get(from.code)?.name || (typeof m.name === 'string' ? m.name : '');
      const out = JSON.stringify(m);
      let n = 0;
      for (const c of presence.connsOf(to)) {
        if (c.kind === 'web' && c !== from) {
          c.send(out);
          n++;
        }
      }
      if (n === 0 && t !== 'rtc') from.send(JSON.stringify({ t: '_undelivered', to, of: t }));
      return;
    }

    if (t === 'who') {
      presence.subscribe(from, m.codes as string[]);
      return;
    }

    if (t === 'rtctoken') {
      const ch = String(m.channel);
      if (!this.d.agora.appId || !this.d.agora.cert) {
        from.send(JSON.stringify({ t: 'rtctoken', channel: ch, error: 'no-cert' }));
        return;
      }
      if (!(from.room && from.room.name === ch && ch.startsWith('s-'))) {
        from.send(JSON.stringify({ t: 'rtctoken', channel: ch, error: 'not-in-room' }));
        return;
      }
      const token = rtcToken(this.d.agora.appId, this.d.agora.cert, ch, 0, TOKEN_TTL);
      from.send(JSON.stringify({ t: 'rtctoken', channel: ch, appId: this.d.agora.appId, token, ttl: TOKEN_TTL }));
      log(from.code + ' 领了会话「' + ch + '」的声网 token');
      return;
    }

    if (t === 'busy' && from.code) {
      presence.setBusy(from.code, !!m.on);
      return;
    }

    /* 换房间。all=true 时这个人的所有连接一起走 —— 网页进了会话，桌上的板子跟着进去 */
    if (t === 'join') {
      const target = String(m.room).slice(0, 64);
      const movers = m.all && from.code ? [...presence.connsOf(from.code)] : [from];
      for (const c of movers) {
        if (c.room?.name === target) continue;
        rooms.leave(c);
        rooms.enter(c, target, 0);
      }
      log((from.code || '#' + from.id) + ' → 房间「' + target + '」（' + movers.length + ' 个连接）');
      return;
    }

    const r = from.room;
    if (!r) return;
    m.seat = from.seat; // 服务端打标，客户端自己写的不算
    if (FAST.has(t)) {
      rooms.relay(r, from, JSON.stringify(m));
      return;
    }
    rooms.record(r, from, m);
  }
}

export type { Msg };
