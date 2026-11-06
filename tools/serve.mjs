#!/usr/bin/env node
/* Serves _site/ on http://localhost:8000 the way GitHub Pages does: a folder serves its index.html, a folder address
   without the last / is sent to the one with it, and anything missing gets 404.html (the app, which opens the page itself).
   Run node tools/build-pages.mjs first. Optional: a port, e.g. node tools/serve.mjs 8125 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '_site');
const PORT = +process.argv[2] || 8000;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json'};
const send = async (res, file, status = 200) => {
  res.writeHead(status, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
  res.end(await fs.readFile(file));
};
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), rel = decodeURIComponent(url.pathname);
  const file = path.join(OUT, rel);
  if (!file.startsWith(OUT)) { res.writeHead(400); return res.end(); }
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) {
      if (!rel.endsWith('/')) { res.writeHead(301, {Location: rel + '/' + url.search}); return res.end(); }
      return await send(res, path.join(file, 'index.html'));
    }
    return await send(res, file);
  } catch { return send(res, path.join(OUT, '404.html'), 404).catch(() => { res.writeHead(404); res.end('Not found'); }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Serving _site/ on http://localhost:${PORT}`));
