import assert from 'node:assert/strict';
import test from 'node:test';
import { Rooms } from '../src/rooms.ts';
import { fakeConn, types } from './fake.ts';

test('慢通路编号、转发给其他人、自己不收', () => {
  const rooms = new Rooms();
  const a = fakeConn('AAAAAA');
  const b = fakeConn('BBBBBB');
  rooms.enter(a, 's-1');
  rooms.enter(b, 's-1');
  rooms.record(rooms.get('s-1'), a, { t: 'move', i: 7, j: 7, c: 1 });
  const mv = b.out.find((m) => m.t === 'move');
  assert.equal(mv?.seq, 1);
  assert.equal(a.out.some((m) => m.t === 'move'), false);
});

test('断线带 since 回来只补缺的那段，且 _joined 先到', () => {
  const rooms = new Rooms();
  const a = fakeConn('AAAAAA');
  rooms.enter(a, 's-1');
  const r = rooms.get('s-1');
  for (let k = 0; k < 5; k++) rooms.record(r, a, { t: 'move', i: k, j: 0, c: 1 });
  const b = fakeConn('BBBBBB');
  rooms.enter(b, 's-1', 3);
  assert.equal(b.out[0]?.t, '_joined');
  assert.deepEqual(b.out.filter((m) => m.t === 'move').map((m) => m.seq), [4, 5]);
});

test('state 成为快照并清日志；role 和 game 在 reset 后仍然补发', () => {
  const rooms = new Rooms();
  const a = fakeConn('AAAAAA');
  rooms.enter(a, 's-1');
  const r = rooms.get('s-1');
  rooms.record(r, a, { t: 'role', code: 'AAAAAA', color: 1 });
  rooms.record(r, a, { t: 'game', g: 'gomoku' });
  rooms.record(r, a, { t: 'move', i: 1, j: 1, c: 1 });
  rooms.record(r, a, { t: 'reset' });
  assert.equal(r.log.length, 0);
  const board = fakeConn('AAAAAA', 'board');
  rooms.enter(board, 's-1');
  const got = types(board);
  assert.ok(got.includes('role'), 'role 要补发');
  assert.ok(got.includes('game'), 'game 要补发');
  assert.ok(got.includes('reset'), 'reset 快照要补发');
  assert.ok(!got.includes('move'), 'reset 之前的落子不补');
});

test('空房间十分钟后回收', () => {
  const rooms = new Rooms();
  const a = fakeConn('AAAAAA');
  rooms.enter(a, 's-1');
  rooms.leave(a);
  rooms.gc(Date.now() + 5 * 60 * 1000);
  assert.ok(rooms.rooms.has('s-1'));
  rooms.gc(Date.now() + 11 * 60 * 1000);
  assert.ok(!rooms.rooms.has('s-1'));
});
