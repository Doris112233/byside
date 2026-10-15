/* 开门。
   ?surface=table     投影在桌上（板子上的浏览器用这个）；?surface=hand 恢复手持
   ?name=奶奶         预填名字直接进门 —— 家人帮老人设置时用
   ?user=K7M2QX       用同一个身份在另一台设备上登录（比如桌子 + 奶奶的手机）
   ?add=K7M2QX        打开就加这个人为好友 —— 孩子发给老人的邀请链接
   ?cam=FaceTime      通话用哪只摄像头（名字片段，记住；?cam=off 清掉）
   ?relay= ?desk= ?agora= ?token= ?channel=   见 config.ts */
import './styles/tokens.css';
import './styles/app.css';
import * as calib from './calib';
import * as invite from './call/invite';
import * as session from './call/session';
import { scrubUrl, surfaceIsTable, urlParam } from './config';
import { $, soon } from './dom';
import { cleanCode, ensureFriend, newCode } from './identity';
import { connect, send } from './net/relay';
import * as overlay from './overlay';
import * as rtc from './rtc';
import { registerScenes } from './scenes';
import { state, store } from './state';
import * as addFriend from './ui/addFriend';
import * as gamePick from './ui/gamePick';
import * as home from './ui/home';
import * as nav from './ui/nav';
import { show } from './ui/screens';
import * as sheets from './ui/sheets';
import { toast } from './ui/toast';

function enter(): void {
  home.enterHome();
  connect();
  show('s-home');
  soon(() => nav.first());
  let add = '';
  try {
    add = sessionStorage.getItem('byside.pendingAdd') ?? '';
    sessionStorage.removeItem('byside.pendingAdd');
  } catch { /* 没有 sessionStorage 也没关系 */ }
  if (add && add !== state.me?.code && ensureFriend(add, '')) {
    toast('已加上好友，TA 在线的话灯会亮');
    setTimeout(() => send({ t: 'friend', to: add }), 800);
  }
}

function setup(): void {
  const doStart = (): void => {
    const name = $<HTMLInputElement>('nm').value.trim();
    if (!name) {
      toast('先告诉我你叫什么');
      nav.first('#nm');
      return;
    }
    const prev = store.me;
    state.me = { code: prev?.code ?? newCode(), name };
    store.me = state.me;
    enter();
  };
  $('b-start').onclick = doStart;
  $('nm').addEventListener('navsubmit', doStart);
  nav.setHint('s-setup', () => nav.K('确定', '开始'));
}

function boot(): void {
  const table = surfaceIsTable();
  document.body.classList.toggle('table', table);
  if (table) document.body.classList.add('keys');

  registerScenes();
  nav.init();
  sheets.init();
  setup();
  home.init();
  addFriend.init();
  gamePick.init();
  invite.init();
  session.init();
  overlay.init();
  calib.init();
  rtc.init();

  let me = store.me;
  const pu = cleanCode(urlParam('user'));
  const pname = urlParam('name');
  if (pu.length === 6) me = { code: pu, name: pname || me?.name || '' };
  else if (pname) me = { code: me?.code ?? newCode(), name: pname };
  const pendingAdd = cleanCode(urlParam('add'));
  if (pendingAdd) { try { sessionStorage.setItem('byside.pendingAdd', pendingAdd); } catch { /* 忽略 */ } }
  scrubUrl();

  if (me?.name) {
    state.me = me;
    store.me = me;
    enter();
  } else {
    show('s-setup');
    soon(() => nav.first('#nm'));
  }
}

boot();
