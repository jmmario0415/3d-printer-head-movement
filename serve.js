'use strict';
// Dependency-free local preview. Bind only to loopback; never proxies hardware requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function createServer() {
  const allowed = new Set(['index.html', 'style.css', 'app.js', 'mock-api.js', 'robot-api.js', 'commissioning-config.js', 'commissioning-ui.js']);
  return http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!allowed.has(name)) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(__dirname, name)).pipe(res);
  });
}
if (require.main === module) createServer().listen(8765, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:8765'));
module.exports = { createServer };
