/* 声网 Web SDK。跨城对称 NAT、回声消除、自适应码率由它兜。
   项目开了 App 证书：token 问中继要，中继只给确实在这个会话里的人签，证书从头到尾不出服务器。 */
import { AGORA_SDK_URL, agoraCfg } from '../config';
import { $ } from '../dom';
import { ask, badge, send } from '../net/relay';
import { state } from '../state';
import { toast } from '../ui/toast';
import { deskTrack, pickCam, releaseDesk } from './camera';
import type { RtcImpl } from './types';

/* 声网 SDK 从 CDN 动态加载，这里只声明用到的那一点点 */
interface AgoraTrack { stop(): void; close(): void; play(el: HTMLElement | string, opts?: Record<string, unknown>): void }
interface AgoraRemoteUser { videoTrack?: AgoraTrack; audioTrack?: AgoraTrack }
interface AgoraClient {
  on(ev: string, fn: (...a: never[]) => void): void;
  join(appId: string, channel: string, token: string | null, uid: number | null): Promise<unknown>;
  publish(tracks: AgoraTrack[]): Promise<void>;
  subscribe(user: AgoraRemoteUser, type: 'audio' | 'video'): Promise<unknown>;
  renewToken(token: string): Promise<void>;
  leave(): Promise<void>;
}
interface AgoraSDK {
  createClient(cfg: { mode: string; codec: string }): AgoraClient;
  createMicrophoneAudioTrack(cfg: Record<string, unknown>): Promise<AgoraTrack>;
  createCameraVideoTrack(cfg: Record<string, unknown>): Promise<AgoraTrack>;
  createCustomVideoTrack(cfg: { mediaStreamTrack: MediaStreamTrack }): AgoraTrack;
  getCameras(): Promise<Array<{ deviceId: string; label: string }>>;
}
declare global {
  interface Window { AgoraRTC?: AgoraSDK }
}

let client: AgoraClient | null = null;
let mic: AgoraTrack | null = null;
let cam: AgoraTrack | null = null;
let joined = false;
let onFail: () => void = () => {};

const sdk = (): AgoraSDK => {
  if (!window.AgoraRTC) throw new Error('声网 SDK 没加载');
  return window.AgoraRTC;
};

/** 声网有 App ID 才启用。加载好了返回 true。 */
export function loadAgora(onReady: () => void, onError: () => void): boolean {
  if (!agoraCfg.appId) return false;
  const sc = document.createElement('script');
  sc.src = AGORA_SDK_URL;
  sc.onload = onReady;
  sc.onerror = onError;
  document.head.appendChild(sc);
  return true;
}

/** join 失败时要做什么（退回原生），由门面注入 */
export function setFailHandler(fn: () => void): void {
  onFail = fn;
}

async function prepare(): Promise<void> {
  if (mic || cam) return;
  const A = sdk();
  const dt = await deskTrack();
  if (dt) {
    try { cam = A.createCustomVideoTrack({ mediaStreamTrack: dt }); } catch (e) { console.warn('[rtc] 自定义视频轨失败', e); }
    try { mic = await A.createMicrophoneAudioTrack({ AEC: true, ANS: true }); } catch { toast('没拿到麦克风，只传桌面画面', 3200); }
  } else {
    try {
      let cams: Array<{ deviceId: string; label: string }> = [];
      try { cams = await A.getCameras(); } catch { /* 列不出来就用默认 */ }
      const want = pickCam(cams);
      if (want) console.log('[rtc] 通话摄像头：' + want.label);
      [mic, cam] = await Promise.all([
        A.createMicrophoneAudioTrack({ AEC: true, ANS: true }),
        A.createCameraVideoTrack(want ? { cameraId: want.deviceId } : {}),
      ]);
    } catch {
      try { mic = await A.createMicrophoneAudioTrack({ AEC: true, ANS: true }); } catch { /* 连麦克风也没有 */ }
      if (!mic && !cam) toast('没拿到摄像头/麦克风，先不带画面一起坐会儿', 3600);
    }
  }
  if (cam) {
    $('v-me').style.display = 'none';
    cam.play($('self'), { mirror: false, fit: 'cover' });
  }
}

async function connected(): Promise<void> {
  if (joined || !state.session) return;
  const A = sdk();
  client = A.createClient({ mode: 'rtc', codec: 'vp8' });
  const cl = client;
  cl.on('user-published', (async (user: AgoraRemoteUser, type: 'audio' | 'video') => {
    await cl.subscribe(user, type);
    if (type === 'video' && user.videoTrack) {
      $('v-remote').style.display = 'none';
      user.videoTrack.play($('remote'), { fit: 'cover' });
      $('novid').style.display = 'none';
    }
    if (type === 'audio') user.audioTrack?.play('');
  }) as never);
  cl.on('connection-state-change', ((cur: string) => { if (cur === 'RECONNECTING') toast('画面断了，正在重连…'); }) as never);
  /* 频道默认 = 会话房间号，一局一个频道。手动配了 token（控制台临时 token）就用手配的。 */
  const channel = agoraCfg.channel || state.session.room;
  let token: string | null = agoraCfg.token || null;
  if (!token) {
    const r = await ask({ t: 'rtctoken', channel });
    if (r && typeof r.token === 'string') token = r.token;
    else console.warn('[rtc] 没领到 token：', r?.error ?? '超时', '—— 试试不带 token（测试模式项目能进）');
  }
  cl.on('token-privilege-will-expire', (async () => {
    if (agoraCfg.token) return;
    const r = await ask({ t: 'rtctoken', channel });
    if (r && typeof r.token === 'string') {
      try { await cl.renewToken(r.token); console.log('[rtc] token 已续'); } catch (e) { console.warn('[rtc] 续 token 失败', e); }
    }
  }) as never);
  try {
    await cl.join(agoraCfg.appId, channel, token, null);
    joined = true;
    const tracks = [mic, cam].filter((t): t is AgoraTrack => !!t);
    if (tracks.length) await cl.publish(tracks);
    console.log('[rtc] 声网已接通 频道 ' + channel + (token ? '（带 token）' : '（无 token）'));
    badge();
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const msg = String(err?.message ?? e);
    const code = err?.code ? String(err.code) : '';
    toast(msg.includes('dynamic use static key') ? '声网项目开了安全模式，需要 token。先用原生画面。' : '声网连不上（' + (code || msg.slice(0, 40)) + '），先用原生画面', 5000);
    console.error('[rtc] join 失败 code=' + code + ' msg=' + msg, e);
    if (!state.session) return; // 通话已经结束了，join 被 leave 打断不算失败
    send({ t: 'rtc', to: state.session.peer, fallback: 1 }); // 告诉对方：我退原生了，你也退
    onFail();
  }
}

async function close(): Promise<void> {
  try { if (client && joined) await client.leave(); } catch { /* 已离开 */ }
  joined = false;
  client = null;
  for (const t of [mic, cam]) if (t) { try { t.stop(); t.close(); } catch { /* 已停 */ } }
  mic = cam = null;
  releaseDesk();
  document.querySelectorAll('#remote>div[id^="agora-video"],#self>div[id^="agora-video"]').forEach((el) => el.remove());
  $('v-remote').style.display = '';
  $('v-me').style.display = '';
}

export const agora: RtcImpl = { name: 'agora', prepare, offer: async () => {}, onSignal: async () => {}, connected, close };
