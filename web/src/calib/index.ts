/* 标定。识别端（手机标定页「显示标定图」）发 {t:'calib',on,code} 过来，或者键盘按 C。
   没在会话里时借会话页的版式把棋盘摆出来 —— 棋盘在屏幕上的位置和真下棋时一模一样，标定才算数。
   关掉就回家。只响应自己板子发的（code 等于自己的好友码），对方标定别把我的屏幕也切过去。 */
import { $, soon } from '../dom';
import { on } from '../net/dispatch';
import type { CalibMsg } from '../protocol/messages';
import { state } from '../state';
import { all, get } from '../scenes/registry';
import { focusScene } from '../call/session';
import { renderHome } from '../ui/home';
import * as nav from '../ui/nav';
import { show } from '../ui/screens';
import { toast } from '../ui/toast';

const BOARD_SCENE = 'gomoku';

export function setCalib(on: boolean): void {
  if (on === state.calib) return;
  state.calib = on;
  const board = get(BOARD_SCENE);
  if (!board) return;
  if (on) {
    if (!state.session) {
      show('s-session');
      $('c-name').textContent = '标定';
      $('c-av').innerHTML = '';
      $('c-time').textContent = '';
      $('novid').textContent = '标定中';
      $('novid').style.display = '';
      for (const s of all()) s.pane.classList.toggle('on', s === board);
    }
    requestAnimationFrame(() => board.redraw?.());
    nav.focus(board.focusTarget());
    toast('标定图已打开：按 C 或在标定页点「开始游戏」关闭', 3600);
  } else if (!state.session) {
    $('novid').textContent = '等对方的桌面…';
    show('s-home');
    renderHome();
    soon(() => nav.first());
  } else {
    board.redraw?.();
    focusScene();
  }
}

export function init(): void {
  on('calib', (m) => {
    const c = m as CalibMsg;
    const mine = c.seat ? c.seat.replace(/#board$/, '') : c.code;
    if (mine && state.me && mine !== state.me.code) return;
    setCalib(!!c.on);
  });
  nav.addHotkey((k) => {
    if (k !== 'c' && k !== 'C') return false;
    if (document.querySelector('.veil.on')) return false;
    setCalib(!state.calib);
    return true;
  });
}
