#!/usr/bin/env node
/**
 * ULTRAMAX guard — PreToolUse hook on Agent/Task.
 *
 * When ULTRAMAX mode is active for THIS session (the user typed `ultramax` in the
 * prompt → rational-router-apex wrote ~/.auramaxing/ultramax.json {sessionId, ts}),
 * any subagent spawn that requests a NON-Fable model is hard-blocked, forcing the
 * whole task to run on Fable 5 exclusively — no delegation to Sonnet/Haiku/box.
 *
 * Allowed while active: Agent/Task calls with NO model param (inherit the Fable
 * session default) or model containing "fable". Everything else → block with a
 * message telling the model to re-issue without a model param.
 *
 * Fail-open by design: missing/stale/mismatched flag, parse errors, or
 * AURA_ULTRAMAX_OFF=1 → approve. Never wedges a session.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FRESH_SEC = 7200; // 2h — a flag older than this is treated as stale (not enforcing)

function approve() { console.log('{"decision":"approve"}'); process.exit(0); }

async function main() {
  if (process.env.AURA_ULTRAMAX_OFF === '1') return approve();

  let raw = '';
  try {
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const ch of process.stdin) chunks.push(ch);
      raw = Buffer.concat(chunks).toString('utf8').trim();
    }
  } catch { return approve(); }
  if (!raw) return approve();

  let payload;
  try { payload = JSON.parse(raw); } catch { return approve(); }

  const tool = String(payload.tool_name || '').toLowerCase();
  if (tool !== 'agent' && tool !== 'task') return approve();

  const sid   = payload.session_id || '';
  const input = payload.tool_input || {};

  // Is ULTRAMAX active for THIS session and fresh? (flag path overridable for tests)
  const flagPath = process.env.AURA_ULTRAMAX_FLAG || join(homedir(), '.auramaxing', 'ultramax.json');
  let flag;
  try { flag = JSON.parse(readFileSync(flagPath, 'utf8')); }
  catch { return approve(); }                       // no flag → normal mode
  if (!flag || flag.sessionId !== sid) return approve();
  const age = Math.floor(Date.now() / 1000) - (flag.ts || 0);
  if (age > FRESH_SEC) return approve();             // stale → stop enforcing

  // Inspect the requested model.
  const model = String(input.model || '').trim().toLowerCase();
  if (!model) return approve();                      // inherits Fable session default → OK
  if (model.includes('fable')) return approve();     // explicitly Fable → OK

  // Non-Fable model requested while ULTRAMAX is active → BLOCK.
  console.log(JSON.stringify({
    decision: 'block',
    reason: `[ULTRAMAX] This task is locked to Fable 5 — delegation to "${model}" is blocked. ` +
            `Re-issue this Agent/Task call WITHOUT a model parameter so it inherits the Fable 5 ` +
            `session default, and do the work on Fable. (One-time override: AURA_ULTRAMAX_OFF=1.)`,
  }));
  process.exit(0);
}

main().catch(() => approve());
