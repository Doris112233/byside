import assert from 'node:assert/strict';
import test from 'node:test';
import { Presence } from '../src/presence.ts';
import { Rooms } from '../src/rooms.ts';
import { Router } from '../src/router.ts';
import { fakeConn, types } from './fake.ts';

function setup(agora = { appId: '', cert: '' }) {
  const rooms = new Rooms();
  const presence = new Presence();
  const router = new Router({ rooms, presence, agora });
  const connect = (code: string, kind: 'web' | 'board' = 'web') => {
    const c = fakeConn(code, kind, code.toLowerCase());
    presence.add(c);
    rooms.enter(c, 'u:' + code);
    return c;
  };
  return { rooms, presence, router, connect };
}

test('点名消息按好友码投给对方的网页，不投板子，服务端填 from 和 name', () => {
  const { router, connect } = setup();
  const a = connect('AAAAAA');
  const b = connect('BBBBBB');
  const bBoard = connect('BBBBBB', 'board');
  router.handle(a, JSON.stringify({ t: 'invite', to: 'bbbbbb', game: 'gomoku', room: 's-1' }));
  const inv = b.out.find((m) => m.t === 'invite');
  assert.equal(inv?.from, 'AAAAAA');
  assert.equal(inv?.name, 'aaaaaa');
  assert.ok(!types(bBoard).includes('invite'));
});

test('对方不在线回 _undelivered', () => {
  const { router, connect } = setup();
  const a = connect('AAAAAA');
  router.handle(a, JSON.stringify({ t: 'invite', to: 'CCCCCC', game: 'gomoku', room: 's-1' }));
  const u = a.out.find((m) => m.t === '_undelivered');
  assert.equal(u?.to, 'CCCCCC');
  assert.equal(u?.of, 'invite');
});

test('join all 把这个人的板子一起搬进会话房间；房间消息被打上服务端的 seat', () => {
  const { router, connect, rooms } = setup();
  const a = connect('AAAAAA');
  const aBoard = connect('AAAAAA', 'board');
  const b = connect('BBBBBB');
  router.handle(a, JSON.stringify({ t: 'join', room: 's-9', all: true }));
  router.handle(b, JSON.stringify({ t: 'join', room: 's-9' }));
  assert.equal(aBoard.room?.name, 's-9');
  assert.equal(rooms.get('s-9').clients.size, 3);
  router.handle(aBoard, JSON.stringify({ t: 'move', i: 3, j: 4, c: 1, seat: '伪造' }));
  const mv = b.out.find((m) => m.t === 'move');
  assert.equal(mv?.seat, 'AAAAAA#board');
  assert.equal(mv?.seq, 1);
});

test('快通路不编号；坏 JSON 和字段不对的消息被丢掉', () => {
  const { router, connect } = setup();
  const a = connect('AAAAAA');
  const b = connect('BBBBBB');
  router.handle(a, JSON.stringify({ t: 'join', room: 's-2' }));
  router.handle(b, JSON.stringify({ t: 'join', room: 's-2' }));
  router.handle(a, JSON.stringify({ t: 'icon', k: 'heart' }));
  const ic = b.out.find((m) => m.t === 'icon');
  assert.ok(ic);
  assert.equal(ic.seq, undefined);
  const before = b.out.length;
  router.handle(a, '{not json');
  router.handle(a, JSON.stringify({ t: 'move', i: 'x', j: 0, c: 1 }));
  router.handle(a, JSON.stringify({ t: 'move', i: 1, j: 0, c: 7 }));
  router.handle(a, JSON.stringify(['t']));
  assert.equal(b.out.length, before);
});

test('rtctoken 只签给在该会话房间里的人', () => {
  const { router, connect } = setup({ appId: 'ed991ae46d4a404ca2d5347633e3916c', cert: '0'.repeat(32) });
  const a = connect('AAAAAA');
  router.handle(a, JSON.stringify({ t: 'rtctoken', channel: 's-7' }));
  assert.equal(a.out.at(-1)?.error, 'not-in-room');
  router.handle(a, JSON.stringify({ t: 'join', room: 's-7' }));
  router.handle(a, JSON.stringify({ t: 'rtctoken', channel: 's-7' }));
  const tok = a.out.at(-1);
  assert.equal(tok?.t, 'rtctoken');
  assert.match(String(tok?.token), /^007/);
});

test('busy 和 who：订阅的人能看到在线、忙碌、桌子', () => {
  const { router, connect, presence } = setup();
  const a = connect('AAAAAA');
  const b = connect('BBBBBB');
  router.handle(a, JSON.stringify({ t: 'who', codes: ['BBBBBB'] }));
  let p = a.out.filter((m) => m.t === 'presence').at(-1);
  assert.equal(p?.online, true);
  assert.equal(p?.desk, false);
  router.handle(b, JSON.stringify({ t: 'busy', on: true }));
  p = a.out.filter((m) => m.t === 'presence').at(-1);
  assert.equal(p?.busy, true);
  presence.remove(b);
  p = a.out.filter((m) => m.t === 'presence').at(-1);
  assert.equal(p?.online, false);
});
