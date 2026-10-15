/* 人和房间是两回事。房间是一局游戏的状态同步；人是好友码。
   一个人可以有多条连接：网页 + 板子。谁在线、谁忙，按好友码订阅。 */
import type { Conn } from './types.ts';

interface Meta { name: string; busy: boolean }

export class Presence {
  readonly users = new Map<string, Set<Conn>>(); // code → 连接
  readonly subs = new Map<string, Set<Conn>>(); // code → 谁在关心这个人
  readonly meta = new Map<string, Meta>();

  add(c: Conn): void {
    if (!c.code) return;
    let set = this.users.get(c.code);
    if (!set) {
      set = new Set();
      this.users.set(c.code, set);
    }
    set.add(c);
    const m = this.meta.get(c.code) ?? { name: '', busy: false };
    if (c.name) m.name = c.name;
    this.meta.set(c.code, m);
    this.notify(c.code);
  }

  remove(c: Conn): void {
    for (const code of c.watching) {
      const w = this.subs.get(code);
      if (w) {
        w.delete(c);
        if (!w.size) this.subs.delete(code);
      }
    }
    if (!c.code) return;
    const set = this.users.get(c.code);
    if (set) {
      set.delete(c);
      if (!set.size) {
        this.users.delete(c.code);
        const m = this.meta.get(c.code);
        if (m) m.busy = false;
      }
    }
    this.notify(c.code);
  }

  connsOf(code: string): Set<Conn> {
    return this.users.get(code) ?? new Set();
  }

  of(code: string) {
    let web = false;
    let board = false;
    for (const c of this.connsOf(code)) {
      if (c.kind === 'board') board = true;
      else web = true;
    }
    const m = this.meta.get(code);
    return { t: 'presence', code, online: web, desk: board, name: m?.name ?? '', busy: !!m?.busy };
  }

  subscribe(c: Conn, codes: string[]): void {
    for (const raw of codes.slice(0, 200)) {
      const code = String(raw).toUpperCase();
      if (!code) continue;
      let w = this.subs.get(code);
      if (!w) {
        w = new Set();
        this.subs.set(code, w);
      }
      w.add(c);
      c.watching.add(code);
      c.send(JSON.stringify(this.of(code)));
    }
  }

  setBusy(code: string, on: boolean): void {
    const m = this.meta.get(code) ?? { name: '', busy: false };
    m.busy = on;
    this.meta.set(code, m);
    this.notify(code);
  }

  notify(code: string): void {
    const w = this.subs.get(code);
    if (!w?.size) return;
    const msg = JSON.stringify(this.of(code));
    for (const c of w) c.send(msg);
  }
}
