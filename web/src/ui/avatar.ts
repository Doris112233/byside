// 手绘头像：四款，按名字散列选一个
const AV = ['av-granny', 'av-grandpa', 'av-kid', 'av-mom'] as const;

export function avatarFor(s: string): string {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV[h % AV.length]!;
}

export function avatarSVG(s: string): string {
  return `<svg viewBox="0 0 92 92"><use href="#${avatarFor(s)}"/></svg>`;
}
