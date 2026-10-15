/* 声网 AccessToken2（007）。项目开了 App 证书就必须带 token 才能进频道。证书是密钥，只能在服务器上：
   网页进了会话后问中继要 token，中继确认「你确实在这个会话房间里」才签。
   签名算法照声网官方参考实现逐字移植（AgoraIO/Tools · AccessToken2.js），零依赖，
   tests/token.test.ts 用官方 agora-token 包逐字节比对。 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const le16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const le32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const packBytes = (buf: Buffer): Buffer => Buffer.concat([le16(buf.length), buf]);
const packStr = (s: string | number): Buffer => packBytes(Buffer.from(String(s), 'utf8'));
const hmac = (key: Buffer | string, msg: Buffer): Buffer => crypto.createHmac('sha256', key).update(msg).digest();

/** 发布者 token：进频道 + 发音频 + 发视频 + 发数据流。expire 是从现在起的秒数。uid 空串 = 任意 uid。 */
export function rtcToken(
  appId: string,
  cert: string,
  channel: string,
  uid: string | number,
  expire: number,
  issueTs = Math.floor(Date.now() / 1000),
  salt = Math.floor(Math.random() * 99999999) + 1,
): string {
  const privs = [1, 2, 3, 4]; // join / audio / video / data
  const rtc = Buffer.concat([
    le16(1), // service type = RTC
    le16(privs.length),
    ...privs.flatMap((p) => [le16(p), le32(expire)]),
    packStr(channel),
    packStr(uid ? String(uid) : ''),
  ]);
  const info = Buffer.concat([packStr(appId), le32(issueTs), le32(expire), le32(salt), le16(1), rtc]);
  let signing = hmac(le32(issueTs), Buffer.from(cert)); // 证书按字符串参与，不是解码后的十六进制
  signing = hmac(le32(salt), signing);
  const sig = hmac(signing, info);
  return '007' + zlib.deflateSync(Buffer.concat([packBytes(sig), info])).toString('base64');
}
