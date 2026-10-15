/* 标定图：方框 + 四个 ArUco 标记，画在棋盘 canvas 上。
   标记不压在角点上（棋盘外只有 0.86 格边距，标记会被 canvas 裁掉、黑边不闭合就认不出），
   而是往里缩到离角 inset 格的格点上；识别端（sensor/calib/aruco.py，同一套图案、同一个 inset）
   从 4 个中心做单应，外推回真正的四个角，不用人拖。
   投影仪上白 = 发光：标记外面垫一圈亮底，黑边 = 不发光 = 露出桌面，摄像头看到的
   就是一张「印在亮纸上的标记」。图案和尺寸都来自 protocol/constants.json。 */
import { CALIB } from '../protocol/constants';

export interface GridGeom { pad: number; c: number; n: number }

export function markerCenters(n: number): [number, number][] {
  const IN = CALIB.inset;
  const m = n - 1;
  return [[IN, IN], [m - IN, IN], [m - IN, m - IN], [IN, m - IN]];
}

export function drawCalibPattern(ctx: CanvasRenderingContext2D, { pad, c, n }: GridGeom): void {
  ctx.strokeStyle = '#F0B25A';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, (n - 1) * c, (n - 1) * c);
  markerCenters(n).forEach(([i, j], id) => {
    const x = pad + i * c;
    const y = pad + j * c;
    const k = c * CALIB.marker_cells;
    const u = k / 6;
    const b = c * CALIB.quiet_cells;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - b, y - b, 2 * b, 2 * b); // 亮底（静区）
    ctx.fillStyle = '#000';
    ctx.fillRect(x - k / 2, y - k / 2, k, k); // 黑边
    ctx.fillStyle = '#fff';
    const pat = CALIB.patterns[id]!;
    for (let yy = 0; yy < 4; yy++) {
      for (let xx = 0; xx < 4; xx++) {
        if (!pat[yy]![xx]) ctx.fillRect(x - k / 2 + (xx + 1) * u, y - k / 2 + (yy + 1) * u, u + 0.5, u + 0.5);
      }
    }
  });
}
