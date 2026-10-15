import { $, soon } from '../dom';
import { hint } from './nav';

export type ScreenId = 's-setup' | 's-home' | 's-invite' | 's-session';

export function show(id: ScreenId): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $(id).classList.add('on');
  soon(hint);
}

export function curScreen(): string {
  return document.querySelector('.screen.on')?.id ?? '';
}
