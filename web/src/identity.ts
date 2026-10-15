/* 身份与好友。不做账号：名字 + 自动生成的 6 位好友码，存在本机。
   码表去掉了 0 O 1 I L —— 念给老人听、老人照着输，这几个最容易混。 */
import { send } from './net/relay';
import { FRIEND_CODE } from './protocol/constants';
import { state, store } from './state';

export function newCode(): string {
  const a = new Uint8Array(FRIEND_CODE.length);
  crypto.getRandomValues(a);
  const alph = FRIEND_CODE.alphabet;
  return [...a].map((x) => alph[x % alph.length]).join('');
}

export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, FRIEND_CODE.length);
}

export function friendName(code: string): string {
  const f = store.friends.find((x) => x.code === code);
  return state.presence[code]?.name || f?.name || code;
}

const listeners: Array<() => void> = [];
/** 好友列表变了（加人、改名）就通知；首页据此重画 */
export function onFriendsChanged(fn: () => void): void {
  listeners.push(fn);
}

/** 把一个人加进好友列表。返回 true 表示是新加的。 */
export function ensureFriend(code: string, name = ''): boolean {
  if (!code || !state.me || code === state.me.code) return false;
  const fs = store.friends;
  const f = fs.find((x) => x.code === code);
  if (f) {
    if (name && f.name !== name) {
      f.name = name;
      store.friends = fs;
      listeners.forEach((l) => l());
    }
    return false;
  }
  fs.push({ code, name });
  store.friends = fs;
  send({ t: 'who', codes: [code] });
  listeners.forEach((l) => l());
  return true;
}
