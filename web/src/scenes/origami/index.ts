/* 折纸：小船五步。不识别纸 —— 投影在桌上时，步骤图就叠在真纸上当折线参考，
   对方在图上指哪里，老人纸上就亮哪里。 */
import './origami.css';
import type { AnyMessage, PointMsg, StepMsg } from '../../protocol/messages';
import { state } from '../../state';
import * as nav from '../../ui/nav';
import type { Scene, SceneCtx } from '../scene';

const STEPS: [caption: string, art: string][] = [
  ['把纸横过来，对折一次，折痕在上面', `<path d="M 20,30 H 180 V 120 H 20 Z"/><path d="M 20,75 H 180" stroke-dasharray="6 5" opacity=".7"/><path d="M 100,58 l 0,-18 m -6,6 l 6,-6 l 6,6" stroke-width="1.6"/>`],
  ['两个上角向中间折下来，变成一个三角', `<path d="M 20,120 H 180 L 100,30 Z"/><path d="M 100,30 V 120" stroke-dasharray="6 5" opacity=".6"/><path d="M 40,60 q 20,-15 40,-8 M 160,60 q -20,-15 -40,-8" stroke-width="1.5" opacity=".8"/>`],
  ['下面两条边，一前一后往上折', `<path d="M 20,100 H 180 L 100,30 Z"/><path d="M 20,100 H 180 V 120 H 20 Z"/><path d="M 100,112 l 0,-14 m -5,5 l 5,-5 l 5,5" stroke-width="1.6"/>`],
  ['从底下撑开，压平成一个方块', `<path d="M 55,40 H 145 L 145,125 H 55 Z"/><path d="M 55,40 L 145,125 M 145,40 L 55,125" stroke-dasharray="5 5" opacity=".5"/><path d="M 30,82 l 18,0 m -6,-6 l 6,6 l -6,6 M 170,82 l -18,0 m 6,-6 l -6,6 l 6,6" stroke-width="1.5"/>`],
  ['捏住两个角往外一拉，小船就出来了', `<path d="M 20,100 Q 100,125 180,100 L 160,125 H 40 Z"/><path d="M 60,100 L 100,45 L 140,100"/><path d="M 100,45 V 100" stroke-dasharray="5 4" opacity=".6"/><path d="M 25,88 q -8,-6 -4,-14 M 175,88 q 8,-6 4,-14" stroke-width="1.5"/>`],
];

class Origami implements Scene {
  readonly id = 'origami';
  readonly name = '折纸';
  readonly verb = '一起折纸';
  readonly desc = '一步步折只小船，TA 指哪里你桌上亮哪里';
  readonly icon = '#ic-paper';
  readonly messages = ['step', 'point'] as const;

  private step = 0;
  private pointing = false;
  private pcur: [number, number] = [0.5, 0.5];
  private paper!: HTMLElement;
  private art!: HTMLElement;
  private cap!: HTMLElement;
  private cur!: HTMLElement;
  private prev!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private ctx!: SceneCtx;

  mount(pane: HTMLElement, ctx: SceneCtx): void {
    this.ctx = ctx;
    pane.innerHTML = `
      <div class="paperwrap">
        <button class="stepbtn" data-act="prev" data-nav aria-label="上一步"><svg viewBox="0 0 48 48" width="60%"><use href="#ic-back"/></svg></button>
        <div class="paper" data-nav tabindex="0" aria-label="折纸图：确定进入指一指">
          <div class="art"></div><div class="cur"></div><div class="cap"></div>
        </div>
        <button class="stepbtn" data-act="next" data-nav aria-label="下一步"><svg viewBox="0 0 48 48" width="60%"><use href="#ic-next"/></svg></button>
      </div>`;
    this.paper = pane.querySelector('.paper')!;
    this.art = pane.querySelector('.art')!;
    this.cap = pane.querySelector('.cap')!;
    this.cur = pane.querySelector('.cur')!;
    this.prev = pane.querySelector('[data-act="prev"]')!;
    this.next = pane.querySelector('[data-act="next"]')!;
    this.prev.onclick = () => this.setStep(this.step - 1);
    this.next.onclick = () => this.setStep(this.step + 1);
    nav.bindKeys(this.paper, (act) => {
      if (!this.pointing) {
        if (act === 'ok') { this.setPointing(true); return true; }
        return false;
      }
      if (act === 'back') { this.setPointing(false); return true; }
      if (act === 'ok') { this.point(this.pcur[0], this.pcur[1]); return true; }
      const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[act as string];
      if (d) {
        this.pcur = [
          Math.max(0.04, Math.min(0.96, this.pcur[0] + d[0]! * 0.08)),
          Math.max(0.04, Math.min(0.96, this.pcur[1] + d[1]! * 0.08)),
        ];
        this.placeCur();
        return true;
      }
      return false;
    });
    this.paper.addEventListener('blur', () => this.setPointing(false));
    this.paper.addEventListener('pointerdown', (e) => {
      const r = this.paper.getBoundingClientRect();
      this.point((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
  }

  start(): void {
    this.step = 0;
    this.pointing = false;
  }
  show(): void {
    this.render();
  }
  stop(): void {}
  focusTarget(): HTMLElement {
    return this.paper;
  }
  hint(active: Element | null): string | null {
    if (active !== this.paper) return null;
    return this.pointing
      ? nav.K('方向键', '挪光点') + nav.K('确定', '点亮') + nav.K('返回', '不指了')
      : nav.K('确定', '指一指') + nav.K('◀▶', '翻页') + nav.K('返回', '菜单');
  }
  badge() {
    return { icon: this.icon, text: `折纸 第 ${this.step + 1} 步`, hot: false };
  }

  onMessage(m: AnyMessage): void {
    if (m.t === 'step') this.setStep((m as StepMsg).n, false);
    else if (m.t === 'point') {
      const p = m as PointMsg;
      this.light(p.x, p.y);
    }
  }

  private render(): void {
    const [cap, art] = STEPS[this.step]!;
    this.art.innerHTML = `<svg viewBox="0 0 200 150"><g filter="url(#rough)" class="hand" stroke-width="2">${art}</g></svg>`;
    this.cap.innerHTML = `<b>${this.step + 1}/${STEPS.length}</b>${cap}`;
    this.prev.disabled = this.step === 0;
    this.next.disabled = this.step === STEPS.length - 1;
    this.prev.style.opacity = this.step === 0 ? '.35' : '1';
    this.next.style.opacity = this.step === STEPS.length - 1 ? '.35' : '1';
    this.placeCur();
    this.ctx.badge();
  }
  private setStep(n: number, broadcast = true): void {
    const v = Math.max(0, Math.min(STEPS.length - 1, n | 0));
    if (v === this.step && !broadcast) return;
    this.step = v;
    this.render();
    if (broadcast) this.ctx.send({ t: 'step', n: v });
  }
  private placeCur(): void {
    this.cur.style.left = this.pcur[0] * 100 + '%';
    this.cur.style.top = this.pcur[1] * 100 + '%';
  }
  private light(x: number, y: number): void {
    if (state.scene !== this.id) return;
    const d = document.createElement('i');
    d.className = 'pt';
    d.style.left = x * 100 + '%';
    d.style.top = y * 100 + '%';
    this.paper.appendChild(d);
    setTimeout(() => d.remove(), 1900);
  }
  private point(x: number, y: number): void {
    this.light(x, y);
    this.ctx.send({ t: 'point', x, y });
  }
  private setPointing(on: boolean): void {
    this.pointing = on;
    this.paper.classList.toggle('pointing', on);
    this.placeCur();
    this.ctx.hint();
  }
}

export const origami = new Origami();
