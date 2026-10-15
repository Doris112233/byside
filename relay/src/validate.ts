/* 入站消息校验。不认识的类型也放行（只要是带字符串 t 的对象），认识的类型检查字段形状，
   坏消息直接丢，不转发。 */
import type { Msg } from './types.ts';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const RULES: Record<string, (m: Msg) => boolean> = {
  move: (m) => isInt(m.i) && isInt(m.j) && isInt(m.c) && (m.c as number) >= 0 && (m.c as number) <= 2,
  state: (m) => Array.isArray(m.moves) && (m.moves as unknown[]).length <= 400 && (m.moves as unknown[]).every((x) => Array.isArray(x) && x.length >= 3 && x.slice(0, 3).every(isInt)),
  game: (m) => isStr(m.g, 32),
  step: (m) => isInt(m.n),
  point: (m) => isNum(m.x) && isNum(m.y),
  icon: (m) => isStr(m.k, 32),
  calib: (m) => isBool(m.on) || m.on === 0 || m.on === 1,
  role: (m) => isStr(m.code, 12) && (m.color === 1 || m.color === 2),
  invite: (m) => isStr(m.game, 32) && isStr(m.room, 64),
  accept: (m) => isStr(m.room, 64),
  rtc: (m) => m.sdp !== undefined || m.ice !== undefined || m.fallback !== undefined,
  join: (m) => isStr(m.room, 64),
  who: (m) => Array.isArray(m.codes) && (m.codes as unknown[]).length <= 200 && (m.codes as unknown[]).every((c) => isStr(c, 12)),
  busy: (m) => m.on !== undefined,
  rtctoken: (m) => isStr(m.channel, 64),
};

/** 解析一行文本；不合法返回 null */
export function parse(text: string): Msg | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const msg = m as Msg;
  if (!isStr(msg.t, 32) || !msg.t) return null;
  if (msg.to !== undefined && !isStr(msg.to, 12)) return null;
  const rule = RULES[msg.t];
  if (rule && !rule(msg)) return null;
  return msg;
}
