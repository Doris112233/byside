/* 叠在对方画面上：互动表情（两边同步飘一下）+ 左下角「在玩什么」小标。
   表情走中继的快通路 —— 丢了就丢了、不进日志，断线重连不会补出一串心来。
   小标两边各自从当前场景的 badge() 推，不用传。 */
import { $, esc, icon } from '../dom';
import { on } from '../net/dispatch';
import { send } from '../net/relay';
import type { IconMsg } from '../protocol/messages';
import { state } from '../state';
import { get } from '../scenes/registry';
import * as nav from '../ui/nav';
import * as sheets from '../ui/sheets';

const REACTS: Record<string, { name: string; icon: string }> = {
  heart: { name: '爱心', icon: '#rx-heart' },
  thumb: { name: '赞', icon: '#rx-thumb' },
  laugh: { name: '哈哈', icon: '#rx-laugh' },
  party: { name: '太棒了', icon: '#rx-party' },
  tea: { name: '喝口茶', icon: '#ic-tea' },
};
const MAX = 12;
const SHEET = 'sh-react';

export function fx(k: string): void {
  const r = REACTS[k];
  if (!r) return;
  const ov = $('ov');
  while (ov.querySelectorAll('.fx').length >= MAX) ov.querySelector('.fx')?.remove();
  const d = document.createElement('div');
  d.className = 'fx';
  d.style.left = 15 + Math.random() * 70 + '%';
  d.innerHTML = icon(r.icon);
  ov.appendChild(d);
  setTimeout(() => d.remove(), 1900);
}

export function react(k: string): void {
  if (!state.session) return;
  fx(k);
  send({ t: 'icon', k });
}

export function clear(): void {
  $('ov').querySelectorAll('.fx').forEach((e) => e.remove());
}

export function badge(): void {
  const b = $('badge');
  const scene = state.session ? get(state.scene) : undefined;
  if (!scene) {
    b.innerHTML = '';
    b.classList.remove('hot');
    return;
  }
  const info = scene.badge();
  b.classList.toggle('hot', info.hot);
  b.innerHTML = `${icon(info.icon)}<span>${esc(info.text)}</span>`;
}

export function init(): void {
  const items = Object.entries(REACTS);
  const bar = $('react');
  bar.innerHTML = items.map(([k, r]) => `<button data-k="${k}" aria-label="${r.name}" title="${r.name}">${icon(r.icon)}</button>`).join('');
  bar.querySelectorAll<HTMLElement>('button').forEach((b) => { b.onclick = () => react(b.dataset.k ?? ''); });
  const list = $('r-list');
  list.innerHTML = items.map(([k, r]) => `<button class="gcard" data-nav data-k="${k}" aria-label="${r.name}">${icon(r.icon)}<b>${r.name}</b></button>`).join('');
  list.querySelectorAll<HTMLElement>('.gcard').forEach((b) => {
    b.onclick = () => { react(b.dataset.k ?? ''); sheets.close(SHEET); };
  });
  $('d-react').onclick = () => sheets.open(SHEET);
  on('icon', (m) => { if (state.session) fx((m as IconMsg).k); });
  nav.setHint(SHEET, () => nav.K('◀▶', '选表情') + nav.K('确定', '发过去') + nav.K('返回', '算了'));
  nav.onBack(SHEET, () => sheets.close(SHEET));
}
