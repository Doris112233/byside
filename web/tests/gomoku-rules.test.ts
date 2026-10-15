import { describe, expect, it } from 'vitest';
import { Board, N } from '../src/scenes/gomoku/rules';

describe('五子棋规则', () => {
  it('黑先，落子后轮到白', () => {
    const b = new Board();
    expect(b.turn).toBe(1);
    expect(b.apply(7, 7, 1, 'A')).toBe(true);
    expect(b.turn).toBe(2);
    expect(b.at(7, 7)).toBe(1);
    expect(b.origin[7 * N + 7]).toBe('A');
  });

  it('越界、已有子、颜色不对都拒绝', () => {
    const b = new Board();
    expect(b.apply(-1, 0, 1)).toBe(false);
    expect(b.apply(N, 0, 1)).toBe(false);
    expect(b.apply(3, 3, 1)).toBe(true);
    expect(b.apply(3, 3, 2)).toBe(false);
    expect(b.apply(4, 4, 0 as never)).toBe(false);
  });

  it('悔棋把手数和轮次退回去', () => {
    const b = new Board();
    b.apply(1, 1, 1);
    b.apply(2, 2, 2);
    expect(b.undo()?.[2]).toBe(2);
    expect(b.turn).toBe(2);
    expect(b.at(2, 2)).toBe(0);
    b.undo();
    expect(b.undo()).toBeNull();
  });

  it('横、竖、斜连五都算赢，四个不算', () => {
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      const b = new Board();
      for (let k = 0; k < 4; k++) b.apply(5 + di * k, 7 + dj * k, 1);
      expect(b.winner()).toBe(0);
      b.apply(5 + di * 4, 7 + dj * 4, 1);
      expect(b.winner()).toBe(1);
    }
  });

  it('load 从全量 moves 重建', () => {
    const b = new Board();
    b.load([[0, 0, 1], [1, 1, 2], [0, 1, 1]]);
    expect(b.moves.length).toBe(3);
    expect(b.turn).toBe(2);
    expect(b.at(0, 1)).toBe(1);
  });
});
