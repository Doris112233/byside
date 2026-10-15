/* 场景接口。一个场景 = 通话中间那块区域里的一个玩法（下棋、折纸、聊天、以后的画画……）。
   加新场景：在 scenes/ 下建目录实现这个接口，到 registry 里 register 一下，别的地方不用动。 */
import type { AnyMessage } from '../protocol/messages';
import type { NavAction } from '../ui/nav';

export interface SceneBadge {
  icon: string;
  text: string;
  hot: boolean;
}

/** 场景能用到的外界：发消息、我是谁、对方是谁、投影还是手持 */
export interface SceneCtx {
  send(m: AnyMessage): void;
  me(): string;
  peer(): string;
  peerName(): string;
  color(): 1 | 2;
  table(): boolean;
  inSession(): boolean;
  hint(): void;
  badge(): void;
}

export interface Scene {
  readonly id: string;
  readonly name: string; // dock 上的字：下棋
  readonly verb: string; // 邀请里的话：一起下棋
  readonly desc: string; // 选游戏抽屉里的一句话
  readonly icon: string; // svg symbol 的 href
  /** 这个场景关心的消息类型；registry 据此注册 */
  readonly messages: readonly string[];
  /** 页面加载时调一次：把自己的 DOM 建在 pane 里 */
  mount(pane: HTMLElement, ctx: SceneCtx): void;
  /** 每局开始：清状态 */
  start(): void;
  /** 自己的 pane 被切到前面 */
  show(): void;
  /** 通话结束 */
  stop(): void;
  onMessage(m: AnyMessage): void;
  /** 遥控器从 dock「返回」到桌上时该聚焦谁 */
  focusTarget(): HTMLElement | null;
  /** 焦点在自己区域里时底部的按键提示；不归自己管返回 null */
  hint(active: Element | null): string | null;
  badge(): SceneBadge;
  /** 可选：外界要求重画（比如标定图开关） */
  redraw?(): void;
}

export type { NavAction };
