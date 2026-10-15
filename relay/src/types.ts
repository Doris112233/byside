export type Kind = 'web' | 'board';

/** 一条连接。网页和板子都是这个。 */
export interface Conn {
  id: number;
  code: string; // 好友码，可能为空（匿名老客户端）
  kind: Kind;
  seat: string; // 房间内的身份：code 或 code#board
  name: string;
  room: Room | null;
  watching: Set<string>; // 订阅了谁的在线状态
  alive: boolean;
  closed: boolean;
  send(text: string): void;
  destroy(): void;
}

export interface Room {
  name: string;
  clients: Set<Conn>;
  seq: number;
  log: { seq: number; text: string }[];
  snapshot: { seq: number; text: string } | null;
  /** 快照之外还要保留的：role:<code>、game。reset 清日志也不清它们 */
  sticky: Map<string, { seq: number; text: string }>;
  emptyAt: number;
}

export type Msg = { t: string } & Record<string, unknown>;
