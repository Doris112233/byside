/* 邀请。点名投递、不重放、45 秒没人接就算了；对方按了「好呀」在开摄像头时放宽到 120 秒。 */
import { $, icon, soon } from '../dom';
import { ensureFriend, friendName } from '../identity';
import { on } from '../net/dispatch';
import { send as relaySend } from '../net/relay';
import { TIMEOUTS } from '../protocol/constants';
import type { AcceptMsg, AnyMessage, InviteMsg, RejectMsg, UndeliveredMsg } from '../protocol/messages';
import { state } from '../state';
import * as rtc from '../rtc';
import { get as getScene, all as allScenes } from '../scenes/registry';
import { renderHome } from '../ui/home';
import { avatarSVG } from '../ui/avatar';
import * as chime from '../ui/chime';
import * as nav from '../ui/nav';
import { show } from '../ui/screens';
import { toast } from '../ui/toast';
import * as session from './session';

let timer: ReturnType<typeof setTimeout> | null = null;

type Button = [label: string, cls: string, fn: () => void];
function screen(title: string, sub: string, buttons: Button[]): void {
  const inv = state.inv!;
  const scene = getScene(inv.game) ?? allScenes()[0]!;
  $('i-av').innerHTML = avatarSVG(inv.peer);
  $('i-gicon').innerHTML = `<use href="${scene.icon}"/>`;
  $('i-title').firstChild!.textContent = title;
  $('i-sub').textContent = sub;
  const row = $('i-row');
  row.innerHTML = '';
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.setAttribute('data-nav', '');
    b.onclick = fn;
    row.appendChild(b);
  }
  show('s-invite');
  soon(() => nav.first());
}
function arm(ms: number, fn: () => void): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(fn, ms);
}
function clear(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  chime.stop();
  state.inv = null;
}
function home(): void {
  clear();
  show('s-home');
  renderHome();
  soon(() => nav.first());
}

export function send(code: string, game: string): void {
  const room = 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.inv = { dir: 'out', peer: code, game, room };
  relaySend({ t: 'invite', to: code, game, room });
  const verb = getScene(game)?.verb ?? '一起玩';
  screen('正在请 ' + friendName(code), verb + '，等 TA 点头', [['不等了', 'ghost', cancel]]);
  arm(TIMEOUTS.invite_s * 1000, () => {
    if (state.inv?.dir === 'out') {
      relaySend({ t: 'cancel', to: code });
      toast(friendName(code) + ' 暂时没回应，一会儿再试试');
      home();
    }
  });
}
function cancel(): void {
  if (state.inv?.dir === 'out') relaySend({ t: 'cancel', to: state.inv.peer });
  home();
}

function incoming(m: InviteMsg): void {
  if (state.session || state.inv) {
    relaySend({ t: 'reject', to: m.from, busy: true });
    return;
  }
  ensureFriend(m.from, m.name ?? '');
  const game = getScene(m.game) ? m.game : allScenes()[0]!.id;
  state.inv = { dir: 'in', peer: m.from, game, room: m.room };
  const who = m.name || friendName(m.from);
  screen(who + ' 请你' + getScene(game)!.verb, '要一起吗？', [['好呀', '', accept], ['下次吧', 'ghost', decline]]);
  chime.start();
  try { navigator.vibrate?.([300, 200, 300]); } catch { /* 不支持就算了 */ }
  arm(TIMEOUTS.invite_s * 1000, () => { if (state.inv?.dir === 'in') home(); });
}

async function accept(): Promise<void> {
  if (!state.inv) return;
  const { peer, game, room } = state.inv;
  chime.stop();
  if (timer) clearTimeout(timer);
  relaySend({ t: 'accepting', to: peer }); // 对方别倒计时了，我在开摄像头（第一次要等浏览器弹权限）
  $('i-sub').textContent = '正在打开摄像头…';
  await rtc.prepare(); // 先拿好摄像头麦克风，再告诉对方 —— 不然对方的 offer 会先到
  if (!state.inv || state.inv.room !== room) { void rtc.close(); return; } // 等权限的工夫对方取消了
  relaySend({ t: 'accept', to: peer, room });
  clear();
  session.start(room, peer, game, 2);
}
function accepting(m: AnyMessage): void {
  if (!state.inv || state.inv.dir !== 'out' || m.from !== state.inv.peer) return;
  const from = String(m.from);
  $('i-sub').textContent = friendName(from) + ' 点了好呀，正在打开摄像头…';
  arm(TIMEOUTS.accepting_s * 1000, () => {
    if (state.inv?.dir === 'out') {
      relaySend({ t: 'cancel', to: from });
      toast(friendName(from) + ' 那边摄像头一直没开起来');
      home();
    }
  });
}
function decline(): void {
  if (state.inv) relaySend({ t: 'reject', to: state.inv.peer });
  home();
}
async function accepted(m: AcceptMsg): Promise<void> {
  if (!state.inv || state.inv.dir !== 'out' || m.from !== state.inv.peer) return;
  const { peer, game, room } = state.inv;
  clear();
  await rtc.prepare();
  session.start(room, peer, game, 1);
  void rtc.offer(peer);
}
function rejected(m: RejectMsg): void {
  if (!state.inv || state.inv.dir !== 'out' || m.from !== state.inv.peer) return;
  toast(m.busy ? friendName(m.from) + ' 正在陪别人，一会儿再来' : friendName(m.from) + ' 说下次吧');
  home();
}
function cancelled(m: AnyMessage): void {
  if (state.inv?.dir === 'in' && m.from === state.inv.peer) {
    toast(friendName(String(m.from)) + ' 先不等了');
    home();
  }
}
function undelivered(m: UndeliveredMsg): void {
  if (m.of === 'invite' && state.inv?.dir === 'out' && state.inv.peer === m.to) {
    toast(friendName(m.to) + ' 刚好不在了');
    home();
  }
}
function back(): void {
  if (!state.inv) return;
  if (state.inv.dir === 'in') decline();
  else cancel();
}

export function init(): void {
  on('invite', (m) => incoming(m as InviteMsg));
  on('cancel', cancelled);
  on('accept', (m) => void accepted(m as AcceptMsg));
  on('accepting', accepting);
  on('reject', (m) => rejected(m as RejectMsg));
  on('_undelivered', (m) => undelivered(m as UndeliveredMsg));
  nav.setHint('s-invite', () =>
    state.inv?.dir === 'in' ? nav.K('确定', '好呀') + nav.K('返回', '下次吧') : nav.K('返回', '不等了'),
  );
  nav.onBack('s-invite', back);
  // 头像图标的 use 需要一个默认，免得首屏空着
  $('i-gicon').innerHTML = `<use href="${allScenes()[0]?.icon ?? '#ic-go'}"/>`;
  void icon;
}
