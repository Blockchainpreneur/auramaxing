#!/usr/bin/env node
/**
 * AURAMAXING Eval Harness v2 — deterministic, multi-suite, zero-cost regression + efficacy suite.
 *
 * Closes the measurement loop (EVOLUTION-V2 10x-1): proves whether a change to the router, hooks,
 * doctrine, or CLAUDE.md made AURAMAXING better or worse — no LLM, no API key, no cost.
 *
 * SUITES:
 *   router   — data-driven (cases/router.jsonl): feed a prompt to the LIVE router, assert the
 *              emitted directive (task classification + must_include / must_not substrings).
 *   hooks    — coded behavior checks: the evidence-gatekeeper block/allow matrix, the prompt-engine
 *              phased-loop gate, compact-hooks auto-resume, and copy-drift guards.
 *
 * It runs the LIVE helpers under ~/.claude/helpers (what actually executes), and asserts the two
 * copies (.claude vs auramaxing) are byte-identical — drift fails the suite.
 *
 * On regression it writes a structured learning (~/.auramaxing/learnings/eval-regression-*.json)
 * so the self-improvement loop (selfimprove.mjs) can reflect on it. Always exits 1 if any case fails.
 *
 * Usage: node ~/.auramaxing/evals/run.mjs            # scorecard, exit 1 on any fail
 *        node ~/.auramaxing/evals/run.mjs --json      # machine-readable
 *        node ~/.auramaxing/evals/run.mjs --baseline  # write current score as baseline
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const HOME = homedir();
const CLAUDE_H = join(HOME, '.claude', 'helpers');
const AURA_H = join(HOME, 'auramaxing', 'helpers');
const ROUTER = join(CLAUDE_H, 'rational-router-apex.mjs');         // the LIVE router (what executes)
const PROMPT_ENGINE = join(AURA_H, 'prompt-engine.mjs');           // router invokes the auramaxing copy
const GATEKEEPER = join(CLAUDE_H, 'evidence-gatekeeper.mjs');
const COMPACT = join(CLAUDE_H, 'compact-hooks.mjs');
const COMPRESSOR = join(CLAUDE_H, 'output-compressor.mjs');
const CASES = join(HOME, '.auramaxing', 'evals', 'cases', 'router.jsonl');
const BASELINE = join(HOME, '.auramaxing', 'evals', 'baseline.json');
const LEARNINGS = join(HOME, '.auramaxing', 'learnings');
const TMP = join(HOME, '.auramaxing', 'evals', 'tmp', `run-${process.pid}`); // pid-scoped: concurrent runs never collide

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const setBaseline = args.includes('--baseline');

function run(bin, input, ms = 8000) {
  try { return execSync(`node "${bin}"`, { input: input ?? '', encoding: 'utf8', timeout: ms }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
function classify(out) { const m = out.match(/task:([a-z-]+)/); return m ? m[1] : ''; }
function sameFile(a, b) { try { return readFileSync(a, 'utf8') === readFileSync(b, 'utf8'); } catch { return false; } }

// ── Suite 1: router (data-driven) ───────────────────────────────────────────
function routerSuite() {
  const cases = readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return cases.map(c => {
    const out = run(ROUTER, JSON.stringify({ prompt: c.prompt }));
    const task = classify(out);
    const fails = [];
    if ((c.expect_task || '') !== task) fails.push(`task: got '${task}' want '${c.expect_task}'`);
    for (const s of (c.must_include || [])) if (!out.includes(s)) fails.push(`missing '${s}'`);
    for (const s of (c.must_not || [])) if (out.includes(s)) fails.push(`forbidden '${s}'`);
    return { suite: 'router', id: c.id, pass: fails.length === 0, fails };
  });
}

// ── Suite 2: hooks (coded behavior checks) ──────────────────────────────────
const U = (txt) => JSON.stringify({ type: 'user', message: { role: 'user', content: txt } });
const TOOL = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
function gatekeeper(transcriptLines, stopActive) {
  mkdirSync(TMP, { recursive: true });
  const tp = join(TMP, `t-${Math.abs(transcriptLines.join('').length)}-${stopActive}.jsonl`);
  writeFileSync(tp, transcriptLines.join('\n') + '\n');
  return run(GATEKEEPER, JSON.stringify({ transcript_path: tp, stop_hook_active: stopActive }));
}

function hooksSuite() {
  // Give the gatekeeper headroom over its tight production self-timeout so the eval is stable on a
  // busy machine (tests the LOGIC, not the latency budget). Production keeps its 1800ms default.
  process.env.AURA_GK_TIMEOUT_MS = '6000';
  const checks = [];
  const add = (id, passed, detail) => checks.push({ suite: 'hooks', id, pass: !!passed, fails: passed ? [] : [detail] });

  const editNoVerify = [U('fix the bug'), TOOL('Edit', { file_path: '/x/a.ts' })];
  add('gatekeeper-blocks-unverified', gatekeeper(editNoVerify, false).includes('"block"'), 'expected block on code edit w/o verification');
  add('gatekeeper-allows-verified', gatekeeper([...editNoVerify, TOOL('Bash', { command: 'npm test' })], false).trim() === '', 'expected allow when tests ran');
  add('gatekeeper-loop-guard', gatekeeper(editNoVerify, true).trim() === '', 'expected allow when stop_hook_active (no loop)');
  add('gatekeeper-allows-docs', gatekeeper([U('edit readme'), TOOL('Edit', { file_path: '/x/README.md' })], false).trim() === '', 'expected allow for docs-only change');
  // Regression for the substring-bypass found by the 10x audit: a command merely CONTAINING "test"
  // (echo test, reading a test file) must NOT clear the gate — only real runners do.
  add('gatekeeper-blocks-echo-test-bypass', gatekeeper([...editNoVerify, TOOL('Bash', { command: 'echo test' })], false).includes('"block"'), 'expected block: "echo test" is not a real verify command');
  add('gatekeeper-blocks-cat-testfile-bypass', gatekeeper([...editNoVerify, TOOL('Bash', { command: 'cat tests/README.md' })], false).includes('"block"'), 'expected block: reading a test file is not verification');
  add('gatekeeper-allows-eval-harness', gatekeeper([...editNoVerify, TOOL('Bash', { command: 'node ~/auramaxing/evals/run.mjs' })], false).trim() === '', 'expected allow: the project eval harness IS verification');

  // prompt-engine does a slow LightRAG (Python) pass before emitting its block; AURA_PE_FAST skips
  // that non-deterministic I/O so the gate/structuring check is instant + stable (root-cause fix for
  // the earlier flaky prompt-engine failures). 25s ceiling kept as belt-and-suspenders.
  process.env.AURA_PE_FAST = '1';
  const pe = run(PROMPT_ENGINE, JSON.stringify({ prompt: 'build a payments feature' }), 25000);
  add('prompt-engine-phased-gate', pe.includes('PHASED EXCELLENCE LOOP'), 'phased-loop gate missing from prompt-engine');
  add('prompt-engine-evidence-rigor', pe.includes('treated as FALSE') && pe.includes('ADVERSARIALLY'), 'evidence/adversarial rigor missing from prompt-engine');

  const post = run(COMPACT, JSON.stringify({ hook_type: 'PostCompact' }));
  add('compact-auto-resume', post.includes('AUTO-RESUMED') && post.includes('MAXXING-SDR'), 'compact PostCompact missing AUTO-RESUMED marker');

  // nlm-live-recall must early-exit SILENT (no [AURAMAXING NLM-RECALL] block, no work) when NLM is
  // unavailable — i.e. notebook-id absent OR last health check failed/stale. Forcing a tiny health
  // TTL makes any real health record "stale", so the hook must emit nothing and never burn its
  // timeout. Regression guard for TASK#8 (1.5s/prompt burn while NLM is broken).
  const LIVE_RECALL = join(AURA_H, 'nlm-live-recall.mjs');
  let lrOut = '';
  try {
    lrOut = execSync(`node "${LIVE_RECALL}"`, {
      input: JSON.stringify({ prompt: 'how does the orchestration loop work across many files and modules' }),
      encoding: 'utf8', timeout: 6000,
      env: { ...process.env, AURA_NLM_HEALTH_TTL_MS: '1' },
    });
  } catch (e) { lrOut = (e.stdout || '') + (e.stderr || ''); }
  add('nlm-live-recall-early-exit', !lrOut.includes('NLM-RECALL'), 'nlm-live-recall did not early-exit silent when NLM unavailable (would burn timeout)');

  // output-compressor (TASK#12): must NOT compress model-requested read tools. A >50KB Read is
  // explicitly asked for — compressing it to a 600-char head/tail fragment is real degradation that
  // breaks edit accuracy. Only UNSOLICITED Bash output gets capped. The hook replies via stdout:
  // a compressed result includes "OUTPUT-COMPRESSED"; an untouched result yields {"decision":"approve"}.
  const bigBody = 'x'.repeat(60 * 1024); // 60KB > 50KB cap
  const compRead = run(COMPRESSOR, JSON.stringify({ tool_name: 'Read', tool_result: bigBody }));
  add('compressor-spares-read', compRead.includes('"approve"') && !compRead.includes('OUTPUT-COMPRESSED'), 'expected large Read to pass through UNCOMPRESSED (model explicitly requested it)');
  const compGrep = run(COMPRESSOR, JSON.stringify({ tool_name: 'Grep', tool_result: bigBody }));
  add('compressor-spares-grep', compGrep.includes('"approve"') && !compGrep.includes('OUTPUT-COMPRESSED'), 'expected large Grep to pass through UNCOMPRESSED');
  const compBash = run(COMPRESSOR, JSON.stringify({ tool_name: 'Bash', tool_result: bigBody }));
  add('compressor-caps-bash', compBash.includes('OUTPUT-COMPRESSED') && compBash.includes('"modify"'), 'expected large UNSOLICITED Bash output to be compressed (context ceiling)');
  add('drift-compressor-copies', sameFile(COMPRESSOR, join(AURA_H, 'output-compressor.mjs')), 'output-compressor copies DRIFTED (.claude vs auramaxing)');

  add('drift-router-copies', sameFile(ROUTER, join(AURA_H, 'rational-router-apex.mjs')), 'router copies DRIFTED (.claude vs auramaxing)');
  add('drift-prompt-engine-copies', sameFile(join(CLAUDE_H, 'prompt-engine.mjs'), PROMPT_ENGINE), 'prompt-engine copies DRIFTED');
  add('drift-eval-cases-copies', sameFile(CASES, join(HOME, 'auramaxing', 'evals', 'cases', 'router.jsonl')), 'eval-cases copies DRIFTED');

  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  return checks;
}

// ── Run all suites ───────────────────────────────────────────────────────────
const results = [...routerSuite(), ...hooksSuite()];
const passed = results.filter(r => r.pass).length;
const score = Math.round((passed / results.length) * 100);
const bySuite = {};
for (const r of results) { (bySuite[r.suite] ??= { p: 0, t: 0 }); bySuite[r.suite].t++; if (r.pass) bySuite[r.suite].p++; }
const summary = { ts: new Date().toISOString().slice(0, 19), total: results.length, passed, score, suites: bySuite };

if (setBaseline) {
  writeFileSync(BASELINE, JSON.stringify(summary, null, 2));
  console.log(`baseline set: ${score}% (${passed}/${results.length})`);
  process.exit(0);
}

// Self-improvement hook: on regression vs baseline, write a structured learning for selfimprove.mjs.
if (existsSync(BASELINE)) {
  try {
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
    if (score < b.score) {
      mkdirSync(LEARNINGS, { recursive: true });
      const failing = results.filter(r => !r.pass);
      writeFileSync(join(LEARNINGS, `eval-regression-${summary.ts.replace(/[:T]/g, '')}.json`), JSON.stringify({
        ts: summary.ts, type: 'eval-regression', baseline: b.score, now: score, failing,
        reflection_todo: 'Identify which helper/doctrine change caused these failures; fix the root cause OR update the contract; re-run to green; distill a strategy via selfimprove.mjs.',
      }, null, 2));
    }
  } catch {}
}

if (asJson) { console.log(JSON.stringify({ summary, results }, null, 2)); }
else {
  console.log(`\n  AURAMAXING Eval v2 — multi-suite (router + hooks)`);
  console.log(`  ${'─'.repeat(50)}`);
  let cur = '';
  for (const r of results) {
    if (r.suite !== cur) { cur = r.suite; console.log(`  [${cur}]`); }
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.id}${r.pass ? '' : '  → ' + r.fails.join('; ')}`);
  }
  console.log(`  ${'─'.repeat(50)}`);
  const sline = Object.entries(bySuite).map(([k, v]) => `${k} ${v.p}/${v.t}`).join(' · ');
  let delta = '';
  if (existsSync(BASELINE)) { try { const b = JSON.parse(readFileSync(BASELINE, 'utf8')); delta = ` (baseline ${b.score}% → ${score >= b.score ? '✓ no regression' : '⚠ REGRESSION → learning written'})`; } catch {} }
  console.log(`  SCORE: ${score}% (${passed}/${results.length}) [${sline}]${delta}\n`);
}
process.exit(passed === results.length ? 0 : 1);
