/* 五子棋。发起方执黑、接受方执白。
   投影在桌上时：自己桌上的实体棋子不画（它是真的，画了反而重影）；
   对方的子投出来，而且一律投成「环」、中间留空 —— 这是防投影污染的第一道闸：
   摄像头的识别要求内圆（半径 0.30 格）里过半是亮的才算棋子，环心是暗的，过不了。
   投成实心的话，摄像头会把对方的白子认成自己桌上的真白子、回传、对方再投……正反馈。
   黑子本来就投不出来（黑 = 不发光），所以两种颜色靠环的颜色区分：暖白 / 琥珀。 */
import './gomoku.css';
import { drawCalibPattern } from '../../calib/pattern';
import { esc } from '../../dom';
import { BOARD, CALIB, STONE, type Stone } from '../../protocol/constants';
import type { AnyMessage, MoveMsg, StateMsg } from '../../protocol/messages';
import { state } from '../../state';
import * as nav from '../../ui/nav';
import { toast } from '../../ui/toast';
import type { Scene, SceneCtx } from '../scene';
import { Board, N } from './rules';

export interface Geom { w: number; pad: number; c: number }

class Gomoku implements Scene {
  readonly id = 'gomoku';
  readonly name = '下棋';
  readonly verb = '一起下棋';
  readonly desc = '摆真棋子，TA 的子投在你桌上';
  readonly icon = '#ic-go';
  readonly messages = ['move', 'undo', 'reset', 'state', 'req'] as const;

  readonly board = new Board();
  private cur: [number, number] = [7, 7];
  private cv!: HTMLCanvasElement;
  private ctx2d!: CanvasRenderingContext2D;
  private who!: HTMLElement;
  private ctx!: SceneCtx;

  mount(pane: HTMLElement, ctx: SceneCtx): void {
    this.ctx = ctx;
    pane.innerHTML = `
      <canvas class="board" data-nav tabindex="0" aria-label="棋盘：方向键移动，确定落子"></canvas>
      <div class="side">
        <div class="who"></div>
        <button class="sbtn" data-act="undo" data-nav>悔一手</button>
        <button class="sbtn" data-act="reset" data-nav>重来</button>
      </div>`;
    this.cv = pane.querySelector('canvas')!;
    this.ctx2d = this.cv.getContext('2d')!;
    this.who = pane.querySelector('.who')!;
    nav.bindKeys(this.cv, (act) => {
      const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[act as string];
      if (d) {
        this.cur = [Math.max(0, Math.min(N - 1, this.cur[0] + d[0]!)), Math.max(0, Math.min(N - 1, this.cur[1] + d[1]!))];
        this.draw();
        return true;
      }
      if (act === 'ok') { this.place(); return true; }
      return false;
    });
    this.cv.addEventListener('focus', () => this.draw());
    this.cv.addEventListener('blur', () => this.draw());
    this.cv.addEventListener('pointerdown', (e) => {
      const r = this.cv.getBoundingClientRect();
      const { pad, c } = this.geom();
      const i = Math.round((e.clientX - r.left - pad) / c);
      const j = Math.round((e.clientY - r.top - pad) / c);
      if (i >= 0 && j >= 0 && i < N && j < N) { this.cur = [i, j]; this.place(); }
    });
    pane.querySelector<HTMLElement>('[data-act="undo"]')!.onclick = () => {
      if (!this.board.moves.length) return;
      ctx.send({ t: 'undo' });
      this.board.undo();
      this.draw();
    };
    pane.querySelector<HTMLElement>('[data-act="reset"]')!.onclick = () => {
      ctx.send({ t: 'reset' });
      this.board.reset();
      this.cur = [7, 7];
      this.draw();
    };
    addEventListener('resize', () => { if (state.scene === this.id || state.calib) this.draw(); });
  }

  start(): void {
    this.board.reset();
    this.cur = [7, 7];
  }
  show(): void {
    requestAnimationFrame(() => this.draw());
  }
  stop(): void {}
  redraw(): void {
    this.draw();
  }
  focusTarget(): HTMLElement {
    return this.cv;
  }
  hint(active: Element | null): string | null {
    if (active !== this.cv) return null;
    return nav.K('方向键', '挪') + nav.K('确定', '落子') + nav.K('返回', '菜单');
  }
  badge() {
    const w = this.board.winner();
    const my = this.ctx.color();
    const peer = this.ctx.peerName();
    if (w) return { icon: this.icon, text: w === my ? '你赢了' : peer + ' 赢了', hot: false };
    if (this.board.turn === my) return { icon: this.icon, text: '该你了', hot: true };
    return { icon: this.icon, text: '等 ' + peer, hot: false };
  }

  onMessage(m: AnyMessage): void {
    switch (m.t) {
      case 'move': {
        const mv = m as MoveMsg;
        this.apply(mv.i, mv.j, mv.c, mv.seat ?? null);
        break;
      }
      case 'undo': this.board.undo(); this.draw(); break;
      case 'reset': this.board.reset(); this.cur = [7, 7]; this.draw(); break;
      case 'state': {
        const st = m as StateMsg;
        if (!st.moves) return;
        this.board.load(st.moves);
        this.draw();
        break;
      }
      case 'req':
        this.ctx.send({ t: 'state', moves: this.board.moves.map((x) => x.slice(0, 3)), N });
        break;
    }
  }

