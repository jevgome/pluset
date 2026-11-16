// Runs one headless Claude Code request (`claude -p`) that returns JSON matching a
// schema. Uses whatever login Claude Code has (e.g. a Pro subscription).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ALLOWED_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
export const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);

/** Command-line arguments for a tool-less, settings-isolated, structured-output run. */
export function buildArgs({ model, system, schema, effort }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    // No tools at all: it can only write text, never read files or run commands.
    '--tools', '',
    '--system-prompt', system,
    '--model', model,
    '--no-session-persistence',
    '--strict-mcp-config',
  ];
  if (effort) args.push('--effort', effort);
  return args;
}

export class ClaudeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Interprets `claude -p --output-format json` output. */
export function parseResult(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new ClaudeError('bad_output', `Claude Code returned unexpected output: ${stdout.slice(0, 300)}`);
  }
  if (out.is_error || out.subtype !== 'success') {
    const msg = String(out.result || out.subtype || 'unknown error');
    const kind = /limit|quota|usage/i.test(msg) ? 'rate_limit' : /log ?in|auth|credential/i.test(msg) ? 'auth' : 'other';
    throw new ClaudeError(kind, `Claude Code: ${msg}`);
  }
  let data = out.structured_output;
  if (data === undefined) {
    try {
      data = JSON.parse(out.result);
    } catch {
      throw new ClaudeError('bad_output', 'Claude Code did not return structured JSON.');
    }
  }
  const u = out.usage ?? {};
  return {
    data,
    model: Object.keys(out.modelUsage ?? {})[0] ?? '',
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Runs Claude Code with `prompt` on stdin. `signal` aborts (kills) the run.
 * Runs in an empty temporary directory so no project files or instructions are picked up.
 */
export function runClaude({ bin = 'claude', model, system, schema, effort, prompt, signal, timeoutMs = 10 * 60_000 }) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'pluset-'));
    const child = spawn(bin, buildArgs({ model, system, schema, effort }), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rmSync(cwd, { recursive: true, force: true });
      fn();
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      finish(() => reject(new ClaudeError('cancelled', 'Cancelled.')));
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new ClaudeError('timeout', `Claude Code took longer than ${Math.round(timeoutMs / 60000)} minutes.`)));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) =>
      finish(() =>
        reject(new ClaudeError('not_found', e.code === 'ENOENT' ? `Couldn't find the "${bin}" command. Is Claude Code installed?` : e.message)),
      ),
    );
    child.on('close', (code) =>
      finish(() => {
        try {
          resolve(parseResult(stdout));
        } catch (e) {
          if (code !== 0 && !stdout.trim()) reject(new ClaudeError('other', `Claude Code exited with code ${code}: ${stderr.trim().slice(0, 400)}`));
          else reject(e);
        }
      }),
    );
    child.stdin.end(prompt);
  });
}
