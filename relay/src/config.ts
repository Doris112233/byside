/* 中继配置：环境变量 → agora.env → 默认值。常量来自 protocol/constants.json。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import constants from '../../protocol/constants.json' with { type: 'json' };

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FAST: ReadonlySet<string> = new Set(constants.fast);
export const TOKEN_TTL = constants.timeouts.token_ttl_s;
export const ROOM_GC_MS = constants.timeouts.room_gc_s * 1000;
export const LOG_MAX = 500;
export const FRAME_MAX = 1 << 20; // 单条消息上限 1MB
export const CODE_LEN = constants.friend_code.length;

export interface Config {
  httpPort: number;
  httpsPort: number;
  bind: string;
  agora: { appId: string; cert: string };
  tls: { key: Buffer; cert: Buffer } | null;
  staticDirs: { app: string; site: string };
}

function readAgoraEnv(file: string): { appId: string; cert: string } {
  const out = { appId: '', cert: '' };
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(AGORA_APP_ID|AGORA_APP_CERT)\s*=\s*([0-9a-fA-F]{32})\s*$/);
    if (!m) continue;
    if (m[1] === 'AGORA_APP_ID') out.appId = m[2]!;
    else out.cert = m[2]!;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repo: string = REPO): Config {
  const fromFile = readAgoraEnv(env.AGORA_ENV_FILE || path.join(repo, 'agora.env'));
  const agora = {
    appId: env.AGORA_APP_ID || fromFile.appId,
    cert: env.AGORA_APP_CERT || fromFile.cert,
  };
  let tls: Config['tls'] = null;
  try {
    tls = {
      key: fs.readFileSync(env.TLS_KEY || path.join(repo, 'key.pem')),
      cert: fs.readFileSync(env.TLS_CERT || path.join(repo, 'cert.pem')),
    };
  } catch {
    tls = null;
  }
  return {
    httpPort: Number(env.HTTP_PORT || constants.ports.relay_http),
    httpsPort: Number(env.HTTPS_PORT || constants.ports.relay_https),
    bind: env.BIND || '0.0.0.0',
    agora,
    tls,
    staticDirs: {
      app: env.STATIC_APP || path.join(repo, 'web', 'dist'),
      site: env.STATIC_SITE || path.join(repo, 'docs'),
    },
  };
}