  private apply(i: number, j: number, c: Stone, seat: string | null): void {
    if (!this.board.apply(i, j, c, seat)) return;
    this.draw();
    const w = this.board.winner();
    if (w && this.ctx.inSession()) toast(w === this.ctx.color() ? '你赢了！' : this.ctx.peerName() + ' 赢了');
  }

  private place(): void {
    if (!this.ctx.inSession()) return;
    const [i, j] = this.cur;
    const my = this.ctx.color();
    if (this.board.winner()) return;
    if (this.board.turn !== my) { toast('还没轮到你，等 ' + this.ctx.peerName()); return; }
    if (this.board.at(i, j)) { toast('这里已经有子了'); return; }
    this.apply(i, j, my, this.ctx.me());
    this.ctx.send({ t: 'move', i, j, c: my });
  }

  geom(): Geom {
    const w = this.cv.clientWidth;
    const pad = w * 0.055;
    return { w, pad, c: (w - 2 * pad) / (N - 1) };
  }

  draw(): void {
    const cv = this.cv;
    const ctx = this.ctx2d;
    const w = cv.clientWidth;
    if (!w) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) cv.width = cv.height = Math.round(w * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    const { pad, c } = this.geom();
    const table = this.ctx.table();
    if (!table) {
      ctx.fillStyle = '#E8C98A';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, w, 10);
      ctx.fill();
    }
    ctx.strokeStyle = table ? 'rgba(240,178,90,.55)' : 'rgba(60,40,20,.55)';
    ctx.lineWidth = table ? 1.4 : 1;
    for (let k = 0; k < N; k++) {
      ctx.beginPath(); ctx.moveTo(pad, pad + k * c); ctx.lineTo(w - pad, pad + k * c); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad + k * c, pad); ctx.lineTo(pad + k * c, w - pad); ctx.stroke();
    }
    ctx.fillStyle = table ? 'rgba(240,178,90,.8)' : 'rgba(60,40,20,.7)';
    for (const [i, j] of BOARD.star_points) {
      ctx.beginPath(); ctx.arc(pad + i * c, pad + j * c, c * 0.11, 0, 7); ctx.fill();
    }
    if (state.calib) {
      drawCalibPattern(ctx, { pad, c, n: N });
      this.side();
      return;
    }
    const last = this.board.last();
    const mine = this.ctx.me() + '#board';
    for (let k = 0; k < N * N; k++) {
      const v = this.board.cells[k];
      if (!v) continue;
      const i = k % N;
      const j = (k / N) | 0;
      const x = pad + i * c;
      const y = pad + j * c;
      const r = c * 0.43;
      if (table) {
        if (this.board.origin[k] === mine) {
          // 自己板子认出来的真棋子：只画一圈淡淡的确认环，别在真子上叠投影
          ctx.strokeStyle = 'rgba(240,178,90,.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.stroke();
          continue;
        }
        const lw = c * 0.1;
        const rr = c * CALIB.ring_inner_cells + lw / 2; // 环的内沿比识别内圆宽出一圈余量
        ctx.lineWidth = lw;
        ctx.strokeStyle = v === STONE.white ? '#FFF4E2' : '#F0B25A';
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        if (v === STONE.black) { g.addColorStop(0, '#555'); g.addColorStop(1, '#111'); }
        else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#d9d4c7'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      if (last && last[0] === i && last[1] === j) {
        ctx.strokeStyle = '#E0975A'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, 7); ctx.stroke();
      }
    }
    // 遥控器光标：只在棋盘拿着焦点时画
    if (document.activeElement === cv && document.body.classList.contains('keys')) {
      const [i, j] = this.cur;
      ctx.save();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#F0B25A'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(pad + i * c, pad + j * c, c * 0.5, 0, 7); ctx.stroke();
      ctx.restore();
    }
    this.side();
  }

  private side(): void {
    if (state.calib) {
      this.who.innerHTML = '<b>标定中</b>摄像头会自动认出桌上<br>四个标记；标定页能看到结果';
      return;
    }
    if (!this.ctx.inSession()) return;
    const my = this.ctx.color();
    const peer = this.ctx.peerName();
    const win = this.board.winner();
    const stone = (c: Stone): string => `<span class="stone ${c === STONE.black ? 'b' : 'w'}"></span>`;
    let st: string;
    if (win) st = `<b>${stone(win)}${win === my ? '你赢了 🎉' : peer + ' 赢了'}</b>按「重来」再下一盘`;
    else if (this.board.turn === my) st = `<b>${stone(my)}该你了</b>摆真棋子，或者用遥控器`;
    else st = `<b>${stone(this.board.turn)}等 ${esc(peer)}</b>TA 的子会亮在你桌上`;
    this.who.innerHTML = `<div style="margin-bottom:.4rem">我执 ${stone(my)} ${my === STONE.black ? '黑' : '白'}</div>` + st;
    this.ctx.badge();
  }
}

export const gomoku = new Gomoku();
