/* 中继消息的类型。协议说明在 protocol/PROTOCOL.md。
   每条消息都是一行 JSON，必有 t。服务端给房间消息打上 seat 和 seq，给点名消息填 from / name。 */

export interface MsgBase {
  t: string;
  seat?: string;
  seq?: number;
  from?: string;
  name?: string;
  to?: string;
  /** 具体类型各自补充字段；没定义类型的消息也能原样转发 */
  [k: string]: unknown;
}
export type AnyMessage = MsgBase;

// 服务端 → 客户端
export interface JoinedMsg extends MsgBase { t: '_joined'; room: string; head: number; peers: number; replayed: number }
export interface PresenceMsg extends MsgBase { t: 'presence'; code: string; online: boolean; desk: boolean; name: string; busy: boolean }
export interface UndeliveredMsg extends MsgBase { t: '_undelivered'; to: string; of: string }
export interface TokenMsg extends MsgBase { t: 'rtctoken'; channel: string; appId?: string; token?: string; ttl?: number; error?: string }

// 人对人
export interface InviteMsg extends MsgBase { t: 'invite'; from: string; game: string; room: string }
export interface AcceptMsg extends MsgBase { t: 'accept'; from: string; room: string }
export interface RejectMsg extends MsgBase { t: 'reject'; from: string; busy?: boolean }
export interface RtcMsg extends MsgBase {
  t: 'rtc';
  from: string;
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
  fallback?: number;
}

// 会话房间内
export type Stone = 0 | 1 | 2;
export interface MoveMsg extends MsgBase { t: 'move'; i: number; j: number; c: Stone }
export interface StateMsg extends MsgBase { t: 'state'; moves: [number, number, Stone][]; N: number }
export interface GameMsg extends MsgBase { t: 'game'; g: string }
export interface StepMsg extends MsgBase { t: 'step'; n: number }
export interface PointMsg extends MsgBase { t: 'point'; x: number; y: number }
export interface IconMsg extends MsgBase { t: 'icon'; k: string }
export interface CalibMsg extends MsgBase { t: 'calib'; on: boolean; code?: string }

/** 走慢通路、断线时要排队重发的类型 */
export const RELIABLE = new Set(['move', 'undo', 'reset', 'state', 'game', 'step', 'role']);
