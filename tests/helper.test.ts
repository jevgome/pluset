import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { buildArgs, parseResult, runClaude } from '../helper/claude.mjs';
// @ts-expect-error plain JS module without types
import { createHelper } from '../helper/server.mjs';

describe('buildArgs', () => {
  it('runs tool-less, structured, without session persistence', () => {
    const args: string[] = buildArgs({ model: 'claude-opus-5-5', system: 'sys', schema: { type: 'object' }, effort: 'high' });
    expect(args).toEqual([
      '-p', '--output-format', 'json', '--json-schema', '{"type":"object"}', '--tools', '', '--system-prompt', 'sys',
      '--model', 'claude-opus-5-5', '--no-session-persistence', '--strict-mcp-config', '--effort', 'high',
    ]);
  });
});

describe('parseResult', () => {
  it('reads structured output and usage', () => {
    const out = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: '{"a":1}', structured_output: { a: 1 },
      usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
      modelUsage: { 'claude-opus-5-5': {} },
    });
    expect(parseResult(out)).toEqual({
      data: { a: 1 },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 3 },
    });
  });

  it('falls back to parsing the result text', () => {
    expect(parseResult(JSON.stringify({ subtype: 'success', is_error: false, result: '{"b":2}' })).data).toEqual({ b: 2 });
  });

  it('classifies errors', () => {
    expect(() => parseResult(JSON.stringify({ subtype: 'success', is_error: true, result: 'Claude usage limit reached' }))).toThrow(
      expect.objectContaining({ kind: 'rate_limit' }),
    );
    expect(() => parseResult('not json')).toThrow(expect.objectContaining({ kind: 'bad_output' }));
  });
});

describe('runClaude with a fake claude binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pluset-test-'));
  const fake = join(dir, 'claude');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  if (input.includes('SLEEP')) return setTimeout(() => {}, 60000);
  console.log(JSON.stringify({ subtype: 'success', is_error: false, result: '', structured_output: { prompt: input, toolsArg: args[args.indexOf('--tools') + 1], cwdEmpty: require('fs').readdirSync('.').length === 0 }, usage: {} }));
});
`,
  );
  chmodSync(fake, 0o755);

  it('passes the prompt on stdin, disables tools and runs in an empty directory', async () => {
    const r = await runClaude({ bin: fake, model: 'claude-haiku-5-5', system: 's', schema: {}, prompt: 'hello book' });
    expect(r.data).toEqual({ prompt: 'hello book', toolsArg: '', cwdEmpty: true });
  });

  it('kills the run when aborted or timed out', async () => {
    const controller = new AbortController();
    const p = runClaude({ bin: fake, model: 'claude-haiku-5-5', system: 's', schema: {}, prompt: 'SLEEP', signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(runClaude({ bin: fake, model: 'claude-haiku-5-5', system: 's', schema: {}, prompt: 'SLEEP', timeoutMs: 300 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('reports a missing claude command clearly', async () => {
    await expect(runClaude({ bin: join(dir, 'nope'), model: 'claude-haiku-5-5', system: 's', schema: {}, prompt: 'x' })).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('helper server', () => {
  const token = 'test-token-0123456789abcdefghijklmnop';
  let base = '';
  let server: import('node:http').Server;
  const calls: unknown[] = [];

  beforeAll(async () => {
    server = createHelper({
      token,
      run: async (job: { model: string; prompt: string; signal: AbortSignal }) => {
        calls.push(job.model);
        if (job.prompt === 'LIMIT') throw Object.assign(new Error('usage limit reached'), { kind: 'rate_limit' });
        return { data: { ok: true, prompt: job.prompt }, model: job.model, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/json`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const job = { model: 'claude-opus-5-5', system: 's', schema: { type: 'object' }, effort: 'high', prompt: 'p' };

  it('requires the token', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it('refuses requests from web pages even with the token', async () => {
    const res = await post(job, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('accepts the extension and returns the result', async () => {
    const res = await post(job, { origin: 'chrome-extension://abcdefghijklmnop' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true, prompt: 'p' });
  });

  it('validates the request', async () => {
    expect((await post({ ...job, model: 'gpt-x' })).status).toBe(400);
    expect((await post({ ...job, effort: 'max' })).status).toBe(400);
    expect((await post({ ...job, schema: null })).status).toBe(400);
  });

  it('passes errors through with a kind', async () => {
    const res = await post({ ...job, prompt: 'LIMIT' });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ kind: 'rate_limit' });
  });
});
