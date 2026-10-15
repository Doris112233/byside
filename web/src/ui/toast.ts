import { $ } from '../dom';

let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, ms = 2600): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('on'), ms);
}
