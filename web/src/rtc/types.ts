import type { RtcMsg } from '../protocol/messages';

/** 音视频实现对外的五个口子 */
export interface RtcImpl {
  readonly name: 'native' | 'agora';
  /** 拿摄像头麦克风（或识别端的画面） */
  prepare(): Promise<void>;
  /** 发起方：发 offer（声网不需要） */
  offer(peer: string): Promise<void>;
  /** 收到对方的信令（声网不需要） */
  onSignal(m: RtcMsg): Promise<void>;
  /** 会话开始：进频道 / 等信令 */
  connected(): Promise<void>;
  close(): Promise<void>;
}
