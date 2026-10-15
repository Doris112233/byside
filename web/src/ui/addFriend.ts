/* 加好友：屏幕键盘。遥控器没法打字，方向键选字、确定输入；接了键盘或者用手机时直接敲也行。 */
import { $ } from '../dom';
import { ensureFriend } from '../identity';
import { send } from '../net/relay';
import { FRIEND_CODE } from '../protocol/constants';
import { me, store } from '../state';
import * as nav from './nav';
import * as sheets from './sheets';
import { toast } from './toast';

const SHEET = 'sh-add';
const ALPH = FRIEND_CODE.alphabet;
const LEN = FRIEND_CODE.length;
let buf = '';

function render(): void {
  $('a-mine').textContent = me().code;
  $('a-slots').innerHTML = Array.from({ length: LEN }, (_, i) => `<span class="${i === buf.length ? 'cur' : ''}">${buf[i] ?? ''}</span>`).join('');
}

function type(c: string): void {
  if (!ALPH.includes(c)) { toast('码里没有 ' + c + '（0、O、1、I、L 都不用）'); return; }
  if (buf.length < LEN) { buf += c; render(); }
  if (buf.length === LEN) nav.first('[data-k="ok"]');
}
function del(): void {
  buf = buf.slice(0, -1);
  render();
}
function submit(): void {
  if (buf.length < LEN) { toast(`好友码是 ${LEN} 位，还差 ${LEN - buf.length} 位`); return; }
  if (buf === me().code) { toast('这是你自己的码呀'); return; }
  const code = buf;
  if (store.friends.some((f) => f.code === code)) { toast('已经是好友了'); sheets.close(SHEET); return; }
  ensureFriend(code, '');
  send({ t: 'friend', to: code });
  toast('加上了，TA 在线的话灯会亮');
  sheets.close(SHEET);
}

export function openAddFriend(): void {
  buf = '';
  render();
  sheets.open(SHEET, '#a-keys button');
}

export function init(): void {
  const k = $('a-keys');
  k.innerHTML =
    [...ALPH].map((c) => `<button data-nav data-k="${c}">${c}</button>`).join('') +
    `<button data-nav class="wide2" data-k="del" style="grid-column:span 3">删一个</button>` +
    `<button data-nav class="wide2 go" data-k="ok" style="grid-column:span 5">加上</button>`;
  k.querySelectorAll<HTMLElement>('button').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.k ?? '';
      if (v === 'del') del();
      else if (v === 'ok') submit();
      else type(v);
    };
  });
  $('a-link').onclick = async () => {
    const u = location.origin + location.pathname + '?add=' + me().code;
    try {
      await navigator.clipboard.writeText(u);
      toast('链接已复制，发给家人就行');
    } catch {
      toast(u, 6000);
    }
  };
  // 抽屉开着时直接敲字母数字就能输码，Backspace 是删字不是返回
  nav.addHotkey((key) => {
    if (!$(SHEET).classList.contains('on')) return false;
    if (/^[0-9a-zA-Z]$/.test(key)) { type(key.toUpperCase()); return true; }
    if (key === 'Backspace' && buf.length) { del(); return true; }
    return false;
  });
  nav.setHint(SHEET, () => nav.K('方向键', '选字') + nav.K('确定', '输入') + nav.K('返回', '关闭'));
  nav.onBack(SHEET, () => sheets.close(SHEET));
}
