/* 首页：我是谁、桌子连没连、好友都在不在 */
import { $, esc } from '../dom';
import { ensureFriend, friendName, onFriendsChanged } from '../identity';
import { on } from '../net/dispatch';
import type { PresenceMsg } from '../protocol/messages';
import { me, state, store } from '../state';
import { openAddFriend } from './addFriend';
import { openGamePick } from './gamePick';
import { avatarSVG } from './avatar';
import * as nav from './nav';
import { curScreen } from './screens';
import { toast } from './toast';

export function renderHome(): void {
  if (!state.me) return;
  const box = $('friends');
  const active = document.activeElement as HTMLElement | null;
  const had = active && box.contains(active) ? active.dataset.code : null;
  // 在线的排前面：老人一眼就看到谁的灯亮着
  const rank = (code: string): number => {
    const p = state.presence[code];
    return p?.online ? (p.busy ? 1 : 0) : 2;
  };
  const list = [...store.friends].sort((a, b) => rank(a.code) - rank(b.code));
  let h = '';
  if (!list.length) h += `<div class="empty">还没有好友。<br>点「加好友」，或者把你的好友码 <b>${me().code}</b> 念给家人听。</div>`;
  for (const f of list) {
    const p = state.presence[f.code];
    const online = !!p?.online;
    const busy = !!p?.busy;
    const st = online ? (busy ? '正在陪别人' : '在桌边') : '不在';
    h += `<button class="fcard${online ? ' on' : ''}${busy ? ' busy' : ''}" data-nav data-code="${esc(f.code)}" aria-label="${esc(friendName(f.code))}，${st}">
      <span class="avatar">${avatarSVG(f.code)}</span><span class="nm">${esc(friendName(f.code))}</span>
      <span class="st"><i></i>${st}</span></button>`;
  }
  h += `<button class="fcard add" data-nav data-code="+" aria-label="加好友"><span class="plus">+</span><span class="nm" style="font-size:.9rem;font-weight:500">加好友</span></button>`;
  box.innerHTML = h;
  box.querySelectorAll<HTMLElement>('.fcard').forEach((el) => {
    el.onclick = () => {
      const code = el.dataset.code ?? '';
      if (code === '+') { openAddFriend(); return; }
      const p = state.presence[code];
      if (!p?.online) { toast(friendName(code) + ' 现在不在，等灯亮了再叫'); return; }
      if (p.busy) { toast(friendName(code) + ' 正在陪别人，一会儿再来'); return; }
      openGamePick(code);
    };
  });
  if (curScreen() !== 's-home' || document.querySelector('.veil.on')) return;
  const keep = had ? box.querySelector<HTMLElement>(`[data-code="${had}"]`) : null;
  const a = document.activeElement as HTMLElement | null;
  if (keep) keep.focus();
  else if (!a || a === document.body || !a.offsetParent) nav.first();
}

function presence(m: PresenceMsg): void {
  state.presence[m.code] = m;
  if (m.code === me().code) {
    const d = $('h-desk');
    d.classList.toggle('lit', !!m.desk);
    d.querySelector('span')!.textContent = m.desk ? '桌子已连上' : '桌子未连上';
    return;
  }
  if (m.name) ensureFriend(m.code, m.name);
  renderHome();
}

export function init(): void {
  on('presence', (m) => presence(m as PresenceMsg));
  on('friend', (m) => {
    if (ensureFriend(String(m.from ?? ''), String(m.name ?? ''))) toast((m.name || m.from) + ' 加了你为好友');
  });
  onFriendsChanged(renderHome);
  $('h-code').onclick = openAddFriend;
  nav.setHint('s-home', () => nav.K('方向键', '选人') + nav.K('确定', '找 TA 玩'));
}

/** 进门：显示名字和好友码，画好友列表 */
export function enterHome(): void {
  const m = me();
  $('h-me').textContent = m.name;
  $('h-codev').textContent = m.code;
  renderHome();
}
