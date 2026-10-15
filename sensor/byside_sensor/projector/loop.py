"""pygame 直投：不经过浏览器，识别端自己往 HDMI 画。板子上没浏览器时的备选。
pygame 的 display 必须在主线程，所以采集放到线程里。"""
from __future__ import annotations

import threading

from byside_sensor.pipeline import Pipeline
from byside_sensor.scenes.origami import STEPS


def run_projector(p: Pipeline, fullscreen: bool = True) -> None:
    import pygame

    from . import pygame_out
    r = pygame_out.Renderer(p.n, fullscreen=fullscreen)
    print(f"投影分辨率 {r.w}x{r.h}", flush=True)
    threading.Thread(target=p.run, daemon=True, name="capture").start()
    clock = pygame.time.Clock()
    while p.running:
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key in (pygame.K_ESCAPE, pygame.K_q)):
                p.running = False
        r.margin, r.offset = p.calib.margin, p.calib.offset
        if p.src is None:
            r.calib_pattern(note=f"等待相机  {p.cam_status}")
        elif p.mode == "calib":
            r.calib_pattern()
        elif p.scene == "origami":
            o = p.origami.snapshot()
            r.draw_origami(o["step"], STEPS[o["step"]], o["points"])
        else:
            g = p.gomoku.snapshot()
            with p.lock:
                phys = p.tracker.phys.copy()
            r.draw(phys, g["remote"], show_hint=True, points=p.origami.snapshot()["points"])
        clock.tick(30)
    r.quit()
    p.stop()
