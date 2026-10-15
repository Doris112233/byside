"""
YOLO (ONNX) 棋子检测 —— classic 算法之外的第二条路，接口和 byside_cv.classify_abs 一样。

    classic   内圆/外环中位数（byside_cv.classify_abs），零训练，怕反光和花桌面
    onnx      YOLOv8 之类的检测模型导出的 .onnx，框中心落到最近的格点

要用它得先有模型：
    1. 采数据   python capture.py -o frames/desk01 -n 200     （真桌面、真棋子、各种光线）
    2. 标注     两类：0 = black，1 = white（labelImg / Roboflow 都行，导出 YOLO 格式）
    3. 训练     pip install ultralytics; yolo train model=yolov8n.pt data=stones.yaml imgsz=640
    4. 导出     yolo export model=runs/detect/train/weights/best.pt format=onnx
    5. 跑       python app.py --headless --detector onnx --model best.onnx ...
       推理依赖  pip install onnxruntime   （板子上用 onnxruntime 的 aarch64 轮子即可）

模型输出按 YOLOv8 的 (1, 4+nc, 8400) 或 (1, 8400, 4+nc) 解析，xywh 为输入图像素坐标。
"""
import numpy as np

BLACK, WHITE, EMPTY = 1, 2, 0
CLASS_TO_STONE = {0: BLACK, 1: WHITE}


def letterbox(img, size):
    """等比缩放 + 灰边填到 size×size。返回 (图, 缩放比, (padx, pady))。"""
    import cv2
    h, w = img.shape[:2]
    r = size / max(h, w)
    nw, nh = int(round(w * r)), int(round(h * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    out = np.full((size, size, 3), 114, np.uint8)
    px, py = (size - nw) // 2, (size - nh) // 2
    out[py:py + nh, px:px + nw] = resized
    return out, r, (px, py)


def parse_yolo(out, conf_th):
    """把 YOLOv8 的原始输出变成 [(cx, cy, w, h, cls, conf)]，坐标在 letterbox 图上。"""
    a = np.asarray(out)
    if a.ndim == 3:
        a = a[0]
    if a.shape[0] < a.shape[1]:          # (4+nc, 8400) → (8400, 4+nc)
        a = a.T
    boxes, scores = a[:, :4], a[:, 4:]
    cls = scores.argmax(1)
    conf = scores[np.arange(len(cls)), cls]
    keep = conf >= conf_th
    return [(*boxes[k], int(cls[k]), float(conf[k])) for k in np.flatnonzero(keep)]


def nms(dets, iou_th):
    import cv2
    if not dets:
        return []
    b = [[d[0] - d[2] / 2, d[1] - d[3] / 2, d[2], d[3]] for d in dets]
    idx = cv2.dnn.NMSBoxes(b, [d[5] for d in dets], 0.0, iou_th)
    idx = np.asarray(idx).reshape(-1)
    return [dets[int(i)] for i in idx]


class OnnxStoneDetector:
    def __init__(self, model_path, imgsz=640, conf=0.35, iou=0.5, class_map=None):
        try:
            import onnxruntime as ort
        except ImportError as e:
            raise RuntimeError("要跑 onnx 检测得先 pip install onnxruntime") from e
        self.sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.imgsz, self.conf, self.iou = imgsz, conf, iou
        self.class_map = class_map or CLASS_TO_STONE

    def detect(self, bgr):
        """返回 [(cx, cy, stone, conf)]，坐标在传入图像上。"""
        lb, r, (px, py) = letterbox(bgr, self.imgsz)
        x = lb[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        out = self.sess.run(None, {self.inp: np.ascontiguousarray(x)})[0]
        dets = nms(parse_yolo(out, self.conf), self.iou)
        res = []
        for cx, cy, w, h, c, conf in dets:
            stone = self.class_map.get(c)
            if stone is None:
                continue
            res.append(((cx - px) / r, (cy - py) / r, stone, conf))
        return res

    def classify(self, bgr, bp, n=15, seat=None):
        """和 classify_abs 同样的返回：(cls[n*n] int8, score[n*n] float32, cell)。"""
        from byside_sensor.detect import classic as bcv
        cell = bcv.cell_size(bp)
        if not (cell > 4):
            return None, None, cell
        return detections_to_grid(self.detect(bgr), bp, n, cell, seat)


def detections_to_grid(dets, bp, n, cell, seat=None, max_dist=0.5):
    """每个检测框的中心落到最近的格点（距离 < max_dist 格），同一格点取置信度高的。
    和 classic 一样：每端只认自己那一色（seat），防投影污染。"""
    ctr = np.array([bp(i, j) for j in range(n) for i in range(n)], np.float64)   # (n*n, 2)
    cls = np.zeros(n * n, np.int8)
    score = np.zeros(n * n, np.float32)
    seat_c = {"white": WHITE, "black": BLACK}.get(seat, 0)
    for cx, cy, stone, conf in dets:
        if seat_c and stone != seat_c:
            continue
        d = np.hypot(ctr[:, 0] - cx, ctr[:, 1] - cy)
        k = int(np.argmin(d))
        if d[k] > max_dist * cell or conf <= score[k]:
            continue
        cls[k] = stone
        score[k] = conf
    return cls, score, cell


if __name__ == "__main__":
    # 不需要模型的自测：假检测 → 格点映射
    from byside_sensor.detect import classic as bcv
    quad = [[100, 100], [800, 100], [800, 800], [100, 800]]
    bp = bcv.grid_backproject(quad, 15)
    cell = bcv.cell_size(bp)
    px = lambda i, j: bp(i, j)
    dets = [(*px(7, 7), BLACK, .9),                      # 正中
            (px(0, 0)[0] + cell * .3, px(0, 0)[1] - cell * .2, WHITE, .8),   # 偏一点仍归到 (0,0)
            (px(3, 4)[0] + cell * .5, px(3, 4)[1] + cell * .5, BLACK, .95),  # 正好在四个格点中间（0.71 格），丢弃
            (*px(14, 14), WHITE, .5), (*px(14, 14), BLACK, .7)]             # 同格点取高分
    cls, score, _ = detections_to_grid(dets, bp, 15, cell)
    assert cls[7 * 15 + 7] == BLACK and cls[0] == WHITE and cls[14 * 15 + 14] == BLACK
    assert cls[4 * 15 + 3] == EMPTY and cls[4 * 15 + 4] == EMPTY and cls[5 * 15 + 4] == EMPTY
    assert int((cls != EMPTY).sum()) == 3
    clsb, _, _ = detections_to_grid(dets, bp, 15, cell, seat="black")
    assert clsb[0] == EMPTY and clsb[7 * 15 + 7] == BLACK
    # 输出解析：造一个 (1, 6, 8400) 的假输出
    fake = np.zeros((1, 6, 8400), np.float32); fake[0, :, 10] = [320, 320, 30, 30, .1, .9]
    p = parse_yolo(fake, .35); assert len(p) == 1 and p[0][4] == 1 and abs(p[0][5] - .9) < 1e-6
    print("detect_onnx 自测通过：格点映射、座位过滤、同格去重、YOLO 输出解析")
