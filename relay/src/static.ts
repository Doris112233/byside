/* 静态文件：只服务两个目录。/app/ → web/dist（构建产物），其余 → docs/（介绍页）。
   以前是整个仓库根目录对外，agora.env、key.pem、.git 都能下载 —— 不能再那样。 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticDirs { app: string; site: string }

/** 把 URL 路径解析成磁盘文件；越界、隐藏文件、根目录外一律 null */
export function resolveStatic(dirs: StaticDirs, urlPath: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  let root = dirs.site;
  if (p === '/app' || p.startsWith('/app/')) {
    root = dirs.app;
    p = p.slice(4) || '/';
  }
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root + path.sep)) return null;
  if (file.split(path.sep).some((seg) => seg.startsWith('.'))) return null;
  return file;
}

export function serveStatic(dirs: StaticDirs) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const file = resolveStatic(dirs, req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  };
}
