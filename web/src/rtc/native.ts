/* 原生 WebRTC：信令走中继。局域网和多数家庭宽带能直连；只有 STUN 没有 TURN，跨城对称 NAT 大概率不通。 */
import { STUN_SERVERS } from '../config';
import { $ } from '../dom';
import { send } from '../net/relay';
import type { RtcMsg } from '../protocol/messages';
import { state } from '../state';
import { toast } from '../ui/toast';
import { deskTrack, pickCam, releaseDesk } from './camera';
import type { RtcImpl } from './types';

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
let pc: RTCPeerConnection | null = null;
let local: MediaStream | null = null;

function remoteShown(): void {
  $('novid').style.display = 'none';
}

async function prepare(): Promise<void> {
  if (local) return;
  const dt = await deskTrack();
  if (dt) {
    local = new MediaStream([dt]);
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: AUDIO })).getAudioTracks().forEach((t) => local!.addTrack(t));
    } catch {
      toast('没拿到麦克风，只传桌面画面', 3200);
    }
    $<HTMLVideoElement>('v-me').srcObject = local;
    return;
  }
  try {
    local = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: AUDIO });
    // 拿到权限之后设备才有名字。默认给的不是桌面相机就换成它
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const want = pickCam(cams);
      const cur = local.getVideoTracks()[0];
      if (want && cur && cur.getSettings().deviceId !== want.deviceId) {
        const v = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: want.deviceId }, width: { ideal: 1280 } } });
        cur.stop();
        local.removeTrack(cur);
        local.addTrack(v.getVideoTracks()[0]!);
        console.log('[rtc] 通话摄像头换成：' + want.label);
      }
    } catch { /* 换不了就用默认的 */ }
  } catch {
    /* 板子上常见：唯一的摄像头被桌面识别占着，要不到视频。退一步只要麦克风。 */
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
      toast('摄像头在忙，先只用声音', 3200);
    } catch {
      toast('没拿到摄像头/麦克风，先不带画面一起坐会儿', 3600);
      local = null;
    }
  }
  $<HTMLVideoElement>('v-me').srcObject = local;
}

function make(who: string): RTCPeerConnection {
  pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  if (local) local.getTracks().forEach((tr) => pc!.addTrack(tr, local!));
  else {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }
  pc.ontrack = (e) => {
    $<HTMLVideoElement>('v-remote').srcObject = e.streams[0] ?? null;
    remoteShown();
  };
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: who, ice: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) toast('画面断了，正在重连…');
  };
  return pc;
}

async function offer(who: string): Promise<void> {
  const p = make(who);
  const o = await p.createOffer();
  await p.setLocalDescription(o);
  send({ t: 'rtc', to: who, sdp: p.localDescription?.toJSON() });
}

async function onSignal(m: RtcMsg): Promise<void> {
  if (!state.session || state.session.peer !== m.from) return;
  if (m.sdp) {
    if (m.sdp.type === 'offer') {
      const p = pc ?? make(m.from);
      await p.setRemoteDescription(m.sdp);
      const a = await p.createAnswer();
      await p.setLocalDescription(a);
      send({ t: 'rtc', to: m.from, sdp: p.localDescription?.toJSON() });
    } else if (pc) {
      await pc.setRemoteDescription(m.sdp);
    }
  } else if (m.ice && pc) {
    try { await pc.addIceCandidate(m.ice); } catch { /* 过时的候选，忽略 */ }
  }
}

async function close(): Promise<void> {
  if (pc) { try { pc.close(); } catch { /* 已关 */ } pc = null; }
  if (local) { local.getTracks().forEach((t) => t.stop()); local = null; }
  releaseDesk();
  $<HTMLVideoElement>('v-remote').srcObject = null;
  $<HTMLVideoElement>('v-me').srcObject = null;
}

export const native: RtcImpl = { name: 'native', prepare, offer, onSignal, connected: async () => {}, close };
