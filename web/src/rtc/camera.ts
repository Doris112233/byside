/* 通话传的是桌面，不是人像：现在每端只有一只摄像头，朝下拍桌子（影石）。
   人像视频留作以后第二只摄像头的选项。所以名字像桌面相机的优先；?cam=名字片段 可指定。

   更要紧的是：识别端已经占着这只摄像头，同一只摄像头两个程序开不了。
   识别端在跑时（中继说「桌子已连上」），画面从它的 MJPEG 流拿：
   /stream.mjpg → <img> → canvas → captureStream → 当视频轨发出去。识别端没跑才直接开摄像头。 */
import { camPref, deskUrl } from '../config';
import { TABLE_CAMERA } from '../protocol/constants';
import { me, state } from '../state';

export interface CamInfo { deviceId: string; label: string }

export function pickCam(list: CamInfo[]): CamInfo | null {
  list = list.filter((d) => d && d.deviceId);
  if (!list.length) return null;
  if (camPref) {
    const m = list.find((d) => (d.label || '').toLowerCase().includes(camPref.toLowerCase()));
    if (m) return m;
  }
  return list.find((d) => TABLE_CAMERA.test(d.label || '')) ?? list[0] ?? null;
}

let stopDesk: (() => void) | null = null;

/** 本机识别端在线时，把它的桌面画面做成一条视频轨；拿不到返回 null */
export async function deskTrack(): Promise<MediaStreamTrack | null> {
  const p = state.presence[me().code];
  if (!p?.desk) return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const ok = await new Promise<boolean>((r) => {
    const t = setTimeout(() => r(false), 3000);
    img.onload = () => { clearTimeout(t); r(true); };
    img.onerror = () => { clearTimeout(t); r(false); };
    img.src = deskUrl + '/stream.mjpg?t=' + Date.now();
  });
  if (!ok) {
    console.warn('[rtc] 识别端画面拿不到（' + deskUrl + '），改开摄像头');
    return null;
  }
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 640;
  c.height = img.naturalHeight || 360;
  const cx = c.getContext('2d')!;
  const timer = setInterval(() => { try { cx.drawImage(img, 0, 0, c.width, c.height); } catch { /* 流断了下一帧再试 */ } }, 100);
  const tr = c.captureStream(10).getVideoTracks()[0]!;
  stopDesk = () => { clearInterval(timer); img.src = ''; try { tr.stop(); } catch { /* 已停 */ } stopDesk = null; };
  console.log('[rtc] 桌面画面来自识别端 ' + deskUrl + ' ' + c.width + 'x' + c.height);
  return tr;
}

export function releaseDesk(): void {
  stopDesk?.();
}
