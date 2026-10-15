/* 应用级状态：我是谁、谁在线、正在邀请谁、正在和谁坐着。
   游戏自己的状态在各自的 scene 里，不在这。 */
import type { PresenceMsg } from './protocol/messages';

export interface Me { code: string; name: string }
export interface Friend { code: string; name: string }
export interface Invite { dir: 'out' | 'in'; peer: string; game: string; room: string }
export interface Session { room: string; peer: string; color: 1 | 2; startedAt: number }

export const state = {
  me: null as Me | null,
  presence: {} as Record<string, PresenceMsg>,
  inv: null as Invite | null,
  session: null as Session | null,
  scene: null as string | null,
  calib: false,
};

/** 进了门之后 me 一定有；没进门就调用是编程错误 */
export function me(): Me {
  if (!state.me) throw new Error('还没进门');
  return state.me;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 隐私模式等情况下存不了，页面照常跑 */
  }
}

/* 身份和好友存本机。好友列表按身份分开存：一台家里共用的平板上可能先后登过好几个人，
   不能你加的好友出现在我的列表里。 */
export const store = {
  get me(): Me | null {
    return read<Me | null>('byside.me2', null);
  },
  set me(v: Me | null) {
    write('byside.me2', v);
  },
  get friends(): Friend[] {
    if (!state.me) return [];
    const mine = state.me.code;
    return read<Friend[]>('byside.friends.' + mine, []).filter((f) => f.code !== mine);
  },
  set friends(v: Friend[]) {
    if (!state.me) return;
    const mine = state.me.code;
    write('byside.friends.' + mine, v.filter((f) => f.code !== mine));
  },
};
