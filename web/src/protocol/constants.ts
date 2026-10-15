// 三端共用常量的唯一来源是 protocol/constants.json；这里只是给它加类型。
import raw from '../../../protocol/constants.json';

export const BOARD = raw.board as { n: number; star_points: [number, number][] };
export const STONE = raw.stone as { empty: 0; black: 1; white: 2 };
export const CALIB = raw.calib as {
  inset: number;
  marker_cells: number;
  quiet_cells: number;
  ring_inner_cells: number;
  detect_inner_cells: number;
  patterns: number[][][];
};
export const FAST: ReadonlySet<string> = new Set(raw.fast);
export const FRIEND_CODE = raw.friend_code as { alphabet: string; length: number };
export const PORTS = raw.ports as { relay_http: number; relay_https: number; sensor_control: number };
export const TABLE_CAMERA = new RegExp(raw.table_camera_regex, 'i');
export const TIMEOUTS = raw.timeouts as {
  invite_s: number;
  accepting_s: number;
  token_ttl_s: number;
  room_gc_s: number;
};

export type Stone = 0 | 1 | 2;
