/* 五子棋的规则部分：纯函数，不碰 DOM，可以单测。 */
import { BOARD, STONE, type Stone } from '../../protocol/constants';

export const N = BOARD.n;
export type Move = [i: number, j: number, c: Stone, seat: string | null];

export class Board {
  readonly cells = new Int8Array(N * N);
  /** 每个格点上的子是谁放的（seat），投影时自己板子认出的真棋子不画环 */
  readonly origin: (string | null)[] = new Array<string | null>(N * N).fill(null);
  moves: Move[] = [];
  turn: Stone = STONE.black;

  reset(): void {
    this.cells.fill(0);
    this.origin.fill(null);
    this.moves = [];
    this.turn = STONE.black;
  }

  at(i: number, j: number): Stone {
    return this.cells[j * N + i] as Stone;
  }

  /** 落子。无效（越界、颜色不对、已有子）返回 false。 */
  apply(i: number, j: number, c: Stone, seat: string | null = null): boolean {
    if (!(i >= 0 && j >= 0 && i < N && j < N) || (c !== STONE.black && c !== STONE.white)) return false;
    const k = j * N + i;
    if (this.cells[k]) return false;
    this.cells[k] = c;
    this.origin[k] = seat;
    this.moves.push([i, j, c, seat]);
    this.turn = c === STONE.black ? STONE.white : STONE.black;
    return true;
  }

  undo(): Move | null {
    const m = this.moves.pop();
    if (!m) return null;
    const k = m[1] * N + m[0];
    this.cells[k] = 0;
    this.origin[k] = null;
    this.turn = m[2];
    return m;
  }

  load(moves: [number, number, Stone][]): void {
    this.reset();
    for (const [i, j, c] of moves) this.apply(i, j, c, null);
  }

  last(): Move | undefined {
    return this.moves[this.moves.length - 1];
  }

  /** 谁连成五个了；没有返回 0 */
  winner(): Stone {
    const b = this.cells;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = b[j * N + i];
        if (!v) continue;
        for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
          let k = 1;
          while (k < 5) {
            const x = i + di * k;
            const y = j + dj * k;
            if (x < 0 || y < 0 || x >= N || y >= N || b[y * N + x] !== v) break;
            k++;
          }
          if (k === 5) return v as Stone;
        }
      }
    }
    return STONE.empty;
  }
}
