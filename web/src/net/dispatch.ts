/* 收消息：按 t 注册处理函数。模块各自注册自己关心的类型，没有中央 switch。 */
import type { AnyMessage } from '../protocol/messages';

type Handler = (m: AnyMessage) => void;
const handlers = new Map<string, Handler[]>();

export function on(types: string | readonly string[], h: Handler): void {
  for (const t of Array.isArray(types) ? types : [types as string]) {
    const list = handlers.get(t) ?? [];
    list.push(h);
    handlers.set(t, list);
  }
}

export function dispatch(m: AnyMessage): boolean {
  const list = handlers.get(m.t);
  if (!list?.length) return false;
  for (const h of list) h(m);
  return true;
}

export function handledTypes(): string[] {
  return [...handlers.keys()];
}
