#!/usr/bin/env node
/**
 * AURAMAXING Self-Improvement Loop — the reflective layer of the measurement system.
 *
 * EVOLUTION-V2 10x-1 + 10x-6: turns an eval regression into a STRATEGY, not a narration.
 * Deterministic reflection now (zero cost); GEPA reflective prompt-optimization when an LLM key
 * is present (key-gated — flagged, never silently skipped).
 *
 * Flow:
 *   1. run.mjs writes ~/.auramaxing/learnings/eval-regression-*.json on any regression.
 *   2. This reads the latest one, classifies each failing check (drift | contract-change |
 *      behavior-break), proposes a concrete fix, and writes a distilled strategy learning.
 *   3. If GEPA (dspy) + an LLM key are available, it emits the activation plan to evolve the
 *      offending skill/router text against the eval set; otherwise it prints the key-gated notice.
 *
 * Usage: node ~/.auramaxing/evals/selfimprove.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const HOME = homedir();
const LEARNINGS = join(HOME, '.auramaxing', 'learnings');

function latestRegression() {
  if (!existsSync(LEARNINGS)) return null;
  const files = readdirSync(LEARNINGS).filter(f => f.startsWith('eval-regression-') && f.endsWith('.json'))
    .map(f => ({ f, m: statSync(join(LEARNINGS, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  if (!files.length) return null;
  try { return { file: files[0].f, data: JSON.parse(readFileSync(join(LEARNINGS, files[0].f), 'utf8')) }; } catch { return null; }
}

// Classify a failing check into a root-cause category + a concrete next action.
function classify(check) {
  const id = check.id || '', why = (check.fails || []).join(' ');
  if (id.startsWith('drift-')) return { cause: 'copy-drift', action: `Re-sync the two helper copies (.claude/helpers ↔ auramaxing/helpers) for ${id.replace('drift-', '').replace('-copies', '')}; an edit landed in one copy only.` };
  if (/missing '|forbidden '/.test(why)) return { cause: 'contract-change', action: `A directive string changed. Either the change is intended → update the eval assertion to the new contract, or it is a regression → restore the emitted string. (${why})` };
  if (check.suite === 'hooks') return { cause: 'behavior-break', action: `A hook stopped behaving: ${id}. Read the hook, reproduce with the harness's synthetic input, fix the root cause, re-run.` };
  return { cause: 'unknown', action: `Investigate ${id}: ${why}` };
}

function gepaAvailable() {
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  let hasDspy = false;
  try { execSync('python3 -c "import dspy, gepa" 2>/dev/null', { timeout: 4000 }); hasDspy = true; } catch {}
  return { hasKey, hasDspy, ready: hasKey && hasDspy };
}

const reg = latestRegression();
if (!reg) {
  console.log('✓ No eval regression on record — nothing to self-improve. (run.mjs writes one only when score < baseline.)');
  process.exit(0);
}

const failing = reg.data.failing || [];
const reflections = failing.map(c => ({ id: c.id, ...classify(c) }));
const ts = new Date().toISOString().slice(0, 19);

console.log(`\n  AURAMAXING Self-Improvement — reflecting on ${reg.file}`);
console.log(`  baseline ${reg.data.baseline}% → now ${reg.data.now}%  (${failing.length} failing)`);
console.log(`  ${'─'.repeat(56)}`);
for (const r of reflections) console.log(`  • [${r.cause}] ${r.id}\n      → ${r.action}`);

// Distill a strategy learning (ReasoningBank pattern — strategy, not narration).
mkdirSync(LEARNINGS, { recursive: true });
const strategy = {
  ts, type: 'strategy', source: reg.file,
  trigger: 'eval regression detected by harness',
  strategy: 'When the eval drops: (1) classify each failing check (drift / contract-change / behavior-break); '
    + '(2) drift → re-sync copies; contract-change → decide intended (update assertion) vs regression (restore string); '
    + 'behavior-break → reproduce with the harness synthetic input, fix root cause; (3) re-run to green BEFORE stopping.',
  causes: [...new Set(reflections.map(r => r.cause))],
};
writeFileSync(join(LEARNINGS, `strategy-eval-${ts.replace(/[:T]/g, '')}.json`), JSON.stringify(strategy, null, 2));
console.log(`  ${'─'.repeat(56)}`);
console.log(`  ✓ distilled strategy → learnings/strategy-eval-*.json`);

// GEPA reflective optimization — key-gated.
const g = gepaAvailable();
if (g.ready) {
  console.log(`  ⚡ GEPA READY (dspy+gepa+LLM key present). To evolve the offending skill/router text against the eval set:`);
  console.log(`     python3 ~/.auramaxing/evals/gepa_optimize.py --target <skill-or-router> --evalset cases/router.jsonl`);
} else {
  const miss = [!g.hasKey && 'LLM API key (ANTHROPIC_API_KEY/OPENAI_API_KEY)', !g.hasDspy && 'pip install dspy-ai gepa'].filter(Boolean).join(' + ');
  console.log(`  ⓘ GEPA reflective optimizer is KEY-GATED — not run. Needs: ${miss}.`);
  console.log(`     Until then, deterministic reflection above is the loop. (EVOLUTION-V2 10x-1.)`);
}
console.log('');
process.exit(0);
