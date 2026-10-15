"""
投影渲染 —— pygame 全屏输出到 HDMI。

关键设计（沿用网页版的「所见即所测」）：
棋盘画在投影画面上的哪个位置是我们定的，标定只需要告诉系统
「投出来的那个方框，在相机画面里对应哪四个点」。
这样只有一套标定，不需要第二套投影仪内参。
"""
import glob
import os
import time

import pygame


def _cjk_font(size):
    """找一个中文字体。SysFont(None) 在板子上渲染中文是一片豆腐块。"""
    cands = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ]
    cands += sorted(glob.glob("/usr/share/fonts/**/NotoSansCJK*.ttc", recursive=True))
    cands += sorted(glob.glob("/usr/share/fonts/**/*CJK*.tt[cf]", recursive=True))
    for f in cands:
        if os.path.exists(f):
            try:
                return pygame.font.Font(f, size)
            except Exception:
                pass
    return pygame.font.SysFont(None, int(size * 1.3))

BLACK, WHITE, EMPTY = 1, 2, 0

BG        = (0, 0, 0)
GRID      = (190, 160, 105)      # 投到桌面上是暖色木纹感，也压低了蓝光
GRID_EDGE = (235, 200, 130)
STONE_W   = (245, 245, 240)
STONE_B   = (28, 28, 32)
GHOST     = (235, 168, 62)       # 对方的虚拟棋子：描边不填实，跟真棋子一眼分得开
HINT      = (120, 120, 130)


