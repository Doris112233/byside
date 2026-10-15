// 中继自带的 AccessToken2 签名必须和声网官方 agora-token 包逐字节一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const { rtcToken } = require('../src/server.js');
const { AccessToken2, ServiceRtc } = require('agora-token/src/AccessToken2.js');

function official(appId, cert, channel, uid, expire, issueTs, salt) {
  const t = new AccessToken2(appId, cert, issueTs, expire);
  t.salt = salt;
  const svc = new ServiceRtc(channel, uid);
  for (const p of [1, 2, 3, 4]) svc.add_privilege(p, expire);
  t.add_service(svc);
  return t.build();
}

const cases = [
  ['970CA35de60c44645bbae8a215061b33', '5CFd2fd1755d40ecb72977518be15d3b', '7d72365eb983485397e3e3f9d460bdda', '', 600, 1111111, 1],
  ['970CA35de60c44645bbae8a215061b33', '5CFd2fd1755d40ecb72977518be15d3b', '7d72365eb983485397e3e3f9d460bdda', '2882341273', 600, 1111111, 1],
  ['ed991ae46d4a404ca2d5347633e3916c', '00000000000000000000000000000000', 's-abc123xyz', '', 7200, 1760000000, 12345678],
];

for (const [app, cert, ch, uid, exp, ts, salt] of cases) {
  test(`token ${ch} uid=${uid || 'wildcard'}`, () => {
    assert.equal(rtcToken(app, cert, ch, uid, exp, ts, salt), official(app, cert, ch, uid, exp, ts, salt));
  });
}
