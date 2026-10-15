/* 配置的唯一来源：URL 参数 → localStorage → <meta>。
   带 ?x=值 打开一次就记住；?x=off 清掉记住的值。 */
import { PORTS } from './protocol/constants';

const params = new URLSearchParams(location.search);

function ls(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function setting(param: string, key: string, metaName?: string): string {
  const v = params.get(param);
  const s = ls();
  if (v === 'off') s?.removeItem(key);
  else if (v) s?.setItem(key, v);
  let out = s?.getItem(key) ?? '';
  if (!out && v !== 'off' && metaName) {
    out = document.querySelector<HTMLMetaElement>(`meta[name="${metaName}"]`)?.content ?? '';
  }
  return out.trim();
}

/** 这些参数读过一次就从地址栏抹掉，免得刷新时又带着身份、又被分享出去 */
export const SCRUB_PARAMS = ['surface', 'name', 'user', 'add', 'agora', 'token', 'channel', 'relay', 'cam', 'desk'];
export function scrubUrl(): void {
  if ([...params.keys()].some((k) => SCRUB_PARAMS.includes(k))) history.replaceState(null, '', location.pathname);
}

export const urlParam = (k: string): string => params.get(k) ?? '';

/** 投影在桌上（?surface=table，记住）还是拿在手里 */
export function surfaceIsTable(): boolean {
  const sf = params.get('surface');
  const s = ls();
  if (sf) {
    if (sf === 'table') s?.setItem('byside.surface', 'table');
    else s?.removeItem('byside.surface');
  }
  return s?.getItem('byside.surface') === 'table';
}

/** 中继地址。留空 = 和网页同一台机器 */
export function relayBase(): string {
  const r = setting('relay', 'byside.relay', 'relay');
  if (r) return r.replace(/^http/, 'ws').replace(/\/?$/, '').replace(/(\/ws)?$/, '/ws');
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

export const agoraCfg = {
  appId: setting('agora', 'byside.agora', 'agora-app-id'),
  token: setting('token', 'byside.agoraToken', 'agora-token'),
  channel: setting('channel', 'byside.agoraChannel', 'agora-channel'),
};

/** 通话用哪只摄像头：名字片段 */
export const camPref = setting('cam', 'byside.cam');

/** 本机识别端的控制页地址，通话画面从它的 MJPEG 流拿 */
export const deskUrl = (setting('desk', 'byside.desk') || `http://localhost:${PORTS.sensor_control}`).replace(/\/$/, '');

export const AGORA_SDK_URL = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.24.8.js';
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];
