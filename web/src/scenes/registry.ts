import { on } from '../net/dispatch';
import { state } from '../state';
import type { Scene, SceneCtx } from './scene';

export type { Scene, SceneCtx };

interface Mounted extends Scene {
  pane: HTMLElement;
}

const scenes: Scene[] = [];
const mounted = new Map<string, Mounted>();

export function register(scene: Scene): void {
  if (scenes.some((s) => s.id === scene.id)) throw new Error('场景重复注册：' + scene.id);
  scenes.push(scene);
}

export function all(): Mounted[] {
  return scenes.map((s) => mounted.get(s.id)!).filter(Boolean);
}
export function get(id: string | null | undefined): Mounted | undefined {
  return id ? mounted.get(id) : undefined;
}

/** 页面加载时：给每个场景建一个 pane，挂上，并把它关心的消息接进 dispatch */
export function mountAll(container: HTMLElement, ctx: SceneCtx): void {
  for (const s of scenes) {
    const pane = document.createElement('div');
    pane.className = 'gamepane';
    pane.id = 'p-' + s.id;
    container.appendChild(pane);
    s.mount(pane, ctx);
    const m = Object.assign(s, { pane }) as Mounted;
    mounted.set(s.id, m);
    on(s.messages, (msg) => {
      if (state.session) s.onMessage(msg);
    });
  }
}
