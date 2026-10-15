import { describe, expect, it } from 'vitest';
import { BOARD, CALIB, FAST, FRIEND_CODE, STONE, TABLE_CAMERA } from '../src/protocol/constants';

describe('protocol/constants.json', () => {
  it('棋盘是 15 路，星位在盘内', () => {
    expect(BOARD.n).toBe(15);
    for (const [i, j] of BOARD.star_points) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(BOARD.n);
    }
  });

  it('投影环的内沿必须比识别内圆大，否则投影会被当成真棋子', () => {
    expect(CALIB.ring_inner_cells).toBeGreaterThan(CALIB.detect_inner_cells);
  });

  it('四个 ArUco 图案是 4x4 且互不相同', () => {
    expect(CALIB.patterns).toHaveLength(4);
    const seen = new Set<string>();
    for (const p of CALIB.patterns) {
      expect(p).toHaveLength(4);
      for (const row of p) expect(row).toHaveLength(4);
      seen.add(JSON.stringify(p));
    }
    expect(seen.size).toBe(4);
  });

  it('好友码字母表去掉了易混的 0 O 1 I L', () => {
    for (const ch of '0O1IL') expect(FRIEND_CODE.alphabet).not.toContain(ch);
    expect(FRIEND_CODE.length).toBe(6);
  });

  it('快通路集合和棋子码', () => {
    expect(FAST.has('icon')).toBe(true);
    expect(FAST.has('move')).toBe(false);
    expect(STONE).toEqual({ empty: 0, black: 1, white: 2 });
  });

  it('桌面相机正则认得影石', () => {
    expect(TABLE_CAMERA.test('Insta360 Link 2')).toBe(true);
    expect(TABLE_CAMERA.test('FaceTime HD Camera')).toBe(false);
  });
});
