// Local dev server: serves static files and mounts the real API handlers
// over HTTP, so the widget and site can be tested end to end without the
// Vercel CLI. Run: npm run dev:local  (uses GROQ key from .env)
const http = require('http');
const fs = require('fs');
const path = require('path');

require('./env');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3009);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Load handlers lazily so a syntax error in one does not kill the server.
const handlers = {};

function loadHandler(name) {
  if (!handlers[name]) {
    try {
      handlers[name] = require(path.join(__dirname, '..', 'api', name));
    } catch (err) {
      console.error('Failed to load api/' + name + ':', err.message);
      handlers[name] = null;
    }
  }
  return handlers[name];
}

// API handlers are written against Vercel's Express-like response surface
// (res.status(...).json(...)). Wrap the raw Node response to provide it.
function compatRes(res) {
  return {
    setHeader: (k, v) => res.setHeader(k, v),
    status: (code) => {
      res.statusCode = code;
      return compatRes(res);
    },
    json: (obj) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    },
    write: (chunk) => res.write(chunk),
    end: (chunk) => res.end(chunk),
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice('/api/'.length) + '.js';
    const handler = loadHandler(name);
    if (!handler) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.end('bad json');
          return;
        }
      }
      handler(req, compatRes(res));
    });
    return;
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  // never serve dotfiles/folders (.env, .data/leads.json, .git)
  if (file.split('/').some((part) => part.startsWith('.'))) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const fp = path.join(ROOT, file);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, () => console.log('InterioArty dev server: http://localhost:' + PORT));