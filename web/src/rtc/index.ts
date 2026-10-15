/* 音视频门面。有声网 App ID 就用声网，连不上自动退回原生 —— 演示现场哪条通走哪条。
   声网连不上时两边必须一起退：一边在声网频道里、另一边在等原生 offer，谁也看不见谁。
   退的那边发 {t:'rtc',fallback:1}，收到的一边也走 toNative；切换期间来的信令先排队（ready），
   不然 offer 会落到声网那个空实现上丢掉。 */
import { on } from '../net/dispatch';
import { badge, setBadgeLabel } from '../net/relay';
import type { RtcMsg } from '../protocol/messages';
import { state } from '../state';
import { toast } from '../ui/toast';
import { agora, loadAgora, setFailHandler } from './agora';
import { native } from './native';
import type { RtcImpl } from './types';

let impl: RtcImpl = native;
let ready: Promise<void> = Promise.resolve();

export const name = (): RtcImpl['name'] => impl.name;
export const prepare = (): Promise<void> => impl.prepare();
export const offer = (peer: string): Promise<void> => impl.offer(peer);
export const connected = (): Promise<void> => impl.connected();
export const close = (): Promise<void> => impl.close();

export function toNative(): Promise<void> {
  if (impl.name !== 'agora') return ready;
  const old = impl;
  impl = native;
  badge();
  ready = (async () => {
    try { await old.close(); } catch { /* 已关 */ }
    await native.prepare();
    if (state.session?.color === 1) await native.offer(state.session.peer);
  })();
  return ready;
}

export function init(): void {
  setBadgeLabel(() => (impl.name === 'agora' ? '声网' : '原生'));
  setFailHandler(() => void toNative());
  on('rtc', (m) => {
    const r = m as RtcMsg;
    if (r.fallback) {
      if (state.session && r.from === state.session.peer) void toNative();
    } else {
      void ready.then(() => impl.onSignal(r));
    }
  });
  loadAgora(
    () => { impl = agora; console.log('[rtc] 声网已就绪'); badge(); },
    () => { console.warn('[rtc] 声网 SDK 加载失败，用原生'); toast('声网 SDK 没加载出来，先用原生画面', 4000); badge(); },
  );
}
