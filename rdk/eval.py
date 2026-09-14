#!/usr/bin/env python3
"""
识别准确率评测 —— 计划里"一条命令回答好没好"的那个脚本。

    python eval.py              # 合成测试集
    python eval.py --frames DIR # 真实录制的帧（需要同名 .json 标注）

改完算法跑一下，一秒钟知道有没有退步。AI 改动会顺手动别处，
没有这个数字你永远说不清今天比昨天好还是坏。
"""
import argparse
import sys
import time
import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import byside_cv as cv
import synth

BLACK, WHITE, EMPTY = 1, 2, 0


def run_synthetic(count, seat, seed0=0, verbose=False):
    tot = hit = 0
    fp = fn = swap = 0
    times = []
    worst = None

    for k in range(count):
        img, truth, quad = synth.make_board(seed=seed0 + k)
        bp = cv.grid_backproject(quad, 15)
        t0 = time.perf_counter()
        cls, score, cell = cv.classify_abs(img, bp, 15, seat=seat)
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
        tot += ok.size; hit += int(ok.sum())
        fp += int(((exp == EMPTY) & (cls != EMPTY)).sum())
        fn += int(((exp != EMPTY) & (cls == EMPTY)).sum())
        swap += int(((exp != EMPTY) & (cls != EMPTY) & (cls != exp)).sum())
        bad = int((~ok).sum())
        if worst is None or bad > worst[1]:
            worst = (k, bad)
        if verbose and bad:
            print(f"  [{k}] 错 {bad}/225  cell={cell:.1f}")

    acc = hit / tot * 100 if tot else 0
    return dict(acc=acc, tot=tot, fp=fp, fn=fn, swap=swap,
                ms=float(np.mean(times)) if times else 0,
                ms_max=float(np.max(times)) if times else 0, worst=worst)


def run_occlusion(seat, trials=6):
    """遮挡保护：手盖住棋盘时，绝不能把手认成落子。"""
    leaked = 0
    for k in range(trials):
        img, truth, quad = synth.make_board(seed=500 + k)
        bp = cv.grid_backproject(quad, 15)
        tr = cv.StoneTracker()
        # 先让干净画面稳定下来，形成已确认状态
        for _ in range(cv.STONE_STABLE + 2):
            cls, _, _ = cv.classify_abs(img, bp, 15, seat=seat)
            tr.update(cls)
        base = tr.phys.copy()
        # 手伸进来，连续若干帧位置都在动
        for t in range(cv.STONE_STABLE + 2):
            hand = synth.add_hand(img, quad, seed=900 + k * 10 + t)
            cls, _, _ = cv.classify_abs(hand, bp, 15, seat=seat)
            tr.update(cls)
        if not np.array_equal(tr.phys, base):
            leaked += 1
    return leaked, trials


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--count", type=int, default=20)
    ap.add_argument("--seat", default="black", choices=["black", "white", "both"])
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    seat = None if a.seat == "both" else a.seat

    print(f"=== 合成测试集  {a.count} 张  seat={a.seat} ===")
    r = run_synthetic(a.count, seat, verbose=a.verbose)
    print(f"  准确率      {r['acc']:.2f}%   ({r['tot']} 个交叉点)")
    print(f"  误报(空→子) {r['fp']}")
    print(f"  漏报(子→空) {r['fn']}")
    print(f"  颜色错      {r['swap']}")
    print(f"  单帧耗时    平均 {r['ms']:.1f} ms   最慢 {r['ms_max']:.1f} ms")
    if r["worst"]:
        print(f"  最差一张    #{r['worst'][0]}  错 {r['worst'][1]}/225")

    print()
    print("=== 遮挡保护  手伸进来不能被认成落子 ===")
    leaked, trials = run_occlusion(seat)
    print(f"  {trials - leaked}/{trials} 次正确冻结" +
          ("" if leaked == 0 else f"   ⚠️ {leaked} 次漏过"))

    print()
    ok = r["acc"] >= 99.0 and leaked == 0
    print("结论:", "通过 ✓" if ok else "未达标 ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