class Renderer:
    def __init__(self, n=15, fullscreen=True, size=None):
        pygame.init()
        pygame.mouse.set_visible(False)
        flags = pygame.FULLSCREEN if fullscreen else 0
        self.screen = pygame.display.set_mode(size or (0, 0), flags)
        pygame.display.set_caption("BySide")
        self.w, self.h = self.screen.get_size()
        self.n = n
        self.font = _cjk_font(24)
        # 棋盘方框：居中，边长取短边的 78%。board_rect 是可调的，
        # 因为投影仪镜头偏移会让画面偏在一侧，用户可能需要挪一下。
        self.margin = 0.11
        self.offset = [0.0, 0.0]

    def board_rect(self):
        side = min(self.w, self.h) * (1 - 2 * self.margin)
        cx = self.w / 2 + self.offset[0] * self.w
        cy = self.h / 2 + self.offset[1] * self.h
        return cx - side / 2, cy - side / 2, side

    def cell(self):
        return self.board_rect()[2] / (self.n - 1)

    def pt(self, i, j):
        x0, y0, side = self.board_rect()
        c = side / (self.n - 1)
        return x0 + i * c, y0 + j * c

    def draw(self, phys, remote, msg=None, show_hint=False, points=None):
        """phys: 本端识别到的实体棋子（n*n）；remote: 对端传来的虚拟棋子（n*n）。"""
        s = self.screen
        s.fill(BG)
        x0, y0, side = self.board_rect()
        c = side / (self.n - 1)

        # 棋盘线
        for k in range(self.n):
            col = GRID_EDGE if k in (0, self.n - 1) else GRID
            wdt = 3 if k in (0, self.n - 1) else 1
            pygame.draw.line(s, col, (x0, y0 + k * c), (x0 + side, y0 + k * c), wdt)
            pygame.draw.line(s, col, (x0 + k * c, y0), (x0 + k * c, y0 + side), wdt)
        # 星位
        for (i, j) in [(3, 3), (11, 3), (3, 11), (11, 11), (7, 7)]:
            if i < self.n and j < self.n:
                pygame.draw.circle(s, GRID_EDGE, self.pt(i, j), max(3, int(c * 0.09)))

        r = int(c * 0.42)
        # 对方的虚拟棋子：只描边。实心留给真棋子，这样桌上一眼看得出哪些是真的。
        for j in range(self.n):
            for i in range(self.n):
                v = remote[j * self.n + i]
                if v:
                    pygame.draw.circle(s, GHOST, self.pt(i, j), r, max(2, r // 5))

        # 本端识别到的实体棋子：画一个淡淡的确认环，告诉用户「我看见它了」
        if show_hint:
            for j in range(self.n):
                for i in range(self.n):
                    if phys[j * self.n + i]:
                        pygame.draw.circle(s, HINT, self.pt(i, j), r + 4, 1)

        if msg:
            t = self.font.render(msg, True, GRID_EDGE)
            s.blit(t, (int(self.w * 0.04), int(self.h * 0.04)))
        if points:
            self.draw_points(points)
        pygame.display.flip()

    def draw_points(self, points, now=None):
        """对方在网页上点一下，这里亮一个光点，两秒内淡掉。
        坐标是相对投影方框的 0..1 —— 网页那边的折纸图和这里的方框是同一个坐标系，
        所以「点在图上哪里」就「亮在纸上哪里」，前提是纸放在方框里。"""
        now = now or time.time()
        x0, y0, side = self.board_rect()
        for (px, py, t0) in points:
            age = now - t0
            if age > 2.2:
                continue
            a = max(0.0, 1.0 - age / 2.2)
            r = int(side * 0.035 * (1.0 + 0.6 * min(age, 0.3) / 0.3))
            cx, cy = int(x0 + px * side), int(y0 + py * side)
            glow = pygame.Surface((r * 6, r * 6), pygame.SRCALPHA)
            pygame.draw.circle(glow, (240, 178, 90, int(90 * a)), (r * 3, r * 3), r * 3)
            pygame.draw.circle(glow, (240, 178, 90, int(200 * a)), (r * 3, r * 3), int(r * 1.6))
            pygame.draw.circle(glow, (255, 240, 210, int(255 * a)), (r * 3, r * 3), r)
            self.screen.blit(glow, (cx - r * 3, cy - r * 3))

    def draw_origami(self, step, caption, points):
        """折纸：投影只做引导——方框告诉老人纸放哪，顶上一行是这一步要做什么，
        光点是对方指的位置。不识别纸，那是难题，这一版明确不碰。"""
        s = self.screen
        s.fill(BG)
        x0, y0, side = self.board_rect()
        pygame.draw.rect(s, GRID, (x0, y0, side, side), 2)
        for k in (0.25, 0.5, 0.75):
            pygame.draw.line(s, (60, 52, 40), (x0 + k * side, y0), (x0 + k * side, y0 + side), 1)
            pygame.draw.line(s, (60, 52, 40), (x0, y0 + k * side), (x0 + side, y0 + k * side), 1)
        t = self.font.render(f"第 {step + 1} 步  {caption}", True, GRID_EDGE)
        s.blit(t, (int(x0), int(max(8, y0 - 40))))
        self.draw_points(points)
        pygame.display.flip()

    def calib_pattern(self, note=None):
        """标定图：只画棋盘方框和四角靶心，让用户在相机预览上对准。"""
        s = self.screen
        s.fill(BG)
        x0, y0, side = self.board_rect()
        pygame.draw.rect(s, GRID_EDGE, (x0, y0, side, side), 3)
        for (cx, cy) in [(x0, y0), (x0 + side, y0), (x0 + side, y0 + side), (x0, y0 + side)]:
            pygame.draw.circle(s, GHOST, (cx, cy), 26, 3)
            pygame.draw.line(s, GHOST, (cx - 34, cy), (cx + 34, cy), 2)
            pygame.draw.line(s, GHOST, (cx, cy - 34), (cx, cy + 34), 2)
        txt = note or "把相机预览上的四个角拖到这四个靶心"
        t = self.font.render(txt, True, GHOST if note else GRID)
        s.blit(t, (int(self.w * 0.04), int(self.h * 0.06)))
        pygame.display.flip()

    def quit(self):
        pygame.quit()
