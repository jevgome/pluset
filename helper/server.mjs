// Pluset helper: lets the extension use Claude Code (and your Claude plan) instead of an API key.
//
//   npm run helper            start it (keep the terminal open)
//
// It listens only on this computer (127.0.0.1) and only accepts requests carrying the token
// it prints at startup, which you paste into Pluset's AI settings once. Requests from web
// pages are refused. Claude Code runs with no tools, so it can only return text.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ALLOWED_EFFORT, ALLOWED_MODELS, ClaudeError, runClaude } from './claude.mjs';

const VERSION = 1;
const MAX_BODY = 8 * 1024 * 1024;

export function loadOrCreateToken(file) {
  try {
    const t = readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch {
    /* create below */
  }
  const token = randomBytes(24).toString('base64url');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function tokenMatches(header, token) {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new ClaudeError('too_large', 'Request too large.');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Creates the HTTP server. `run` is injectable for tests. */
export function createHelper({ token, run = runClaude, log = () => {} }) {
  let queue = Promise.resolve(); // one Claude Code run at a time

  return createServer(async (req, res) => {
    // Only the extension may call us: browsers attach an Origin to cross-site requests,
    // and web pages can't be allowed to trigger runs on your plan.
    const origin = req.headers.origin;
    if (origin && !origin.startsWith('chrome-extension://')) return send(res, 403, { error: 'Requests from web pages are not allowed.' });
    if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: 'Missing or wrong helper token.' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, version: VERSION });
    if (req.method !== 'POST' || url.pathname !== '/v1/json') return send(res, 404, { error: 'Not found.' });

    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return send(res, 400, { error: e instanceof ClaudeError ? e.message : 'Invalid JSON body.' });
    }
    const { model, system, schema, effort, prompt } = body ?? {};
    if (!ALLOWED_MODELS.has(model)) return send(res, 400, { error: `Unsupported model "${model}".` });
    if (effort !== undefined && !ALLOWED_EFFORT.has(effort)) return send(res, 400, { error: `Unsupported effort "${effort}".` });
    if (typeof system !== 'string' || typeof prompt !== 'string' || !schema || typeof schema !== 'object') {
      return send(res, 400, { error: 'Expected model, system, prompt and schema.' });
    }

    // Stop the run if the extension cancels or closes the connection.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const job = queue.then(async () => {
      if (controller.signal.aborted) throw new ClaudeError('cancelled', 'Cancelled.');
      log(`→ ${model}${effort ? ` (${effort})` : ''}, ${Math.round(prompt.length / 1000)}k chars`);
      const started = Date.now();
      const result = await run({ model, system, schema, effort, prompt, signal: controller.signal });
      log(`✓ done in ${Math.round((Date.now() - started) / 1000)} s`);
      return result;
    });
    queue = job.catch(() => {});

    try {
      send(res, 200, await job);
    } catch (e) {
      const kind = typeof e?.kind === 'string' ? e.kind : 'other';
      log(`✗ ${e.message}`);
      if (!res.writableEnded) send(res, kind === 'rate_limit' ? 429 : kind === 'cancelled' ? 499 : 502, { error: e.message, kind });
    }
  });
}

// Started directly: `node helper/server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PLUSET_HELPER_PORT || 48230);
  const tokenFile = join(homedir(), '.config', 'pluset', 'helper-token');
  const token = loadOrCreateToken(tokenFile);
  const server = createHelper({ token, log: (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`) });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Pluset helper running at http://localhost:${port}`);
    console.log(`\nIn Pluset → AI settings, choose "Claude Code (your Claude plan)" and paste this token:\n\n  ${token}\n`);
    console.log(`(Saved in ${tokenFile}. Keep this window open while generating. Ctrl+C to stop.)`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use. Is the helper already running?` : e.message);
    process.exit(1);
  });
}
