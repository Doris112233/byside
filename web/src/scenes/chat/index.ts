/* 聊聊天：没发起游戏时就是一起吃饭聊天的样子，一杯茶，热气袅袅 */
import './chat.css';
import type { Scene, SceneCtx } from '../scene';

class Chat implements Scene {
  readonly id = 'chat';
  readonly name = '聊聊天';
  readonly verb = '聊会儿天';
  readonly desc = '看看脸，说说话，吃饭时也可以';
  readonly icon = '#ic-tea';
  readonly messages = [] as const;

  mount(pane: HTMLElement, _ctx: SceneCtx): void {
    pane.innerHTML = `<div class="tea"><svg viewBox="0 0 48 48"><use href="#ic-tea"/></svg><span>一起喝杯茶，说说话</span></div>`;
  }
  start(): void {}
  show(): void {}
  stop(): void {}
  onMessage(): void {}
  focusTarget(): HTMLElement | null {
    return null;
  }
  hint(): string | null {
    return null;
  }
  badge() {
    return { icon: this.icon, text: '聊聊天', hot: false };
  }
}

export const chat = new Chat();
