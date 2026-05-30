#!/usr/bin/env node
/**
 * AURAMAXING Eval Harness — deterministic router/behavior regression suite.
 *
 * Closes the feedback loop (EVOLUTION-V2 10x-1): proves whether a change to the router,
 * doctrine skills, or CLAUDE.md made AURAMAXING better or worse — no LLM, no API key, no cost.
 * Each case feeds a prompt to the live router and asserts the emitted directive:
 *   - expect_task: the task id the router must classify to (''=must stay silent/trivial)
 *   - must_include: substrings that MUST appear in the directive (the right tools/skills fired)
 *   - must_not: substrings that MUST NOT appear (no dead MCP refs, no removed tools)
 *
 * Usage: node ~/.auramaxing/evals/run.mjs            # run + print scorecard, exit 1 if any fail
 *        node ~/.auramaxing/evals/run.mjs --json      # machine-readable
 *        node ~/.auramaxing/evals/run.mjs --baseline  # write current score as the baseline
 * Extend: add lines to cases/router.jsonl. Future: cases/*.jsonl for LLM-judged output evals.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const HOME = homedir();
const ROUTER = join(HOME, 'auramaxing', 'helpers', 'rational-router-apex.mjs');
const CASES = join(HOME, '.auramaxing', 'evals', 'cases', 'router.jsonl');
const BASELINE = join(HOME, '.auramaxing', 'evals', 'baseline.json');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const setBaseline = args.includes('--baseline');

function runRouter(prompt) {
  try {
    return execSync(`node "${ROUTER}"`, {
      input: JSON.stringify({ prompt }), encoding: 'utf8', timeout: 8000,
    });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

function classify(out) {
  const m = out.match(/task:([a-z-]+)/);
  return m ? m[1] : '';
}

const cases = readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const results = [];
for (const c of cases) {
  const out = runRouter(c.prompt);
  const task = classify(out);
  const fails = [];
  if ((c.expect_task || '') !== task) fails.push(`task: got '${task}' want '${c.expect_task}'`);
  for (const s of (c.must_include || [])) if (!out.includes(s)) fails.push(`missing '${s}'`);
  for (const s of (c.must_not || [])) if (out.includes(s)) fails.push(`forbidden '${s}'`);
  results.push({ id: c.id, pass: fails.length === 0, fails });
}

const passed = results.filter(r => r.pass).length;
const score = Math.round((passed / results.length) * 100);
const summary = { ts: new Date().toISOString().slice(0, 19), total: results.length, passed, score };

if (setBaseline) {
  writeFileSync(BASELINE, JSON.stringify(summary, null, 2));
  console.log(`baseline set: ${score}% (${passed}/${results.length})`);
  process.exit(0);
}

if (asJson) { console.log(JSON.stringify({ summary, results }, null, 2)); }
else {
  console.log(`\n  AURAMAXING Eval — router/behavior suite`);
  console.log(`  ${'─'.repeat(44)}`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.id}${r.pass ? '' : '  → ' + r.fails.join('; ')}`);
  console.log(`  ${'─'.repeat(44)}`);
  let delta = '';
  if (existsSync(BASELINE)) { try { const b = JSON.parse(readFileSync(BASELINE, 'utf8')); delta = ` (baseline ${b.score}% → ${score >= b.score ? '✓ no regression' : '⚠ REGRESSION'})`; } catch {} }
  console.log(`  SCORE: ${score}% (${passed}/${results.length})${delta}\n`);
}
process.exit(passed === results.length ? 0 : 1);
