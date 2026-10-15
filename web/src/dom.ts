// 小工具：取元素、转义、延后一帧
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 不在页面上`);
  return el as T;
};

export const soon = (fn: () => void): void => {
  setTimeout(fn, 30);
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ESC[c] ?? c);

export const icon = (href: string, cls = ''): string =>
  `<svg viewBox="0 0 48 48"${cls ? ` class="${cls}"` : ''}><use href="${href}"/></svg>`;

export const isTable = (): boolean => document.body.classList.contains('table');
