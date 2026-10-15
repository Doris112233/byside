/* 会话：对方在桌子远端的窗口里，游戏在中间，菜单在手边。
   场景（下棋、折纸、聊天）从 registry 来：dock 按钮、数字快捷键、切换、提示都按注册表生成，
   加一个场景不用改这里。 */
import { $, icon, isTable, soon } from '../dom';
import { friendName } from '../identity';
import { on } from '../net/dispatch';
import { join, send } from '../net/relay';
import type { GameMsg } from '../protocol/messages';
import { me, state } from '../state';
import * as rtc from '../rtc';
import { all, get, mountAll, type SceneCtx } from '../scenes/registry';
import * as overlay from '../overlay';
import { avatarSVG } from '../ui/avatar';
import { renderHome } from '../ui/home';
import * as nav from '../ui/nav';
import { show } from '../ui/screens';
import { toast } from '../ui/toast';

let tickT: ReturnType<typeof setTimeout> | null = null;

const ctx: SceneCtx = {
  send,
  me: () => me().code,
  peer: () => state.session?.peer ?? '',
  peerName: () => (state.session ? friendName(state.session.peer) : ''),
  color: () => state.session?.color ?? 1,
  table: isTable,
  hint: nav.hint,
  badge: overlay.badge,
  inSession: () => !!state.session,
};

export function start(room: string, peer: string, game: string, color: 1 | 2): void {
  state.session = { room, peer, color, startedAt: Date.now() };
  join(room);
  send({ t: 'busy', on: true });
  $('c-av').innerHTML = avatarSVG(peer);
  $('c-name').textContent = friendName(peer);
  $('novid').style.display = '';
  for (const s of all()) s.start();
  show('s-session');
  setScene(game, color === 1); // 发起方把「玩什么」写进房间，两边的板子都会收到
  /* 告诉自己桌上的板子：这一局我执什么色。板子只认这一色 ——
     「每端只认自己那一色」是防投影污染的第二道闸，颜色按局分配（发起方执黑），所以每局告诉它一次。 */
  send({ t: 'role', code: me().code, color });
  void rtc.connected();
  tick();
}

function tick(): void {
  if (tickT) clearTimeout(tickT);
  if (!state.session) return;
  const s = Math.floor((Date.now() - state.session.startedAt) / 1000);
  $('c-time').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  tickT = setTimeout(tick, 1000);
}

export function setScene(id: string, broadcast: boolean): void {
  const scene = get(id) ?? all()[0]!;
  state.scene = scene.id;
  for (const s of all()) s.pane.classList.toggle('on', s === scene);
  $('dock').querySelectorAll<HTMLElement>('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === scene.id));
  scene.show();
  overlay.badge();
  if (broadcast) send({ t: 'game', g: scene.id });
  soon(focusScene);
}

export function focusScene(): void {
  const scene = state.scene ? get(state.scene) : null;
  nav.focus(scene?.focusTarget() ?? $('dock').querySelector(`[data-scene="${state.scene}"]`));
}
export function focusDock(): void {
  nav.focus($('dock').querySelector(`[data-scene="${state.scene}"]`) ?? $('d-end'));
}

export function end(notify: boolean): void {
  if (!state.session) return;
  if (notify) send({ t: 'hangup', to: state.session.peer });
  void rtc.close();
  send({ t: 'busy', on: false });
  join('u:' + me().code);
  state.session = null;
  state.scene = null;
  if (tickT) clearTimeout(tickT);
  for (const s of all()) s.stop();
  overlay.badge();
  overlay.clear();
  show('s-home');
  renderHome();
  soon(() => nav.first());
}

function buildDock(): void {
  const dock = $('dock');
  dock.innerHTML =
    all().map((s) => `<button data-nav data-scene="${s.id}"><span class="ico">${icon(s.icon)}</span>${s.name}</button>`).join('') +
    `<button data-nav id="d-react"><span class="ico">${icon('#ic-smile')}</span>表情</button>` +
    `<button data-nav class="end" id="d-end"><span class="ico">${icon('#ic-bye')}</span>结束</button>`;
  dock.querySelectorAll<HTMLElement>('[data-scene]').forEach((b) => {
    b.onclick = () => setScene(b.dataset.scene ?? '', true);
  });
  $('d-end').onclick = () => end(true);
}

export function init(): void {
  mountAll($('mid'), ctx);
  buildDock();
  on('game', (m) => { if (state.session) setScene((m as GameMsg).g, false); });
  on('hangup', (m) => {
    if (state.session && m.from === state.session.peer) {
      end(false);
      toast(friendName(String(m.from)) + ' 先走了，下次再坐');
    }
  });
  // 数字键直接切场景：1 下棋 2 折纸 3 聊天……按注册顺序
  nav.addHotkey((k) => {
    if (!state.session || !/^[1-9]$/.test(k)) return false;
    const s = all()[Number(k) - 1];
    if (!s) return false;
    setScene(s.id, true);
    return true;
  });
  nav.setHint('s-session', (active) => {
    const scene = state.scene ? get(state.scene) : null;
    const own = scene?.hint(active);
    if (own) return own;
    if (active && $('dock').contains(active)) return nav.K('◀▶', '选') + nav.K('确定', '换这个') + nav.K('返回', '回到桌上');
    return nav.K('方向键', '选') + nav.K('确定', '按下') + nav.K('返回', '菜单');
  });
  // 会话里「返回」在游戏和菜单之间来回，永远结束不了通话
  nav.onBack('s-session', () => {
    const inDock = $('dock').contains(document.activeElement);
    if (inDock) focusScene();
    else focusDock();
  });
}
