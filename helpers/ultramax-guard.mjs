#!/usr/bin/env node
/**
 * ULTRAMAX guard — PreToolUse hook on Agent/Task/Workflow.
 *
 * When ULTRAMAX mode is active for THIS session (the user typed `ultramax` in the
 * prompt → rational-router-apex wrote ~/.auramaxing/ultramax.json {sessionId, ts}),
 * the task is locked to a FABLE-5-ONLY fleet at MAXIMUM capability presets:
 *
 *  1. MODEL LOCK — any Agent/Task spawn requesting a NON-Fable model is blocked.
 *     Allowed: no model param (inherits the Fable session default) or model
 *     containing "fable".
 *  2. MAX-THINKING LOCK — every Agent/Task spawn prompt MUST contain "ultrathink"
 *     so the delegated Fable agent runs with its maximum extended-thinking budget.
 *     A spawn without it is blocked with instructions to re-issue.
 *  3. WORKFLOW LOCK — Workflow scripts must not override agents onto a non-Fable
 *     model (`model: "sonnet"|"haiku"|"opus"` in agent()/meta.phases is blocked);
 *     omitting model inherits Fable, which is correct.
 *
 * Fail-open by design: missing/stale/mismatched flag, parse errors, or
 * AURA_ULTRAMAX_OFF=1 → approve. Never wedges a session.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FRESH_SEC = 7200; // 2h — a flag older than this is treated as stale (not enforcing)

function approve() { console.log('{"decision":"approve"}'); process.exit(0); }
function block(reason) {
  // Dual-format: modern PreToolUse schema (hookSpecificOutput.permissionDecision)
  // + legacy top-level decision/reason — covers every CLI version either way.
  console.log(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

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
  if (tool !== 'agent' && tool !== 'task' && tool !== 'workflow') return approve();

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

  // ── 3. WORKFLOW LOCK ────────────────────────────────────────────────────
  if (tool === 'workflow') {
    const script = String(input.script || '');
    const m = script.match(/model\s*:\s*["'`]\s*(?!fable)([a-z0-9._-]+)\s*["'`]/i);
    if (m) {
      return block(
        `[ULTRAMAX] This task is locked to a Fable-5-only fleet — the workflow script ` +
        `overrides an agent onto "${m[1]}". Remove every non-Fable \`model:\` override ` +
        `(omit it to inherit Fable 5, or set model: "fable") and re-issue. Every agent ` +
        `prompt in the script must also include "ultrathink" for max extended thinking. ` +
        `(One-time override: AURA_ULTRAMAX_OFF=1.)`
      );
    }
    return approve();
  }

  // ── 1. MODEL LOCK (Agent/Task) ──────────────────────────────────────────
  const model = String(input.model || '').trim().toLowerCase();
  if (model && !model.includes('fable')) {
    return block(
      `[ULTRAMAX] This task is locked to Fable 5 — delegation to "${model}" is blocked. ` +
      `Re-issue this Agent/Task call WITHOUT a model parameter (inherits the Fable 5 ` +
      `session default) or with model:"fable", and include "ultrathink" in the agent ` +
      `prompt for max extended thinking. (One-time override: AURA_ULTRAMAX_OFF=1.)`
    );
  }

  // ── 2. MAX-THINKING LOCK (Agent/Task) ───────────────────────────────────
  // Every delegated Fable agent must run at max extended thinking: the spawn prompt
  // must carry the "ultrathink" trigger. (Description fields don't count.)
  const prompt = String(input.prompt || '');
  if (!/ultrathink/i.test(prompt)) {
    return block(
      `[ULTRAMAX] Fable-5 fleet spawns must run at MAXIMUM thinking — re-issue this ` +
      `SAME Agent/Task call with the word "ultrathink" included in the agent's prompt ` +
      `(e.g. prefix it with "ultrathink. ") so the delegated Fable agent engages its ` +
      `maximum extended-thinking budget. Keep the model parameter omitted or "fable". ` +
      `(One-time override: AURA_ULTRAMAX_OFF=1.)`
    );
  }

  return approve();
}

main().catch(() => approve());
