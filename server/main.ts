// Entry point: one node:http server for Render that serves the built app (dist/) and the Summon API (summon
// REQ-5). API logic is in handler.ts and adapter.ts; file serving is in static.ts.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generate } from '../src/summon/gemini.js';
import { clientIp, maskIp, plainHeaders, readBody } from './adapter.js';
import { readConfig, type Env } from './config.js';
import { createHandler } from './handler.js';
import { createStaticFiles } from './static.js';

/** Gemini call budget on the server (the browser waits up to 150 s, including a cold start). */
const SERVER_GEMINI_TIMEOUT_MS = 60_000;

const nodeProcess = (globalThis as unknown as { process: { env: Env; exitCode?: number } }).process;

const config = readConfig(nodeProcess.env, message => console.warn(`[config] ${message}`));
const handle = createHandler({
  config,
  now: () => new Date(),
  generate: prompt =>
    generate({ apiKey: config.apiKey ?? '', model: config.model, prompt, timeoutMs: SERVER_GEMINI_TIMEOUT_MS }),
});
const serveFile = config.staticDir === null ? null : createStaticFiles(config.staticDir);

const isApi = (path: string) => path === '/api' || path.startsWith('/api/');

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const started = Date.now();
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const path = url.split('?')[0];
  void (async () => {
    let status = 500;
    let kind = '-';
    try {
      if (isApi(path)) {
        const { body, tooLarge } = await readBody(req);
        const response = await handle({
          method,
          path: url,
          headers: plainHeaders(req.headers),
          body,
          bodyTooLarge: tooLarge,
          ip,
        });
        status = response.status;
        kind = response.kind ?? '-';
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } else if (serveFile) {
        req.resume();
        const response = await serveFile(method, url);
        status = response.status;
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } else {
        req.resume();
        status = 404;
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found.');
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: { kind: 'upstream', message: 'Internal server error.' } }));
      }
    } finally {
      // No prompts, scripts, keys or full IPs in the log (REQ-5.7). Only API requests are logged.
      if (isApi(path)) console.log(`${method} ${path} ${status} ${kind} ${Date.now() - started}ms ${maskIp(ip)}`);
    }
  })();
});

server.requestTimeout = 180_000;
server.on('error', error => {
  console.error(`[server] ${error.message}`);
  nodeProcess.exitCode = 1;
});
server.listen(config.port, () => {
  console.log(
    `NecroCard server on port ${config.port} (model ${config.model}, key ${config.apiKey ? 'set' : 'missing'}, ` +
      `caps ${config.dailyCap}/day ${config.perIpCap}/ip, origins ${config.allowedOrigins.join(' ') || 'none'}, ` +
      `app ${config.staticDir ?? 'off'})`,
  );
});
