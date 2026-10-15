#!/usr/bin/env node
/**
 * CultureRisk AI — zero-dependency local server.
 *
 * Serves public/ and routes /api/<name> to netlify/functions/<name>.js using
 * the same (event) → {statusCode, headers, body} contract Netlify uses, so
 * the app runs locally without the Netlify CLI:
 *
 *   npm start            # http://localhost:8888
 *
 * Reads keys from the environment or a local .env file (never committed).
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8888;

// Minimal .env loader (KEY=VALUE lines; existing env wins).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const FUNCTIONS = new Set(fs.readdirSync(path.join(ROOT, 'netlify/functions')).map((f) => f.replace(/\.js$/, '')));

async function handleApi(req, res, name, url) {
  if (!FUNCTIONS.has(name)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: Buffer.concat(chunks).toString('utf8'),
    isBase64Encoded: false,
  };
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { handler } = require(path.join(ROOT, 'netlify/functions', `${name}.js`));
  const out = await handler(event);
  res.writeHead(out.statusCode, out.headers);
  res.end(out.body);
}

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z_]+)\/?$/);
    if (api) return await handleApi(req, res, api[1], url);
    return serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'error', message: 'Local server error' }));
  }
}).listen(PORT, () => {
  console.log(`CultureRisk AI running at http://localhost:${PORT}`);
  console.log(`  Qloo data: ${process.env.QLOO_HACKATHON_API_KEY ? 'live (key set)' : 'simulated (no QLOO_HACKATHON_API_KEY)'}`);
});
