#!/usr/bin/env python3
"""识别准确率评测 —— 一条命令回答「改完有没有退步」。

    python tools/eval.py              # 合成测试集
    python tools/eval.py -n 50 -v

pytest 里 tests/test_eval.py 跑的是同一套函数，门槛也一样。
"""
from __future__ import annotations

import argparse
import sys
import time

import numpy as np

from byside_sensor.calib.homography import grid_backproject
from byside_sensor.capture import synth
from byside_sensor.detect.classic import classify_abs
from byside_sensor.detect.tracker import STONE_STABLE, StoneTracker
from byside_sensor.protocol import BLACK, EMPTY, WHITE, constants

N = constants().n


def run_synthetic(count: int, seat: str | None, seed0: int = 0, verbose: bool = False) -> dict:
    tot = hit = 0
    fp = fn = swap = 0
    times = []
    worst = None
    for k in range(count):
        img, truth, quad = synth.make_board(seed=seed0 + k)
        bp = grid_backproject(quad, N)
        t0 = time.perf_counter()
        cls, _score, cell = classify_abs(img, bp, N, seat=seat)
        times.append((time.perf_counter() - t0) * 1000)
        if cls is None:
            print(f"  [{k}] 分类失败 cell={cell:.1f}")
            continue
        exp = truth.copy()
        if seat == "black":
            exp = np.where(exp == BLACK, BLACK, EMPTY).astype(np.int8)
        elif seat == "white":
            exp = np.where(exp == WHITE, WHITE, EMPTY).astype(np.int8)
        ok = cls == exp
        tot += ok.size
        hit += int(ok.sum())
        fp += int(((exp == EMPTY) & (cls != EMPTY)).sum())
        fn += int(((exp != EMPTY) & (cls == EMPTY)).sum())
        swap += int(((exp != EMPTY) & (cls != EMPTY) & (cls != exp)).sum())
        bad = int((~ok).sum())
        if worst is None or bad > worst[1]:
            worst = (k, bad)
        if verbose and bad:
            print(f"  [{k}] 错 {bad}/{N * N}  cell={cell:.1f}")
    acc = hit / tot * 100 if tot else 0
    return dict(acc=acc, tot=tot, fp=fp, fn=fn, swap=swap,
                ms=float(np.mean(times)) if times else 0,
                ms_max=float(np.max(times)) if times else 0, worst=worst)


def run_occlusion(seat: str | None, trials: int = 6) -> tuple[int, int]:
    """遮挡保护：手盖住棋盘时，绝不能把手认成落子。返回 (漏过次数, 总次数)。"""
    leaked = 0
    for k in range(trials):
        img, _truth, quad = synth.make_board(seed=500 + k)
        bp = grid_backproject(quad, N)
        tr = StoneTracker(N)
        for _ in range(STONE_STABLE + 2):
            tr.update(classify_abs(img, bp, N, seat=seat).cls)
        base = tr.phys.copy()
        for t in range(STONE_STABLE + 2):
            hand = synth.add_hand(img, quad, seed=900 + k * 10 + t)
            tr.update(classify_abs(hand, bp, N, seat=seat).cls)
        if not np.array_equal(tr.phys, base):
            leaked += 1
    return leaked, trials


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--count", type=int, default=20)
    ap.add_argument("--seat", default="black", choices=["black", "white", "both"])
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    seat = None if a.seat == "both" else a.seat

    print(f"=== 合成测试集  {a.count} 张  seat={a.seat} ===")
    r = run_synthetic(a.count, seat, verbose=a.verbose)
    print(f"  准确率      {r['acc']:.2f}%   ({r['tot']} 个交叉点)")
    print(f"  误报(空→子) {r['fp']}   漏报(子→空) {r['fn']}   颜色错 {r['swap']}")
    print(f"  单帧耗时    平均 {r['ms']:.1f} ms   最慢 {r['ms_max']:.1f} ms")
    if r["worst"]:
        print(f"  最差一张    #{r['worst'][0]}  错 {r['worst'][1]}/{N * N}")
    print("\n=== 遮挡保护  手伸进来不能被认成落子 ===")
    leaked, trials = run_occlusion(seat)
    print(f"  {trials - leaked}/{trials} 次正确冻结" + ("" if leaked == 0 else f"   ⚠️ {leaked} 次漏过"))
    ok = r["acc"] >= 99.0 and leaked == 0
    print("\n结论:", "通过 ✓" if ok else "未达标 ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
