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
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
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

// Neutralize the LIVE fable-window for the whole suite (evals must be deterministic
// regardless of the user's current window); the dedicated window cases override per-call.
if (!process.env.AURA_FABLE_WINDOW) {
  const fwNeutral = join(HOME, '.auramaxing', 'evals', 'tmp', 'fw-neutral.json');
  try { mkdirSync(join(HOME, '.auramaxing', 'evals', 'tmp'), { recursive: true }); writeFileSync(fwNeutral, JSON.stringify({ until: '2020-01-01' })); process.env.AURA_FABLE_WINDOW = fwNeutral; } catch {}
}

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
const TOOLID = (id, name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const RESULT = (id, txt) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: txt }] } });
function gatekeeper(transcriptLines, stopActive, sessionId = '') {
  mkdirSync(TMP, { recursive: true });
  const tp = join(TMP, `t-${Math.abs(transcriptLines.join('').length)}-${stopActive}-${sessionId}.jsonl`);
  writeFileSync(tp, transcriptLines.join('\n') + '\n');
  return run(GATEKEEPER, JSON.stringify({ transcript_path: tp, stop_hook_active: stopActive, session_id: sessionId }));
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
  // v2 regression (10x audit #1 — verify OUTCOMES not utterances):
  add('gatekeeper-blocks-failing-test', gatekeeper([...editNoVerify, TOOLID('v1', 'Bash', { command: 'npm test' }), RESULT('v1', 'Tests: 1 passed, 2 failed')], false).includes('"block"'), 'expected block: a FAILING verify must not clear the gate');
  add('gatekeeper-allows-passing-test-result', gatekeeper([...editNoVerify, TOOLID('v1', 'Bash', { command: 'npm test' }), RESULT('v1', 'Tests: 5 passed, 0 failed')], false).trim() === '', 'expected allow: a PASSING verify result clears the gate');
  add('gatekeeper-blocks-agent-review-bypass', gatekeeper([...editNoVerify, TOOL('Agent', { prompt: 'please review the code' })], false).includes('"block"'), 'expected block: spawning an agent whose prompt says "review" is not an outcome');

  // Gate 3 — ABSOLUTE GREATNESS GATE (Phase 08). Uses a temp ledger via AURA_LEDGER_FILE so the
  // real session ledger is never touched. okV = mutated source + a PASSING verify (clears Gate 1).
  mkdirSync(TMP, { recursive: true });
  const g3Ledger = join(TMP, 'g3-ledger.json');
  const okV = [...editNoVerify, TOOLID('g3', 'Bash', { command: 'npm test' }), RESULT('g3', 'Tests: 5 passed, 0 failed')];
  const stamp = () => Math.floor(Date.now() / 1000);
  process.env.AURA_LEDGER_FILE = g3Ledger;
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true }] }));
  add('gatekeeper-greatness-blocks-done-without-pass', gatekeeper(okV, false, 'GK3').includes('ABSOLUTE GREATNESS GATE'), 'expected block: deliverable done WITHOUT a recorded greatness pass');
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, greatness: { passed: true, evidence: 'e' } }] }));
  add('gatekeeper-greatness-allows-recorded-pass', gatekeeper(okV, false, 'GK3').trim() === '', 'expected allow: greatness pass recorded');
  add('gatekeeper-greatness-skips-on-no-mutation', gatekeeper([U('x'), TOOL('Edit', { file_path: '/x/README.md' }), TOOLID('g3', 'Bash', { command: 'npm test' }), RESULT('g3', '5 passed, 0 failed')], false, 'GK3').trim() === '', 'expected allow: docs-only change never triggers the greatness gate');
  // ledger.mjs `great` records the pass AND marks done.
  const greatLedger = join(TMP, 'great-ledger.json');
  writeFileSync(greatLedger, JSON.stringify({ sessionId: 'X', ts: stamp(), items: [{ id: 1, desc: 'd', done: false }] }));
  execSync(`AURA_LEDGER_FILE='${greatLedger}' node "${join(CLAUDE_H, 'ledger.mjs')}" great 1 "tested"`, { encoding: 'utf8' });
  const gl = JSON.parse(readFileSync(greatLedger, 'utf8'));
  add('ledger-great-records-pass-and-done', gl.items[0].done === true && gl.items[0].greatness && gl.items[0].greatness.passed === true, 'expected great to set done + greatness.passed');
  delete process.env.AURA_LEDGER_FILE;

  // taste.mjs — 5%/week decay (0.95^weeks). Fresh reject must outweigh a 10-week-old approve on the same tag.
  const tasteDir = join(HOME, '.auramaxing', 'taste');
  mkdirSync(tasteDir, { recursive: true });
  const tasteKey = `evaltaste-${process.pid}`;
  const tasteFile = join(tasteDir, `${tasteKey}.json`);
  writeFileSync(tasteFile, JSON.stringify({ project: tasteKey, decisions: [
    { ts: stamp() - 10 * 7 * 24 * 3600, verdict: 'approve', tags: ['X'], note: 'old' },
    { ts: stamp(), verdict: 'reject', tags: ['X'], note: 'fresh' },
  ] }));
  // Run taste from a cwd whose basename resolves to tasteKey (no git → basename). Use a temp dir.
  const tasteCwd = join(TMP, tasteKey);
  mkdirSync(tasteCwd, { recursive: true });
  // Move the fixture to match the temp cwd's project key.
  writeFileSync(join(tasteDir, `${tasteKey}.json`), readFileSync(tasteFile, 'utf8'));
  let tasteNetX = null;
  try {
    const out = execSync(`cd "${tasteCwd}" && node "${join(CLAUDE_H, 'taste.mjs')}" profile --json`, { encoding: 'utf8' });
    const prof = JSON.parse(out);
    const x = [...(prof.liked || []), ...(prof.disliked || [])].find(t => t.tag === 'X');
    tasteNetX = x ? x.net : null;
  } catch {}
  // 0.95^10 - 1.0 ≈ -0.401 → X must land in disliked (net < 0).
  add('taste-decay-5pct-per-week', tasteNetX !== null && tasteNetX < 0 && Math.abs(tasteNetX - (Math.pow(0.95, 10) - 1)) < 0.01, `expected decayed net≈-0.401 for X, got ${tasteNetX}`);
  try { rmSync(tasteFile, { force: true }); } catch {}

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

  // ── update-gate cases ──────────────────────────────────────────────────
  // Uses AURA_UPDATE_STATE_FILE to point at /tmp fixtures — no HOME state touched.
  const UPDATE_GATE = join(AURA_H, 'update-gate.mjs');
  const gateStateDir = join(TMP, 'update-gate-states');
  mkdirSync(gateStateDir, { recursive: true });

  function writeGateState(name, local, remote, ageMs = 0) {
    const p = join(gateStateDir, name + '.json');
    writeFileSync(p, JSON.stringify({ checkedAt: Date.now() - ageMs, local, remote }));
    return p;
  }

  function runGate(stateFilePath, extraEnv = {}) {
    const missingPath = join(gateStateDir, 'nonexistent-' + Date.now() + '.json');
    const stateFile = stateFilePath === 'missing' ? missingPath : stateFilePath;
    const env = { ...process.env, AURA_UPDATE_GATE_OFF: '', AURA_UPDATE_STATE_FILE: stateFile, ...extraEnv };
    try {
      execSync(`node "${UPDATE_GATE}"`, { encoding: 'utf8', timeout: 2000, env });
      return { exitCode: 0, stderr: '' };
    } catch (e) {
      return { exitCode: e.status ?? 1, stderr: e.stderr || '' };
    }
  }

  // (a) newer remote → blocks (exit 2 + stderr contains remote version)
  const gateNewerState = writeGateState('newer', '1.0.0', '1.1.0');
  const gateBlock = runGate(gateNewerState);
  add('gate-blocks-on-newer-version',
    gateBlock.exitCode === 2 && gateBlock.stderr.includes('1.1.0'),
    `expected exit 2 with remote ver in stderr; got exitCode=${gateBlock.exitCode} stderr="${gateBlock.stderr.slice(0, 120)}"`);

  // (b) equal versions → allows (exit 0)
  const gateEqualState = writeGateState('equal', '1.3.1', '1.3.1');
  const gateAllow = runGate(gateEqualState);
  add('gate-allows-current-version',
    gateAllow.exitCode === 0,
    `expected exit 0 for equal versions; got ${gateAllow.exitCode}`);

  // (c) missing state file → fail-open (exit 0)
  const gateMissing = runGate('missing');
  add('gate-fail-open-missing-state',
    gateMissing.exitCode === 0,
    `expected exit 0 (fail-open) when state missing; got ${gateMissing.exitCode}`);

  // (d) kill-switch with newer remote → allows (exit 0)
  const gateKS = runGate(gateNewerState, { AURA_UPDATE_GATE_OFF: '1' });
  add('gate-kill-switch',
    gateKS.exitCode === 0,
    `expected exit 0 with kill-switch; got ${gateKS.exitCode}`);

  // ── FABLE-ONLY window (until 2026-06-23): suppresses Sonnet delegation, expires alone ──
  const fwActive = join(TMP, 'fw-active.json'); writeFileSync(fwActive, JSON.stringify({ until: '2099-01-01' }));
  const fwExpired = join(TMP, 'fw-expired.json'); writeFileSync(fwExpired, JSON.stringify({ until: '2020-01-01' }));
  const routerFW = (fw) => {
    try { return execSync(`node "${ROUTER}"`, { input: JSON.stringify({ prompt: 'build a payments feature with stripe integration' }), encoding: 'utf8', timeout: 8000, env: { ...process.env, AURA_FABLE_WINDOW: fw, AURA_BILLION_FLAG: join(TMP, 'no-bflag.json') } }); }
    catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  const fwOn = routerFW(fwActive), fwOff = routerFW(fwExpired);
  add('fable-window-active-suppresses-sonnet', fwOn.includes('FABLE-ONLY WINDOW') && !fwOn.includes('SONNET AT MAXIMUM'), 'expected window directive + suppressed Sonnet DELEGATE while active');
  add('fable-window-expired-restores-normal', !fwOff.includes('FABLE-ONLY WINDOW') && fwOff.includes('SONNET AT MAXIMUM'), 'expected normal Sonnet delegation after the window date');
  const guardFW = (fw) => {
    try { return execSync(`node "${join(CLAUDE_H, 'ultramax-guard.mjs')}"`, { input: JSON.stringify({ tool_name: 'Agent', session_id: 'FWX', tool_input: { model: 'sonnet', prompt: 'ultrathink. ZERO-TOLERANCE frame... do x' } }), encoding: 'utf8', timeout: 5000, env: { ...process.env, AURA_FABLE_WINDOW: fw, AURA_ULTRAMAX_FLAG: join(TMP, 'no-umx.json') } }); }
    catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  add('fable-window-guard-blocks-framed-sonnet', guardFW(fwActive).includes('"block"'), 'expected guard to block sonnet even WITH the diligence frame while window active');
  add('fable-window-guard-expired-allows-framed', guardFW(fwExpired).includes('"approve"'), 'expected framed sonnet allowed after window expiry');

  // ── BILLION sticky state machine (the perpetual engine must not die on plain prompts) ──
  const bflag = join(TMP, 'billion-flag.json');
  const routerRun = (prompt, sid) => {
    try {
      return execSync(`node "${ROUTER}"`, {
        input: JSON.stringify({ prompt, session_id: sid }), encoding: 'utf8', timeout: 8000,
        env: { ...process.env, AURA_BILLION_FLAG: bflag, AURA_ULTRAMAX_FLAG: join(TMP, 'umx-flag-b.json') },
      });
    } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  rmSync(bflag, { force: true });
  add('billion-keyword-arms-sticky', routerRun('billion domina el mercado', 'BSESA').includes('BILLION MODE') && existsSync(bflag), 'expected BILLION directive + sticky flag written on keyword');
  add('billion-sticky-survives-plain-prompt', routerRun('sigue con lo siguiente del plan', 'BSESA').includes('BILLION MODE'), 'expected BILLION to persist on a keyword-less prompt in the same session');
  add('billion-sticky-isolated-per-session', !routerRun('sigue con lo siguiente', 'BSESB').includes('BILLION MODE'), 'expected another session NOT to inherit the sticky flag');
  add('billion-off-clears', (() => { routerRun('billion off', 'BSESA'); return !existsSync(bflag); })(), 'expected "billion off" to delete the sticky flag');
  add('billion-stays-off-after-off', !routerRun('continua el trabajo pendiente', 'BSESA').includes('BILLION MODE'), 'expected no BILLION after explicit off');

  // ── per-session ledger isolation (concurrent sessions must not clobber gates) ──
  const ldir = join(TMP, 'ledger-dir');
  mkdirSync(ldir, { recursive: true });
  writeFileSync(join(ldir, 'SESA.json'), JSON.stringify({ sessionId: 'SESA', ts: stamp(), items: [{ id: 1, desc: 'a-open', done: false }] }));
  writeFileSync(join(ldir, 'SESB.json'), JSON.stringify({ sessionId: 'SESB', ts: stamp(), items: [{ id: 1, desc: 'b-done', done: true }] }));
  process.env.AURA_LEDGER_DIR = ldir;
  delete process.env.AURA_LEDGER_FILE;
  add('ledger-isolation-gate2-own-session', gatekeeper([U('x')], false, 'SESA').includes('COMPLETENESS GATE'), 'expected Gate 2 block: SESA has its own open item in its per-session ledger');
  add('ledger-isolation-other-session-immune', gatekeeper([U('x')], false, 'SESC').trim() === '', 'expected allow: SESC has no per-session ledger (must not see SESA/SESB items)');
  // ledger.mjs --session targets the right per-session file.
  execSync(`node "${join(CLAUDE_H, 'ledger.mjs')}" done 1 --session SESA`, { encoding: 'utf8', env: { ...process.env, AURA_LEDGER_DIR: ldir } });
  const sesA = JSON.parse(readFileSync(join(ldir, 'SESA.json'), 'utf8'));
  const sesB = JSON.parse(readFileSync(join(ldir, 'SESB.json'), 'utf8'));
  add('ledger-session-flag-targets-own-file', sesA.items[0].done === true && sesB.items[0].desc === 'b-done', 'expected --session SESA to mutate only SESA.json');
  delete process.env.AURA_LEDGER_DIR;

  // ── BILLION watchdog: re-nudges on stop while objectives open, bounded by cap ──
  const bwFlag = join(TMP, 'bw-flag.json');
  const bwLdir = join(TMP, 'bw-ledger');
  mkdirSync(bwLdir, { recursive: true });
  writeFileSync(join(bwLdir, 'BWA.json'), JSON.stringify({ sessionId: 'BWA', ts: stamp(), items: [{ id: 1, desc: 'reach $10k MRR objective', done: false }] }));
  process.env.AURA_BILLION_FLAG = bwFlag;
  process.env.AURA_LEDGER_DIR = bwLdir;
  writeFileSync(bwFlag, JSON.stringify({ sessionId: 'BWA', ts: stamp() }));
  add('billion-watchdog-nudges-on-stop', gatekeeper([U('x')], true, 'BWA').includes('BILLION WATCHDOG'), 'expected watchdog NUDGE block on stop with billion active + open objectives');
  add('billion-watchdog-counts-up', JSON.parse(readFileSync(bwFlag, 'utf8')).nudges === 1, 'expected nudge counter persisted to the flag');
  writeFileSync(bwFlag, JSON.stringify({ sessionId: 'BWA', ts: stamp(), nudges: 12 }));
  add('billion-watchdog-respects-cap', gatekeeper([U('x')], true, 'BWA').trim() === '', 'expected allow once the nudge budget cap is exhausted');
  writeFileSync(bwFlag, JSON.stringify({ sessionId: 'BWA', ts: stamp() }));
  writeFileSync(join(bwLdir, 'BWA.json'), JSON.stringify({ sessionId: 'BWA', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, greatness: { passed: true, evidence: 'e' } }] }));
  add('billion-watchdog-needs-open-objectives', gatekeeper([U('x')], true, 'BWA').trim() === '', 'expected allow when every objective is closed');
  add('billion-watchdog-other-session-immune', gatekeeper([U('x')], true, 'BWB').trim() === '', 'expected allow for a session that did not arm billion');
  delete process.env.AURA_BILLION_FLAG;
  delete process.env.AURA_LEDGER_DIR;

  // update-check.sh ver_gt — regression: string compare made local 1.10.0 "upgrade" to remote 1.9.0.
  const verGt = (a, b) => {
    try {
      execSync(`bash -c 'eval "$(sed -n "/^ver_gt() {/,/^}/p" "$HOME/auramaxing/scripts/update-check.sh")"; ver_gt ${a} ${b}'`, { encoding: 'utf8', timeout: 5000 });
      return true;
    } catch { return false; }
  };
  add('vercheck-remote-older-no-upgrade', verGt('1.9.0', '1.10.0') === false, 'expected ver_gt(1.9.0 > 1.10.0)=false — the lexicographic-compare regression');
  add('vercheck-remote-newer-upgrades', verGt('1.10.0', '1.9.0') === true, 'expected ver_gt(1.10.0 > 1.9.0)=true');
  add('vercheck-equal-no-upgrade', verGt('1.10.0', '1.10.0') === false, 'expected ver_gt(equal)=false');

  // ── ultramax-guard cases (Fable-5-only fleet at MAX presets) ─────────────
  // Uses AURA_ULTRAMAX_FLAG to point at a TMP flag — the real session flag is never touched.
  const GUARD = join(CLAUDE_H, 'ultramax-guard.mjs');
  const umFlag = join(TMP, 'ultramax-flag.json');
  writeFileSync(umFlag, JSON.stringify({ sessionId: 'UMX', ts: Math.floor(Date.now() / 1000) }));
  const guardRun = (toolName, toolInput, sessionId = 'UMX', extraEnv = {}) => {
    try {
      return execSync(`node "${GUARD}"`, {
        input: JSON.stringify({ tool_name: toolName, session_id: sessionId, tool_input: toolInput }),
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, AURA_ULTRAMAX_FLAG: umFlag, AURA_ULTRAMAX_OFF: '', ...extraEnv },
      });
    } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  add('ultramax-blocks-sonnet-spawn', guardRun('Agent', { model: 'sonnet', prompt: 'ultrathink. do x' }).includes('"block"'), 'expected block: sonnet spawn while ULTRAMAX active');
  add('ultramax-allows-fable-ultrathink', guardRun('Agent', { model: 'fable', prompt: 'ultrathink. do x' }).includes('"approve"'), 'expected approve: fable model + ultrathink prompt');
  add('ultramax-allows-inherit-ultrathink', guardRun('Agent', { prompt: 'ultrathink. do x' }).includes('"approve"'), 'expected approve: inherited (Fable) model + ultrathink prompt');
  add('ultramax-blocks-missing-ultrathink', guardRun('Agent', { prompt: 'do x' }).includes('"block"'), 'expected block: fleet spawn prompt missing "ultrathink" (max-thinking lock)');
  add('ultramax-blocks-workflow-model-override', guardRun('Workflow', { script: "await agent('x', {model: 'sonnet'})" }).includes('"block"'), 'expected block: workflow script overrides an agent onto sonnet');
  add('ultramax-allows-workflow-no-override', guardRun('Workflow', { script: "await agent('ultrathink. x', {schema: S})" }).includes('"approve"'), 'expected approve: workflow with no model overrides (inherits Fable)');
  add('ultramax-failopen-other-session', guardRun('Agent', { model: 'opus', prompt: 'x' }, 'OTHER').includes('"approve"'), 'expected approve: flag belongs to a different session (opus is not a cheap worker — normal mode allows)');
  // ── normal mode (no ultramax flag): Sonnet 10x forced diligence ──────────
  add('normalmode-blocks-bare-sonnet', guardRun('Agent', { model: 'sonnet', prompt: 'do x' }, 'OTHER').includes('"block"'), 'expected block: bare sonnet spawn without the 10x diligence frame');
  add('normalmode-allows-framed-sonnet', guardRun('Agent', { model: 'sonnet', prompt: 'ultrathink. ZERO-TOLERANCE rules: (1)... acceptance test: npm test. do x' }, 'OTHER').includes('"approve"'), 'expected approve: sonnet with ultrathink + zero-tolerance frame');
  add('normalmode-allows-inherit', guardRun('Agent', { prompt: 'do x' }, 'OTHER').includes('"approve"'), 'expected approve: inherit (Fable) spawn untouched in normal mode');
  add('normalmode-blocks-workflow-bare-sonnet', guardRun('Workflow', { script: "await agent('x', {model: 'sonnet'})" }, 'OTHER').includes('"block"'), 'expected block: workflow sonnet override without diligence markers');
  add('normalmode-allows-workflow-framed-sonnet', guardRun('Workflow', { script: "// ZERO-TOLERANCE frame... await agent('ultrathink. x', {model: 'sonnet'})" }, 'OTHER').includes('"approve"'), 'expected approve: workflow sonnet override with ultrathink + frame');
  add('ultramax-kill-switch', guardRun('Agent', { model: 'sonnet', prompt: 'x' }, 'UMX', { AURA_ULTRAMAX_OFF: '1' }).includes('"approve"'), 'expected approve: AURA_ULTRAMAX_OFF=1 disables enforcement');
  add('drift-ultramax-guard-copies', sameFile(GUARD, join(AURA_H, 'ultramax-guard.mjs')), 'ultramax-guard copies DRIFTED (.claude vs auramaxing)');

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
  // Universal mirror guard: EVERY same-named .claude↔auramaxing helper pair must be identical
  // (the 2026-06-12 audit found 12 stale shadows that silently diverged — now archived).
  try {
    const diverged = readdirSync(CLAUDE_H).filter(f => f.endsWith('.mjs'))
      .filter(f => existsSync(join(AURA_H, f)) && !sameFile(join(CLAUDE_H, f), join(AURA_H, f)));
    add('drift-all-helper-pairs', diverged.length === 0, `helper pairs DIVERGED: ${diverged.join(', ')}`);
  } catch (e) { add('drift-all-helper-pairs', false, 'mirror scan failed: ' + e.message); }
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
