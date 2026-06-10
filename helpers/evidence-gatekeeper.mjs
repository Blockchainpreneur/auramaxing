#!/usr/bin/env node
/**
 * AURAMAXING Evidence Gatekeeper (Stop hook) — anti-laziness teeth, v2.
 *
 * Verifies OUTCOMES, not utterances. Blocks the turn from ending when:
 *   (Gate 1) source was changed without a PASSING verification, OR
 *   (Gate 2) the session task-ledger still has OPEN items (long-horizon completion).
 *
 * v2 closes the three holes the 10x box-audit confirmed:
 *   - a verify command that FAILED no longer counts (pass/fail awareness on its tool_result);
 *   - `echo test` / `cat tests/x` still don't count (runner must be at command position);
 *   - spawning an agent whose prompt merely contains "review" no longer counts
 *     (an utterance is not an outcome — Task/Agent auto-pass removed).
 *
 * SAFETY (fail-open by design — can never wedge a turn):
 *   - Honors `stop_hook_active` → ALLOW (blocks at most ONCE per turn; no loop).
 *   - Kill-switch: AURA_GATEKEEPER_OFF=1 disables entirely.
 *   - Any parse/IO error → ALLOW. 1.8s hard timeout → ALLOW.
 *   - Ledger ignored unless it is same-session AND fresh (<6h); malformed/missing → ALLOW.
 *   - Only gates real SOURCE files; docs/markdown/json/config excluded.
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ALLOW = () => process.exit(0);
if (process.env.AURA_GATEKEEPER_OFF === '1') ALLOW();
const timeout = setTimeout(ALLOW, Number(process.env.AURA_GK_TIMEOUT_MS) || 1800);

// Source extensions that warrant verification when changed. Docs/config intentionally excluded.
const SRC = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|php|css|scss|sql)$/i;
// Real test/build/lint RUNNERS. Generic verbs match ONLY at command position behind a real runner,
// so `echo test`, `cat tests/x`, `ls test/` do not pass the gate.
const VERIFY_CMD = /\b(vitest|jest|pytest|playwright|tsc|eslint|ruff|mypy|pyright|rspec|phpunit)\b|\bcargo\s+(test|check|clippy)\b|\bgo\s+test\b|\bdotnet\s+test\b|\bdeno\s+(test|check)\b|\bnode\s+--(check|test)\b|(?:^|[;&|]\s*)(?:npm|yarn|pnpm|bun|make)\s+(?:run\s+)?(?:test|build|lint|type-?check|check)\b|\bevals?\/run\.mjs\b/i;
// gstack/skills that count as verification.
const VERIFY_SKILL = new Set(['qa', 'qa-only', 'review', 'cso', 'verify', 'investigate', 'design-review', 'benchmark', 'canary']);
// Failure signals inside a verify command's RESULT.
// FAIL_I (case-insensitive): NON-ZERO-count signals + symbols + specific strings — anchored so a
//   clean "0 failed" / "0 errors" does NOT false-trigger.
// FAIL_CS (case-sensitive): the all-caps runner tokens that ONLY appear on real failure lines
//   ("FAILED test_x", jest "FAIL src/x.test.ts") — kept case-sensitive so lowercase "0 failed" is safe.
const FAIL_I = /\b[1-9]\d*\s+(?:failed|failing|errors?)\b|✗|❌|\berror\s+TS\d|Traceback \(most recent call last\)|AssertionError|\bELIFECYCLE\b|npm error|exit code\s+[1-9]|\bnon-zero exit\b/i;
const FAIL_CS = /\bFAILED\b|\bFAIL\s+\S/;
const isFail = (t) => FAIL_I.test(t) || FAIL_CS.test(t);

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString().trim() || '{}'); } catch { return {}; }
}

const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c || ''));

function analyzeTurn(transcriptPath) {
  const raw = readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  // Find the last GENUINE user prompt (type user, content not a tool_result).
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if ((o.type || o.role) !== 'user') continue;
    if (!text(o.message?.content ?? o.content).includes('tool_result')) { start = i; break; }
  }
  const mutated = [];
  const verifyIds = [];           // tool_use ids of verify Bash commands this turn
  const resultById = {};          // tool_use_id -> result text
  let skillVerified = false;
  for (let i = start; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    const content = o.message?.content ?? o.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item) continue;
      if (item.type === 'tool_result' && item.tool_use_id) { resultById[item.tool_use_id] = text(item.content); continue; }
      if (item.type !== 'tool_use') continue;
      const name = item.name || '';
      const inp = item.input || {};
      if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') {
        const fp = inp.file_path || inp.notebook_path || '';
        if (SRC.test(fp)) mutated.push(fp);
      }
      if (name === 'Bash' && typeof inp.command === 'string' && VERIFY_CMD.test(inp.command)) verifyIds.push(item.id);
      if (name === 'Skill' && VERIFY_SKILL.has((inp.skill || '').toLowerCase())) skillVerified = true;
      // Task/Agent intentionally NOT counted: spawning an agent is an utterance, not an outcome.
    }
  }
  // A verify command counts ONLY if its result is not clearly failing.
  // (Result not captured yet → lean ALLOW, preserving fail-open.)
  const cmdVerified = verifyIds.some(id => !resultById[id] || !isFail(resultById[id]));
  const ranButFailed = verifyIds.length > 0 && !cmdVerified;
  return { mutated: [...new Set(mutated)], verified: cmdVerified || skillVerified, ranButFailed };
}

function openLedger(sessionId) {
  try {
    const p = join(homedir(), '.auramaxing', 'ledger.json');
    if (!existsSync(p)) return null;
    const l = JSON.parse(readFileSync(p, 'utf8'));
    if (!l || !Array.isArray(l.items)) return null;
    if (sessionId && l.sessionId && l.sessionId !== sessionId) return null;     // different session → ignore
    if (l.ts && (Math.floor(Date.now() / 1000) - l.ts) > 6 * 3600) return null; // stale → ignore
    const open = l.items.filter(x => x && !x.done);
    return open.length ? open : null;
  } catch { return null; }
}

function block(reason) { clearTimeout(timeout); process.stdout.write(JSON.stringify({ decision: 'block', reason })); process.exit(0); }

async function main() {
  try {
    const input = await readStdin();
    if (input.stop_hook_active) ALLOW();                  // already blocked once this turn → never loop
    const tp = input.transcript_path;
    if (!tp || !existsSync(tp)) ALLOW();                  // can't inspect → fail-open

    const { mutated, verified, ranButFailed } = analyzeTurn(tp);

    // Gate 1 — source changed without PASSING verification.
    if (mutated.length > 0 && !verified) {
      const sample = mutated.slice(0, 6).map(f => '  - ' + f.replace(homedir(), '~')).join('\n');
      const head = ranButFailed
        ? 'EVIDENCE GATE — do NOT stop. Your verification ran but FAILED (red). You changed source and the test/build did not pass:'
        : 'EVIDENCE GATE — do NOT stop. You changed source code but produced ZERO passing verification this turn:';
      block([head, sample, '',
        'Produce EVIDENCE (not "should work"):',
        '  1. ROOT CAUSE with file:line.',
        '  2. RUN the real check (tests / build / typecheck / lint, or /qa · /review · /cso) and PASTE the PASSING output.',
        '  3. REGRESSION — add/run a test that would have caught this; show it green.',
        '  4. If red, fix and re-run. Loop to 100/100, then stop.',
        'Kill-switch: AURA_GATEKEEPER_OFF=1 only if verification is genuinely impossible here.'].join('\n'));
    }

    // Gate 2 — open session ledger (long-horizon completion forcing).
    const open = openLedger(input.session_id);
    if (open) {
      const items = open.slice(0, 8).map(x => `  [${x.id}] ${x.desc}`).join('\n');
      block(['COMPLETENESS GATE — do NOT stop. The task ledger has OPEN items for this session:',
        items, '',
        'Finish them (or explicitly de-scope with the user). As each completes, mark it:',
        '  node ~/.claude/helpers/ledger.mjs done <id>',
        'The gate clears when all items are done. Never stop with open work — the ledger is what context forgets.',
        'Kill-switch: AURA_GATEKEEPER_OFF=1.'].join('\n'));
    }

    ALLOW();
  } catch {
    ALLOW();                                              // any error → fail-open
  }
}
main().catch(ALLOW);
