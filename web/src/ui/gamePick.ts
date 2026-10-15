/* 选游戏抽屉：点了某个好友之后，选一起做什么 */
import { $, icon } from '../dom';
import { friendName } from '../identity';
import * as invite from '../call/invite';
import { all } from '../scenes/registry';
import { avatarSVG } from './avatar';
import * as nav from './nav';
import * as sheets from './sheets';

const SHEET = 'sh-game';

export function openGamePick(code: string): void {
  $('g-av').innerHTML = avatarSVG(code);
  $('g-title').textContent = '和 ' + friendName(code) + ' 一起…';
  const list = $('g-list');
  list.innerHTML = all()
    .map((s) => `<button class="gcard" data-nav data-g="${s.id}" aria-label="${s.verb}">${icon(s.icon)}<b>${s.name}</b><span>${s.desc}</span></button>`)
    .join('');
  list.querySelectorAll<HTMLElement>('.gcard').forEach((el) => {
    el.onclick = () => {
      sheets.closeAll();
      invite.send(code, el.dataset.g ?? '');
    };
  });
  sheets.open(SHEET);
}

export function init(): void {
  nav.setHint(SHEET, () => nav.K('◀▶', '选游戏') + nav.K('确定', '发出邀请') + nav.K('返回', '算了'));
  nav.onBack(SHEET, () => sheets.close(SHEET));
}
