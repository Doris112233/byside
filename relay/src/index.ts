/* 咫尺中继：静态服务 + WebSocket。
   HTTP  :8778  给本机用（localhost 本身就是安全上下文，摄像头可用）
   HTTPS :8443  给局域网另一台机器用（非 localhost 必须 HTTPS 才能开摄像头和声网）
   两个监听共用同一套房间和在线状态。放在 Caddy 后面时设 BIND=127.0.0.1。 */
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { loadConfig, type Config } from './config.ts';
import { log } from './log.ts';
import { Presence } from './presence.ts';
import { Rooms } from './rooms.ts';
import { Router } from './router.ts';
import { serveStatic } from './static.ts';
import { WsGateway } from './ws.ts';

export function createRelay(cfg: Config) {
  const rooms = new Rooms();
  const presence = new Presence();
  const router = new Router({ rooms, presence, agora: cfg.agora });
  const gateway = new WsGateway({ rooms, presence, router });
  const serve = serveStatic(cfg.staticDirs);

  const httpSrv = http.createServer(serve);
  httpSrv.on('upgrade', gateway.upgrade);
  const httpsSrv = cfg.tls ? https.createServer(cfg.tls, serve) : null;
  httpsSrv?.on('upgrade', gateway.upgrade);

  const timers: NodeJS.Timeout[] = [];
  function start(): void {
    httpSrv.listen(cfg.httpPort, cfg.bind, () => {
      log('HTTP  监听 ' + cfg.httpPort);
      log(cfg.agora.appId && cfg.agora.cert ? '声网 token 签发已启用（App ID ' + cfg.agora.appId.slice(0, 6) + '…）' : '未配置声网证书 —— 网页将退回原生 WebRTC');
    });
    if (httpsSrv) {
      httpsSrv.listen(cfg.httpsPort, '0.0.0.0', () => {
        log('HTTPS 监听 ' + cfg.httpsPort);
        for (const ip of lanIPs()) log('  另一台电脑打开： https://' + ip + ':' + cfg.httpsPort + '/app/');
      });
    } else {
      log('未找到 key.pem / cert.pem，只启了 HTTP —— 局域网上的另一台机器将无法使用摄像头');
    }
    timers.push(setInterval(() => { gateway.heartbeat(); rooms.gc(); }, 5000));
    // 每分钟一行状态。在 Codespaces 里跑时终端有输出就不算闲置
    timers.push(setInterval(() => log('在线 ' + presence.users.size + ' 人 · ' + gateway.size() + ' 个连接 · ' + rooms.rooms.size + ' 个房间'), 60000));
  }
  function stop(): void {
    for (const t of timers) clearInterval(t);
    httpSrv.close();
    httpsSrv?.close();
  }
  return { start, stop, rooms, presence, router, httpSrv };
}

function lanIPs(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isMain) createRelay(loadConfig()).start();
