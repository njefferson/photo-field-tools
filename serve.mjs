// serve.mjs — a static server for the gates.
//
// The built app must be tested over HTTP, not file://: service workers do not
// register on file://, and acceptance §11.1 is entirely about the service
// worker. Doctrine §11 also notes that verifying a deployed build means
// serving it locally.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {string} root directory to serve
 * @returns {Promise<{url:string, close:()=>Promise<void>, requests:string[]}>}
 */
export async function serve(root = 'dist') {
  /** Every path requested, so a gate can assert what the app asked for. */
  const requests = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    // normalize + strip leading separators: a path is never allowed to escape
    // the served root.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\.]+)/, '');
    let file = join(root, rel || 'index.html');
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        // Service-worker registration is refused when the worker is served
        // from a different scope or with a stale cache; no-store keeps every
        // run honest.
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
