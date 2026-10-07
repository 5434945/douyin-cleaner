import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  if (url.pathname === '/tests/popup-preview.html') {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace('<head>', '<head><base href="/">').replace('<script src="core.js">', '<script src="tests/popup-mock.js"></script><script src="core.js">');
    response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }).end(html); return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
}).listen(8765, '127.0.0.1', () => console.log('Tests: http://127.0.0.1:8765/tests/fixture.html\nPopup preview: http://127.0.0.1:8765/tests/popup-preview.html'));
