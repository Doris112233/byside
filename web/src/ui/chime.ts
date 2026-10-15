// 来电铃声：两个正弦音，每 2.8 秒一遍
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function ding(): void {
  ctx = ctx ?? new AudioContext();
  const now = ctx.currentTime;
  for (const [f, dt] of [[660, 0], [880, 0.2]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, now + dt);
    g.gain.linearRampToValueAtTime(0.16, now + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + dt + 1);
    o.connect(g).connect(ctx.destination);
    o.start(now + dt);
    o.stop(now + dt + 1.1);
  }
}

export function start(): void {
  stop();
  try { ding(); } catch { /* 没有用户手势时浏览器不让出声，静默 */ }
  timer = setInterval(() => { try { ding(); } catch { /* 同上 */ } }, 2800);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
