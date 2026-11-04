// Entry point: node:http server for Summon on Render (summon REQ-5). All logic is in handler.ts and adapter.ts.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generate } from '../src/summon/gemini.js';
import { clientIp, maskIp, plainHeaders, readBody } from './adapter.js';
import { readConfig, type Env } from './config.js';
import { createHandler } from './handler.js';

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

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const started = Date.now();
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  const path = (req.url ?? '/').split('?')[0];
  void (async () => {
    let status = 500;
    let kind = '-';
    try {
      const { body, tooLarge } = await readBody(req);
      const response = await handle({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: plainHeaders(req.headers),
        body,
        bodyTooLarge: tooLarge,
        ip,
      });
      status = response.status;
      kind = response.kind ?? '-';
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: { kind: 'upstream', message: 'Internal server error.' } }));
      }
    } finally {
      // No prompts, scripts, keys or full IPs in the log (REQ-5.7).
      console.log(`${req.method ?? '-'} ${path} ${status} ${kind} ${Date.now() - started}ms ${maskIp(ip)}`);
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
      `caps ${config.dailyCap}/day ${config.perIpCap}/ip, origins ${config.allowedOrigins.join(' ') || 'none'})`,
  );
});
