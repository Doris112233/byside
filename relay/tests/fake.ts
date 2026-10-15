// 测试用的假连接：把发出去的消息收进数组
import type { Conn, Kind } from '../src/types.ts';

let id = 0;
export function fakeConn(code: string, kind: Kind = 'web', name = ''): Conn & { out: Array<Record<string, unknown>> } {
  const out: Array<Record<string, unknown>> = [];
  return {
    id: ++id,
    code,
    kind,
    seat: code + (kind === 'board' ? '#board' : ''),
    name,
    room: null,
    watching: new Set(),
    alive: true,
    closed: false,
    out,
    send: (text) => { out.push(JSON.parse(text) as Record<string, unknown>); },
    destroy: () => {},
  };
}

export const types = (c: { out: Array<Record<string, unknown>> }): string[] => c.out.map((m) => String(m.t));
