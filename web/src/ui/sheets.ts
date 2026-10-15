/* 底部抽屉：选游戏 / 表情 / 加好友。开着的抽屉是焦点导航的当前层。 */
import { $, soon } from '../dom';
import { first, hint } from './nav';

let back: Element | null = null;

export function open(id: string, firstSel?: string): void {
  back = document.activeElement;
  $(id).classList.add('on');
  soon(() => first(firstSel));
}

export function close(id: string): void {
  $(id).classList.remove('on');
  const b = back as HTMLElement | null;
  back = null;
  soon(() => {
    if (b && b.offsetParent) b.focus();
    else first();
    hint();
  });
}

export function closeAll(): void {
  document.querySelectorAll('.veil.on').forEach((v) => v.classList.remove('on'));
}

export function topSheet(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('.veil.on')].pop() ?? null;
}

export function init(): void {
  document.querySelectorAll<HTMLElement>('.veil').forEach((v) =>
    v.addEventListener('pointerdown', (e) => {
      if (e.target === v) close(v.id);
    }),
  );
}
