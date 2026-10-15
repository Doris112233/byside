/* 焦点导航。投影在桌上时没有触屏，遥控器就是全部 ——
   方向键在看得见的按钮之间走，确定 = 按下，返回 = 退一步。像电视一样：老人对电视遥控器是熟的。
   有的区域会「借走」方向键（棋盘走光标、折纸指一指）：用 bindKeys 在元素上挂一个处理函数，
   返回 true 表示这个键它处理了。 */
import { $ } from '../dom';

export type NavAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';
export type KeysHandler = (act: NavAction) => boolean;
export type HintProvider = (active: Element | null) => string | null;
export type HotkeyHandler = (key: string) => boolean;

const DIR: Record<string, NavAction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const OK = new Set(['Enter', 'NumpadEnter', ' ', 'Select', 'Accept']);
const BACK = new Set(['Escape', 'BrowserBack', 'GoBack', 'Backspace', 'Back']);
/* 便宜遥控器、IR 接收器在 Linux 下常常只给 keyCode，e.key 是空的或 Unidentified。
   安卓电视盒的确定键是 23，LG 电视返回是 461，三星是 10009。遥控器能不能用不能赌键名。 */
const BY_CODE: Record<number, string> = {
  13: 'Enter', 23: 'Enter', 66: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
  8: 'Backspace', 27: 'Escape', 166: 'BrowserBack', 461: 'BrowserBack', 10009: 'BrowserBack',
};
const keyOf = (e: KeyboardEvent): string => (e.key && e.key !== 'Unidentified' ? e.key : (BY_CODE[e.keyCode] ?? ''));

const keyHandlers = new WeakMap<Element, KeysHandler>();
const hintProviders = new Map<string, HintProvider>(); // 层 id（screen 或 sheet）→ 提示
const backHandlers = new Map<string, () => void>();
const hotkeys: HotkeyHandler[] = [];

export function bindKeys(el: Element, fn: KeysHandler): void {
  keyHandlers.set(el, fn);
}
export function setHint(layerId: string, fn: HintProvider): void {
  hintProviders.set(layerId, fn);
}
export function onBack(layerId: string, fn: () => void): void {
  backHandlers.set(layerId, fn);
}
/** 普通按键（数字、字母）。处理了返回 true。 */
export function addHotkey(fn: HotkeyHandler): void {
  hotkeys.push(fn);
}

function layer(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('.veil.on')].pop() ?? document.querySelector<HTMLElement>('.screen.on');
}
function items(): HTMLElement[] {
  const l = layer();
  if (!l) return [];
  return [...l.querySelectorAll<HTMLElement>('[data-nav]')].filter(
    (el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled,
  );
}

export function focus(el: Element | null | undefined): void {
  if (el instanceof HTMLElement) {
    el.focus({ preventScroll: false });
    hint();
  }
}

export function first(sel?: string | null): void {
  const l = layer();
  if (!l) return;
  let el = sel ? l.querySelector<HTMLElement>(sel) : null;
  // 在家里，拿起遥控器按确定应该是「找人」，不是「看我的好友码」
  if (!el && l.id === 's-home') el = l.querySelector('.fcard.on:not(.busy)') ?? l.querySelector('.fcard');
  focus(el ?? items()[0]);
}

export function move(dir: NavAction): void {
  const list = items();
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) {
    focus(list[0]);
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bs = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    let main: number;
    let cross: number;
    if (dir === 'left') { if (dx > -2) continue; main = -dx; cross = Math.abs(dy); }
    else if (dir === 'right') { if (dx < 2) continue; main = dx; cross = Math.abs(dy); }
    else if (dir === 'up') { if (dy > -2) continue; main = -dy; cross = Math.abs(dx); }
    else { if (dy < 2) continue; main = dy; cross = Math.abs(dx); }
    const sc = main + cross * 2.2;
    if (sc < bs) { bs = sc; best = el; }
  }
  if (best) focus(best);
}

/* 返回：抽屉 → 关抽屉；其它由各层登记的 onBack 决定。
   会话里「返回」永远结束不了通话 —— 结束要走到「结束」上再按确定，老人按错键不会把人挂掉。 */
function back(): void {
  const l = layer();
  if (!l) return;
  backHandlers.get(l.id)?.();
}

export const K = (k: string, t: string): string => `<span><kbd>${k}</kbd>${t}</span>`;

/** 屏幕底部那一行按键提示。遥控器用户没法「试着点点看」，得告诉他每个键现在干什么。 */
export function hint(): void {
  const l = layer();
  const a = document.activeElement;
  const h = l ? (hintProviders.get(l.id)?.(a) ?? '') : '';
  $('keyhint').innerHTML = h;
}

export function init(): void {
  document.addEventListener('keydown', (e) => {
    document.body.classList.add('keys');
    document.body.classList.remove('touch');
    const k = keyOf(e);
    const a = document.activeElement as HTMLElement | null;
    const inInput = a?.tagName === 'INPUT';
    if (inInput) {
      if (k === 'Enter') { e.preventDefault(); a!.dispatchEvent(new CustomEvent('navsubmit')); return; }
      if (k === 'Escape') { e.preventDefault(); back(); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); move(DIR[k]!); }
      return;
    }
    for (const h of hotkeys) {
      if (h(k)) { e.preventDefault(); return; }
    }
    const dir = DIR[k];
    const ok = OK.has(k);
    const bk = BACK.has(k);
    if (!(dir || ok || bk)) return;
    e.preventDefault();
    const act: NavAction = dir ?? (ok ? 'ok' : 'back');
    const bound = a ? keyHandlers.get(a) : undefined;
    if (bound && bound(act)) { hint(); return; }
    if (dir) move(dir);
    else if (ok) {
      if (a && a !== document.body && a.hasAttribute('data-nav')) a.click();
      else first();
    } else back();
  });
  document.addEventListener('pointerdown', () => {
    document.body.classList.remove('keys');
    document.body.classList.add('touch');
  }, true);
  document.addEventListener('focusin', () => hint());
}
