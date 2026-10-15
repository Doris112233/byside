import { describe, expect, it } from 'vitest';
import { markerCenters } from '../src/calib/pattern';
import { CALIB } from '../src/protocol/constants';

describe('标定图', () => {
  it('四个标记中心离四角各 inset 格，顺序左上 右上 右下 左下', () => {
    const n = 15;
    const c = markerCenters(n);
    const i = CALIB.inset;
    expect(c).toEqual([[i, i], [14 - i, i], [14 - i, 14 - i], [i, 14 - i]]);
  });

  it('标记连亮底不会越过棋盘边（否则会被 canvas 裁掉）', () => {
    expect(CALIB.inset - CALIB.quiet_cells).toBeGreaterThanOrEqual(0);
  });
});
