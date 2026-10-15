import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveStatic } from '../src/static.ts';

const dirs = { app: path.resolve('/srv/app'), site: path.resolve('/srv/site') };

test('/ 和 /app/ 分别落到介绍页和构建产物', () => {
  assert.equal(resolveStatic(dirs, '/'), path.join(dirs.site, 'index.html'));
  assert.equal(resolveStatic(dirs, '/app/'), path.join(dirs.app, 'index.html'));
  assert.equal(resolveStatic(dirs, '/app'), path.join(dirs.app, 'index.html'));
  assert.equal(resolveStatic(dirs, '/app/assets/x.js?v=1'), path.join(dirs.app, 'assets', 'x.js'));
  assert.equal(resolveStatic(dirs, '/design/a.html'), path.join(dirs.site, 'design', 'a.html'));
});

test('往上跳的路径出不了两个静态目录；隐藏文件一律拿不到', () => {
  const inside = (f: string | null): boolean => f === null || f.startsWith(dirs.site + path.sep) || f.startsWith(dirs.app + path.sep);
  for (const p of ['/../agora.env', '/app/../../agora.env', '/%2e%2e/key.pem', '/..%2fkey.pem', '/app/../relay/src/index.ts']) {
    assert.ok(inside(resolveStatic(dirs, p)), p);
  }
  for (const p of ['/.git/HEAD', '/app/.env', '/.well-known/x', '/design/.hidden/a.html']) {
    assert.equal(resolveStatic(dirs, p), null, p);
  }
});
