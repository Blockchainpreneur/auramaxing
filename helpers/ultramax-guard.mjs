#!/usr/bin/env node
/**
 * OPUS-MAX + delegation-quality guard — PreToolUse hook on Agent/Task/Workflow.
 *
 * OPUS-ONLY WINDOW (the standing default — user directive 2026-06-12): while
 * ~/.auramaxing/opus-window.json has an `until` date in the future, EVERYTHING runs
 * on Opus 4.8 at MAXIMUM presets — main session AND every delegated/parallel agent.
 * Any Agent/Task/Workflow spawn requesting a non-Opus model (sonnet/haiku/fable) is
 * blocked OUTRIGHT, and every spawn prompt MUST contain "ultrathink" (max extended
 * thinking). Allowed: model:"opus" or no model param (inherits the Opus session
 * default). Delete the window file to fall back to normal delegation.
 *
 * NORMAL MODE (window absent/expired, no ultramax flag): any Agent/Task spawn that
 * explicitly targets a CHEAPER worker (model contains "sonnet"/"haiku") must carry the
 * 10x forced-diligence frame — the prompt MUST include "ultrathink" AND the
 * ZERO-TOLERANCE frame (the 8 rules per the aura-delegate harness). Opus/inherit
 * spawns pass untouched.
 *
 * When ULTRAMAX mode is active for THIS session (the user typed `ultramax` in the
 * prompt → rational-router-apex wrote ~/.auramaxing/ultramax.json {sessionId, ts}),
 * the task is locked to an OPUS-4.8-ONLY fleet at MAXIMUM capability presets:
 *
 *  1. MODEL LOCK — any Agent/Task spawn requesting a NON-Opus model is blocked.
 *     Allowed: no model param (inherits the Opus session default) or model
 *     containing "opus".
 *  2. MAX-THINKING LOCK — every Agent/Task spawn prompt MUST contain "ultrathink"
 *     so the delegated Opus agent runs with its maximum extended-thinking budget.
 *     A spawn without it is blocked with instructions to re-issue.
 *  3. WORKFLOW LOCK — Workflow scripts must not override agents onto a non-Opus
 *     model (`model: "sonnet"|"haiku"|"fable"` in agent()/meta.phases is blocked);
 *     omitting model inherits Opus, which is correct.
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
  let umxActive = false;
  try {
    const flag = JSON.parse(readFileSync(flagPath, 'utf8'));
    const age = Math.floor(Date.now() / 1000) - ((flag && flag.ts) || 0);
    umxActive = !!flag && flag.sessionId === sid && age <= FRESH_SEC;
  } catch { /* no flag → normal mode */ }

  const DILIGENCE = /ultrathink/i;
  const FRAME = /zero[\s-]?tolerance/i;

  // OPUS-ONLY WINDOW: until the date in opus-window.json, ALL spawns run on Opus 4.8 —
  // any non-Opus model (sonnet/haiku/fable) is blocked OUTRIGHT, and every spawn prompt
  // must carry "ultrathink". User directive 2026-06-12. Delete the file to end it early.
  let opusWindow = false;
  try {
    const fw = JSON.parse(readFileSync(process.env.AURA_OPUS_WINDOW || join(homedir(), '.auramaxing', 'opus-window.json'), 'utf8'));
    const deadline = fw.until && (/[T ]\d/.test(fw.until) ? Date.parse(fw.until) : Date.parse(fw.until + 'T05:00:00Z')); // date-only → midnight Cancun (UTC-5); else use given time
    opusWindow = !!deadline && !Number.isNaN(deadline) && Date.now() < deadline;
  } catch {}
  if (opusWindow) {
    if (tool === 'workflow') {
      const m = String(input.script || '').match(/model\s*:\s*["'`]\s*(sonnet|haiku|fable)[a-z0-9._-]*\s*["'`]/i);
      if (m) return block(`[OPUS-ONLY WINDOW] ALL delegation runs on Opus 4.8 at max — remove the "${m[1]}" override (omit model: to inherit Opus, or set model:"opus") and re-issue. Every agent() prompt must also include "ultrathink".`);
      return approve();
    }
    const model = String(input.model || '').trim().toLowerCase();
    if (model && !model.includes('opus')) {
      return block(`[OPUS-ONLY WINDOW] ALL delegation runs on Opus 4.8 at maximum spec — "${model}" is blocked. Re-issue this SAME spawn with model:"opus" (or omit model: to inherit the Opus session default) and keep "ultrathink" in the prompt.`);
    }
    const prompt = String(input.prompt || '');
    if (!/ultrathink/i.test(prompt)) {
      return block(`[OPUS-ONLY WINDOW] Opus 4.8 fleet spawns must run at MAXIMUM thinking — re-issue this SAME ${tool} call with the word "ultrathink" in the agent's prompt (e.g. prefix "ultrathink. ") so the delegated Opus agent engages its maximum extended-thinking budget. Keep model:"opus" or omit it to inherit Opus. (One-time override: AURA_ULTRAMAX_OFF=1.)`);
    }
    return approve();
  }

  if (!umxActive) {
    // ── NORMAL MODE: cheap workers only ship under the 10x forced-diligence frame ──
    if (tool === 'workflow') {
      const script = String(input.script || '');
      if (/model\s*:\s*["'`]\s*(sonnet|haiku)/i.test(script) && !(DILIGENCE.test(script) && FRAME.test(script))) {
        return block(
          `[AURA-DELEGATE] Sonnet/Haiku workflow agents only run under the 10x forced-diligence frame — ` +
          `every cheap-worker agent() prompt in the script must include "ultrathink" (max extended thinking) ` +
          `AND the ZERO-TOLERANCE frame (the 8 rules + Tier-2 micro-loop per the aura-delegate harness). ` +
          `Re-issue the workflow with both embedded.`
        );
      }
      return approve();
    }
    const model = String(input.model || '').trim().toLowerCase();
    if (/sonnet|haiku/.test(model)) {
      const prompt = String(input.prompt || '');
      if (!(DILIGENCE.test(prompt) && FRAME.test(prompt))) {
        return block(
          `[AURA-DELEGATE] A "${model}" worker is only useful next to Opus under 10x FORCED DILIGENCE — ` +
          `re-issue this SAME spawn with BOTH in the worker prompt: (1) the word "ultrathink" (engages the ` +
          `worker's MAXIMUM extended-thinking budget) and (2) the ZERO-TOLERANCE frame (paste the 8 rules + ` +
          `Tier-2 micro-loop + acceptance test + evidence contract, per the aura-delegate harness). ` +
          `Bare specs to cheap workers are banned.`
        );
      }
    }
    return approve();
  }

  // ── 3. WORKFLOW LOCK ────────────────────────────────────────────────────
  if (tool === 'workflow') {
    const script = String(input.script || '');
    const m = script.match(/model\s*:\s*["'`]\s*(?!opus)([a-z0-9._-]+)\s*["'`]/i);
    if (m) {
      return block(
        `[ULTRAMAX] This task is locked to an Opus-4.8-only fleet — the workflow script ` +
        `overrides an agent onto "${m[1]}". Remove every non-Opus \`model:\` override ` +
        `(omit it to inherit Opus 4.8, or set model: "opus") and re-issue. Every agent ` +
        `prompt in the script must also include "ultrathink" for max extended thinking. ` +
        `(One-time override: AURA_ULTRAMAX_OFF=1.)`
      );
    }
    return approve();
  }

  // ── 1. MODEL LOCK (Agent/Task) ──────────────────────────────────────────
  const model = String(input.model || '').trim().toLowerCase();
  if (model && !model.includes('opus')) {
    return block(
      `[ULTRAMAX] This task is locked to Opus 4.8 — delegation to "${model}" is blocked. ` +
      `Re-issue this Agent/Task call WITHOUT a model parameter (inherits the Opus 4.8 ` +
      `session default) or with model:"opus", and include "ultrathink" in the agent ` +
      `prompt for max extended thinking. (One-time override: AURA_ULTRAMAX_OFF=1.)`
    );
  }

  // ── 2. MAX-THINKING LOCK (Agent/Task) ───────────────────────────────────
  // Every delegated Opus agent must run at max extended thinking: the spawn prompt
  // must carry the "ultrathink" trigger. (Description fields don't count.)
  const prompt = String(input.prompt || '');
  if (!/ultrathink/i.test(prompt)) {
    return block(
      `[ULTRAMAX] Opus-4.8 fleet spawns must run at MAXIMUM thinking — re-issue this ` +
      `SAME Agent/Task call with the word "ultrathink" included in the agent's prompt ` +
      `(e.g. prefix it with "ultrathink. ") so the delegated Opus agent engages its ` +
      `maximum extended-thinking budget. Keep the model parameter omitted or "opus". ` +
      `(One-time override: AURA_ULTRAMAX_OFF=1.)`
    );
  }

  return approve();
}

main().catch(() => approve());
