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

// Neutralize the LIVE opus-window for the whole suite (evals must be deterministic
// regardless of the user's current window); the dedicated window cases override per-call.
// (Hooks read AURA_OPUS_WINDOW; the legacy AURA_FABLE_WINDOW is no longer consulted.)
if (!process.env.AURA_OPUS_WINDOW) {
  const fwNeutral = join(HOME, '.auramaxing', 'evals', 'tmp', 'opusw-neutral.json');
  try { mkdirSync(join(HOME, '.auramaxing', 'evals', 'tmp'), { recursive: true }); writeFileSync(fwNeutral, JSON.stringify({ until: '2020-01-01' })); process.env.AURA_OPUS_WINDOW = fwNeutral; } catch {}
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
const UU = (uuid, txt) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: txt } }); // F5: prompt with a stable uuid
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
  process.env.AURA_GK_NUDGE_DIR = join(TMP, 'gk-nudges'); // isolate v3 nudge counters from the real ~/.auramaxing
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

  // ── v3: PERSISTENT BOUNDED RE-BLOCK (loops must not stop after a single nudge) ──
  // WITH a session id, a still-failing gate re-blocks on EVERY stop attempt, bounded by a
  // per-prompt cap, auto-resetting when the user prompt changes. WITHOUT a session, the old
  // single-block loop-guard stands (gatekeeper-loop-guard above stays green).
  process.env.AURA_GK_MAX_NUDGES = '2';
  const gkn1 = gatekeeper(editNoVerify, true, 'GKN');   // count 1 ≤ 2 → block
  const gkn2 = gatekeeper(editNoVerify, true, 'GKN');   // count 2 ≤ 2 → block
  const gkn3 = gatekeeper(editNoVerify, true, 'GKN');   // count 3 > 2 → allow (bounded, never wedge)
  add('gk-reblocks-on-stop-with-session', gkn1.includes('"block"') && gkn2.includes('"block"'), 'expected re-block on repeated stop while a gate is still failing (session-scoped, 10x-rigor fix)');
  add('gk-respects-nudge-cap', gkn3.trim() === '', 'expected allow once the per-prompt nudge budget is exhausted (never wedge)');
  const editNoVerify2 = [U('now a different task entirely'), TOOL('Edit', { file_path: '/x/b.ts' })];
  add('gk-nudge-resets-on-new-prompt', gatekeeper(editNoVerify2, true, 'GKN').includes('"block"'), 'expected the nudge counter to reset when the user prompt changes (enforcement resumes)');
  delete process.env.AURA_GK_MAX_NUDGES;

  // ── F5 (audit 2026-06-17): nudge turnKey is keyed on the prompt's STABLE uuid (+session), NOT the
  // line index — so auto-compact inserting/removing lines must NOT spuriously reset the counter. ──
  process.env.AURA_GK_MAX_NUDGES = '1';
  const f5n1 = gatekeeper([UU('uid-1', 'do the task'), TOOL('Edit', { file_path: '/x/f5.ts' })], true, 'F5S');                       // count 1 ≤ 1 → block
  const f5n2 = gatekeeper([U('noise a'), U('noise b'), UU('uid-1', 'do the task'), TOOL('Edit', { file_path: '/x/f5.ts' })], true, 'F5S'); // same uuid, shifted index → count 2 > 1 → allow
  add('gk-turnkey-survives-line-shift', f5n1.includes('"block"') && f5n2.trim() === '', 'expected F5: a uuid-keyed nudge counter persists across line-index shifts (cap=1 → the 2nd stop allows, proving no spurious reset)');
  const f5n3 = gatekeeper([UU('uid-2', 'a totally different task'), TOOL('Edit', { file_path: '/x/f5c.ts' })], true, 'F5S');           // new uuid → reset → count 1 → block
  add('gk-turnkey-resets-on-new-uuid', f5n3.includes('"block"'), 'expected F5: a new prompt uuid resets the counter so enforcement resumes on the next task');
  delete process.env.AURA_GK_MAX_NUDGES;

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
  add('gatekeeper-greatness-skips-on-no-mutation', gatekeeper([U('x'), TOOL('Edit', { file_path: '/x/README.md' }), TOOLID('g3', 'Bash', { command: 'npm test' }), RESULT('g3', '5 passed, 0 failed')], false, 'GK3').trim() === '', 'expected allow: a recorded real greatness pass clears the gate even with no mutation this turn');

  // ── F8 (audit 2026-06-17): the greatness stamp is cross-validated against REAL verification in the
  // session transcript. Confident evidence TEXT but ZERO verify events anywhere = a rubber stamp. ──
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, greatness: { passed: true, evidence: 'looks great, shipped it' } }] }));
  add('gatekeeper-greatness-needs-transcript-verify', gatekeeper([U('x'), TOOL('Bash', { command: 'echo done' })], false, 'GK3').includes('GREATNESS GATE'), 'expected block: a greatness stamp with NO real verification anywhere in the transcript is a rubber-stamp (F8)');
  add('gatekeeper-greatness-clears-with-transcript-verify', gatekeeper([U('x'), TOOLID('vf', 'Bash', { command: 'npm test' }), RESULT('vf', '5 passed, 0 failed')], false, 'GK3').trim() === '', 'expected allow: the same greatness stamp backed by a real passing verify in the transcript clears (F8)');

  // ── Convergent Refinement (2026-06-18): a `refineRequired` deliverable does NOT close on a one-shot
  // greatness — Gate 3 demands ≥AURA_GK_MIN_REFINE recorded refinement rounds (proof of convergence). ──
  process.env.AURA_GK_MIN_REFINE = '2';
  const verifTr = [U('x'), TOOLID('cv', 'Bash', { command: 'npm test' }), RESULT('cv', '5 passed, 0 failed')]; // real verify, NO adversarial skill
  const verifAdvTr = [...verifTr, TOOL('Skill', { skill: 'review' })];                                          // verify + an independent /review critic
  const DR = [{ round: 1, delta: 'edge-case hardening' }, { round: 2, delta: 'perf + a11y tuning' }];           // 2 DISTINCT, substantive (≥6 char) rounds
  const adv = { note: '/review found an off-by-one in the nudge cap; fixed + re-verified' };                    // substantive (≥24 char) adversary note
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, greatness: { passed: true, evidence: 'max refinement' } }] }));
  add('gatekeeper-convergence-blocks-without-refinements', gatekeeper(verifTr, false, 'GK3').includes('CONVERGENT REFINEMENT'), 'expected block: a refineRequired deliverable with 0 refinement rounds is not yet converged');
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, adversary: adv, greatness: { passed: true, evidence: 'eval 149/149, /review clean' } }] }));
  add('gatekeeper-convergence-allows-at-min-rounds', gatekeeper(verifTr, false, 'GK3').trim() === '', 'expected allow: distinct refine rounds + adversary record + greatness + verify clears Gate 3');
  // v1.21.0 — refineRequired greatness REQUIRES an independent adversarial pass (self-cert is not greatness)
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, greatness: { passed: true, evidence: 'eval green' } }] }));
  add('gatekeeper-convergence-needs-adversarial', gatekeeper(verifTr, false, 'GK3').includes('ADVERSARIAL PASS'), 'expected block: distinct refines but NO adversarial critic (no /review, no adversary record)');
  add('gatekeeper-adversarial-via-skill-allows', gatekeeper(verifAdvTr, false, 'GK3').trim() === '', 'expected allow: a real /review skill in the session satisfies the adversarial requirement');
  // v1.21.0 — identical refinement deltas are shallow gaming, not convergence
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: [{ round: 1, delta: 'same' }, { round: 2, delta: 'same' }], adversary: adv, greatness: { passed: true, evidence: 'clean' } }] }));
  add('gatekeeper-convergence-rejects-identical-rounds', gatekeeper(verifTr, false, 'GK3').includes('CONVERGENT REFINEMENT'), 'expected block: identical refinement deltas are not distinct rounds (anti-gaming)');
  // v1.21.0 — NO-EXCUSES: greatness evidence that is a rationalization is auto-rejected
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, adversary: adv, greatness: { passed: true, evidence: 'good enough for an mvp, future work remains' } }] }));
  add('gatekeeper-greatness-rejects-excuse-evidence', gatekeeper(verifTr, false, 'GK3').includes('GREATNESS GATE'), 'expected block: excuse-phrased greatness evidence is a rationalization, not a proof (NO-EXCUSES)');
  // ── adversarial-review hardening (independent review 2026-06-20) ──
  // C1: eslint is the Gate-1 verify, NOT an adversarial critic — running it must NOT satisfy the adversarial gate.
  const eslintTr = [U('x'), TOOLID('e', 'Bash', { command: 'npx eslint .' }), RESULT('e', '0 problems')];
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, greatness: { passed: true, evidence: 'eslint clean' } }] }));
  add('gatekeeper-eslint-is-not-adversarial', gatekeeper(eslintTr, false, 'GK3').includes('ADVERSARIAL PASS'), 'expected block: a linter (eslint) is the verify, not an independent critic (C1 bypass closed)');
  // C2: a 1-char self-written adversary note must NOT clear the adversarial gate.
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, adversary: { note: '.' }, greatness: { passed: true, evidence: 'clean' } }] }));
  add('gatekeeper-trivial-adversary-note-rejected', gatekeeper(verifTr, false, 'GK3').includes('ADVERSARIAL PASS'), 'expected block: a 1-char adversary note is not a substantive critic pass (C2)');
  // M1: a real excuse the old regex missed ("partial implementation") is now caught.
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, adversary: adv, greatness: { passed: true, evidence: 'partial implementation done; rest later' } }] }));
  add('gatekeeper-excuse-partial-implementation', gatekeeper(verifTr, false, 'GK3').includes('GREATNESS GATE'), 'expected block: "partial implementation" is an excuse (M1)');
  // M2: honest proof that MENTIONS removed placeholders/TODOs must NOT false-positive as an excuse.
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, refineRequired: true, refinements: DR, adversary: adv, greatness: { passed: true, evidence: 'removed all placeholders and TODOs; eval 153/153, /review clean' } }] }));
  add('gatekeeper-no-excuse-false-positive', gatekeeper(verifTr, false, 'GK3').trim() === '', 'expected allow: "removed all placeholders/TODOs" is honest proof, not an excuse (M2 false-positive fixed)');
  // a per-phase sub-step (greatRequired:false) closed with `done` and no greatness must NOT wedge Gate 3 (FIX E multi-item ledger)
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'phase 04', done: true, greatRequired: false }, { id: 2, desc: 'deliverable', done: true, refineRequired: true, refinements: DR, adversary: adv, greatness: { passed: true, evidence: 'proof' } }] }));
  add('gatekeeper-phase-substep-not-greatness-gated', gatekeeper(verifTr, false, 'GK3').trim() === '', 'expected allow: a done per-phase sub-step (greatRequired:false) is not treated as ungreat (no wedge)');
  delete process.env.AURA_GK_MIN_REFINE;

  // ── resilience hardening (audit 2026-06-15): greatness gate must fire WITHOUT this-turn source edit + reject rubber-stamps + catch Bash edits ──
  // FIX A — greatness gate fires on a non-editing closing turn (the dominant early-stop hole).
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true }] }));
  add('gatekeeper-greatness-blocks-done-without-mutation', gatekeeper([U('x'), TOOL('Bash', { command: 'echo hi' })], false, 'GK3').includes('GREATNESS GATE'), 'expected block: a `done` deliverable lacking real greatness is caught even on a turn that edited no source');
  // FIX B — bare/placeholder greatness evidence is a rubber-stamp, not a pass.
  writeFileSync(g3Ledger, JSON.stringify({ sessionId: 'GK3', ts: stamp(), items: [{ id: 1, desc: 'd', done: true, greatness: { passed: true, evidence: '(no evidence given)' } }] }));
  add('gatekeeper-greatness-blocks-placeholder-evidence', gatekeeper([U('x')], false, 'GK3').includes('GREATNESS GATE'), 'expected block: greatness recorded with the empty placeholder must not satisfy the gate');
  // FIX C — source edits via Bash (sed -i / redirect) count as mutation → Gate 1 demands verification.
  add('gatekeeper-bash-sed-edit-needs-verify', gatekeeper([U('x'), TOOL('Bash', { command: 'sed -i "s/a/b/" src/app.ts' })], false).includes('"block"'), 'expected block: sed -i on a .ts file with no verification');
  add('gatekeeper-bash-redirect-edit-needs-verify', gatekeeper([U('x'), TOOL('Bash', { command: 'cat > lib/util.py' })], false).includes('"block"'), 'expected block: redirect writing a .py file with no verification');
  add('gatekeeper-bash-read-not-mutation', gatekeeper([U('x'), TOOL('Bash', { command: 'cat src/app.ts' })], false).trim() === '', 'expected allow: reading a source file (cat) is not a mutation');

  // ── verification CORRECTNESS hardening (audit 2026-06-15: the gate's core job is detecting RED) ──
  // F1 — red-test vocabulary covers the major runners (a red test must NOT count as green).
  add('gatekeeper-detects-cargo-error', gatekeeper([...editNoVerify, TOOLID('vr', 'Bash', { command: 'cargo test' }), RESULT('vr', 'error[E0425]: cannot find value x')], false).includes('"block"'), 'expected block: cargo error[E…] is a failing verify');
  add('gatekeeper-detects-rspec-failures', gatekeeper([...editNoVerify, TOOLID('vr', 'Bash', { command: 'rspec' }), RESULT('vr', '5 examples, 2 failures')], false).includes('"block"'), 'expected block: rspec "N failures" is red');
  add('gatekeeper-detects-vitest-x', gatekeeper([...editNoVerify, TOOLID('vr', 'Bash', { command: 'vitest run' }), RESULT('vr', '× src/x.test.ts > does y')], false).includes('"block"'), 'expected block: vitest × marks a failed test');
  // F2 — is_error:true on the tool_result is authoritative even when the text looks clean.
  add('gatekeeper-is-error-blocks', gatekeeper([...editNoVerify, TOOLID('ve', 'Bash', { command: 'npm test' }), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 've', content: 'ok', is_error: true }] } })], false).includes('"block"'), 'expected block: tool_result is_error:true is a failed verify regardless of text');
  // F4 — a RED verify is NOT masked by a green one in the same turn (NO edit between → red still post-edit → blocks).
  add('gatekeeper-red-dominates-green', gatekeeper([...editNoVerify, TOOLID('vp', 'Bash', { command: 'tsc' }), RESULT('vp', '0 errors'), TOOLID('vf', 'Bash', { command: 'npm test' }), RESULT('vf', '2 failed')], false).includes('"block"'), 'expected block: a failing verify dominates any passing one (masking stays closed)');
  // F-RED (audit 2026-06-16) — a genuine red→EDIT(fix)→green recovery clears: the pre-fix red is STALE
  // (predates the latest edit) and must not wedge the loop. Symmetric with F-C's stale-green rule.
  add('gatekeeper-red-then-fix-then-green-clears', gatekeeper([U('fix'), TOOL('Edit', { file_path: '/x/a.ts' }), TOOLID('vr', 'Bash', { command: 'npm test' }), RESULT('vr', 'Tests: 2 failed'), TOOL('Edit', { file_path: '/x/a.ts' }), TOOLID('vg', 'Bash', { command: 'npm test' }), RESULT('vg', 'Tests: 5 passed, 0 failed')], false).trim() === '', 'expected allow: red→EDIT(fix)→green is a real recovery; a stale pre-edit red must not wedge the turn (F-RED)');
  // F9 — subagent/sidechain lines must not credit the parent gate.
  add('gatekeeper-sidechain-edit-ignored', gatekeeper([U('x'), JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/sub.ts' } }] } })], false).trim() === '', 'expected allow: a sidechain (subagent) source edit is not the parent turn mutation');
  // G-1 (audit 2026-06-16) — money/crypto source MUST be verification-gated: smart contracts (.sol),
  // DB money-models (.prisma), modern-TS (.mts) escaped the old SRC list; and the contract test runners
  // (forge/hardhat/anchor/truffle) must COUNT as verification or a tested contract gets false-blocked.
  add('gatekeeper-gates-solidity', gatekeeper([U('fix Vault.sol'), TOOL('Edit', { file_path: '/c/Vault.sol' })], false).includes('"block"'), 'expected block: an unverified .sol smart-contract edit must be gated');
  add('gatekeeper-gates-prisma', gatekeeper([U('add balance'), TOOL('Edit', { file_path: '/db/schema.prisma' })], false).includes('"block"'), 'expected block: an unverified .prisma money-model edit must be gated');
  add('gatekeeper-credits-forge-test', gatekeeper([U('fix Vault.sol'), TOOL('Edit', { file_path: '/c/Vault.sol' }), TOOLID('vf', 'Bash', { command: 'forge test' }), RESULT('vf', '[PASS] testWithdraw() (gas: 1234)')], false).trim() === '', 'expected allow: forge test (Foundry) is a valid contract verification');
  add('gatekeeper-credits-hardhat-test', gatekeeper([U('fix Vault.sol'), TOOL('Edit', { file_path: '/c/Vault.sol' }), TOOLID('vh', 'Bash', { command: 'npx hardhat test' }), RESULT('vh', '5 passing (2s)')], false).trim() === '', 'expected allow: npx hardhat test is a valid contract verification');
  // L1 — router APPENDS to the session ledger across prompts (does not clobber the open deliverable).
  // Under FIX E (2026-06-17) a fresh substantial task decomposes into N per-phase items; a follow-up
  // prompt must carry ALL of them forward and append exactly one more (no clobber, any N).
  process.env.AURA_PE_FAST = '1'; process.env.AURA_LEDGER_DIR = join(TMP, 'l1-ledger');
  run(ROUTER, JSON.stringify({ prompt: 'build the auth feature now', session_id: 'L1S' }));
  let n1 = 0; try { n1 = JSON.parse(readFileSync(join(TMP, 'l1-ledger', 'L1S.json'), 'utf8')).items.filter(x => !x.done).length; } catch {}
  run(ROUTER, JSON.stringify({ prompt: 'now add the payments module', session_id: 'L1S' }));
  let l1ok = false; try { const led = JSON.parse(readFileSync(join(TMP, 'l1-ledger', 'L1S.json'), 'utf8')); l1ok = n1 >= 1 && led.items.filter(x => !x.done).length === n1 + 1; } catch {}
  add('router-ledger-appends-not-overwrites', l1ok, 'expected the router to carry forward ALL open items + append exactly one new (no clobber), under FIX E per-phase decomposition');
  delete process.env.AURA_LEDGER_DIR;

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
  // Principles distilled from the Anthropic published-prompt audit (2026-06-14).
  add('prompt-engine-skill-first', pe.includes('[skill-first]') && pe.includes('SKILL.md'), 'skill-first (read the skill contract before acting) missing from prompt-engine');
  add('prompt-engine-substance-first', pe.includes('[substance-first]') && pe.includes('no flattery'), 'substance-first / anti-sycophancy principle missing from prompt-engine');
  add('prompt-engine-no-confabulation', pe.includes('[no-confabulation]') && pe.includes('NEVER invent'), 'anti-confabulation principle missing from prompt-engine');

  // ── pii-redactor: the secrets safety-net under bypassPermissions (was ZERO coverage; audit 2026-06-14) ──
  const PII = join(CLAUDE_H, 'pii-redactor.mjs');
  const piiBlk = run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/a.ts', content: 'const KEY = "sk_live_' + 'a'.repeat(24) + '";' } }));
  add('pii-blocks-secret', piiBlk.includes('"block"'), 'expected pii-redactor to BLOCK a hardcoded sk_live_ secret');
  add('pii-block-dual-format', piiBlk.includes('permissionDecision') && piiBlk.includes('deny'), 'expected dual-format block (hookSpecificOutput.permissionDecision:deny) so every CLI version honors it');
  add('pii-allows-clean-code', !run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/a.ts', content: 'export const sum = (a, b) => a + b;' } })).includes('"block"'), 'expected pii-redactor to allow clean code');
  // P-3/P-4/P-6 (audit 2026-06-16) — the money/crypto gate must protect FUNDS without sabotaging legit code.
  const ETH_ADDR = '0x' + 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  add('pii-allows-public-eth-address', !run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/t.ts', content: 'export const USDC = "' + ETH_ADDR + '";' } })).includes('"block"'), 'expected allow: a PUBLIC eth/contract address is not a secret (P-4 — old gate blocked all crypto code)');
  add('pii-no-modify-dollar-amount', run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/p.ts', content: 'export const price = "$1,000.00";' } })).includes('"approve"'), 'expected approve, NOT silent modify, of a $ amount in money code (P-3 — old gate corrupted it to [REDACTED])');
  add('pii-no-modify-email', run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/c.ts', content: 'export const SUPPORT = "help@acme.com";' } })).includes('"approve"'), 'expected approve, NOT silent modify, of a support email in code (P-3)');
  add('pii-blocks-hex-privatekey', run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/w.ts', content: 'const privateKey = "0x' + 'a'.repeat(64) + '";' } })).includes('"block"'), 'expected block: a context-flagged 64-hex PRIVATE KEY controls funds (P-6 — old gate missed it entirely)');
  add('pii-allows-sha256-hash', !run(PII, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/h.ts', content: 'const fileHash = "' + 'a'.repeat(64) + '";' } })).includes('"block"'), 'expected allow: a bare 64-hex sha256/git hash is not a private key (P-6 no false-positive)');

  // Claude Code identifies the event via `hook_event_name` (NOT hook_type). Test with the REAL field
  // (the old fixture used hook_type → false green while PostCompact was dead in production, audit 2026-06-18).
  const post = run(COMPACT, JSON.stringify({ hook_event_name: 'PostCompact' }));
  add('compact-auto-resume', post.includes('AUTO-RESUMED') && post.includes('MAXXING-SDR'), 'compact PostCompact (hook_event_name) missing AUTO-RESUMED marker');
  // Discrimination: PreCompact must NOT emit the auto-resume block (else it fires on the wrong event).
  const pre = run(COMPACT, JSON.stringify({ hook_event_name: 'PreCompact' }));
  add('compact-precompact-no-autoresume', !pre.includes('AUTO-RESUMED'), 'PreCompact must not emit the PostCompact AUTO-RESUMED block');
  // L6 end-to-end THROUGH compact-hooks with the real field: PreCompact stamps lineage → PostCompact migrates.
  const cDir = join(TMP, 'compact-l6'); mkdirSync(cDir, { recursive: true });
  const cLin = join(cDir, 'lineage.json');
  writeFileSync(join(cDir, 'OLDS.json'), JSON.stringify({ sessionId: 'OLDS', ts: Math.floor(Date.now() / 1000), items: [{ id: 1, desc: 'unfinished', done: false }] }));
  const cEnv = { ...process.env, AURA_LEDGER_DIR: cDir, AURA_LINEAGE_FILE: cLin };
  try { execSync(`node "${COMPACT}"`, { input: JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'OLDS' }), env: cEnv, timeout: 6000 }); } catch {}
  try { execSync(`node "${COMPACT}"`, { input: JSON.stringify({ hook_event_name: 'PostCompact', session_id: 'NEWS' }), env: cEnv, timeout: 6000 }); } catch {}
  let cMig = {}; try { cMig = JSON.parse(readFileSync(join(cDir, 'NEWS.json'), 'utf8')); } catch {}
  add('compact-l6-migrates-end-to-end', (cMig.items || []).some(x => x.desc === 'unfinished' && !x.done), 'expected L6: PreCompact→PostCompact through compact-hooks migrates open work to the new session (real hook_event_name field)');

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

  // ── nlm-writer `source add-research` injection-safe path (regression for commit 9ab79b6) ──
  // A malicious URL payload carrying $()/backticks must be SINGLE-quoted (shq) before it reaches the
  // NLM CLI, so the shell that spawns the CLI can't execute the substitution. We run the LIVE writer
  // under a throwaway HOME with a fake `notebooklm` on PATH (it only records its argv), buffer a
  // research URL containing $(touch CANARY), flush, and assert the canary was NEVER created — the
  // double-quoted regression would have executed it. `node evals/run.mjs` now catches a silent revert.
  // Test the REPO-local writer (the artifact this branch protects); the installed ~/auramaxing copy
  // may lag behind the repo's escaping fix, so resolve relative to this eval file, not AURA_H.
  const NLM_WRITER = join(new URL('..', import.meta.url).pathname, 'helpers', 'nlm-writer.mjs');
  const nlmHome = join(TMP, 'nlm-home');
  mkdirSync(join(nlmHome, '.auramaxing'), { recursive: true });
  mkdirSync(join(nlmHome, 'bin'), { recursive: true });
  const nlmCanary = join(nlmHome, 'CANARY');
  const nlmLog = join(nlmHome, 'nlm-argv.log');
  // research routes to global.projects — seed it so writeEntry reaches the source-research branch.
  writeFileSync(join(nlmHome, '.auramaxing', 'nlm-notebooks.json'),
    JSON.stringify({ projects: {}, global: { projects: '00000000-0000-0000-0000-000000000000' } }));
  // Fake CLI: record args, never execute them, exit 0 — any injection must already have fired upstream.
  writeFileSync(join(nlmHome, 'bin', 'notebooklm'), '#!/bin/sh\necho "$@" >> "$AURA_NLM_LOG"\nexit 0\n', { mode: 0o755 });
  const nlmEnv = { ...process.env, HOME: nlmHome, AURA_NLM_LOG: nlmLog, PATH: `${join(nlmHome, 'bin')}:${process.env.PATH}` };
  const nlmEvilUrl = `https://evil.test/x$(touch ${nlmCanary})`;
  try {
    execSync(`node "${NLM_WRITER}" buffer research --title inj-test --project injproj`, { input: nlmEvilUrl, encoding: 'utf8', timeout: 8000, env: nlmEnv });
    execSync(`node "${NLM_WRITER}" flush`, { encoding: 'utf8', timeout: 20000, env: nlmEnv });
  } catch {}
  let nlmLogTxt = ''; try { nlmLogTxt = readFileSync(nlmLog, 'utf8'); } catch {}
  add('nlm-source-research-injection-safe',
    !existsSync(nlmCanary) && nlmLogTxt.includes('source add-research'),
    'expected nlm-writer to single-quote the source add-research URL payload — a $() injection in the URL must NOT execute (regression guard for the shq escaping fix at nlm-writer.mjs:141)');

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

  // ── OPUS-ONLY window (standing default): forces Opus, suppresses the normal delegate, expires alone ──
  const fwActive = join(TMP, 'fw-active.json'); writeFileSync(fwActive, JSON.stringify({ until: '2099-01-01' }));
  const fwExpired = join(TMP, 'fw-expired.json'); writeFileSync(fwExpired, JSON.stringify({ until: '2020-01-01' }));
  const routerFW = (fw) => {
    try { return execSync(`node "${ROUTER}"`, { input: JSON.stringify({ prompt: 'build a payments feature with stripe integration' }), encoding: 'utf8', timeout: 8000, env: { ...process.env, AURA_OPUS_WINDOW: fw, AURA_BILLION_FLAG: join(TMP, 'no-bflag.json') } }); }
    catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  const fwOn = routerFW(fwActive), fwOff = routerFW(fwExpired);
  add('opus-window-active-suppresses-delegate', fwOn.includes('MAXIMUM SPEC, EVERYWHERE') && !fwOn.includes('10x FORCED DILIGENCE'), 'expected OPUS-MAX window directive + suppressed normal delegate while active');
  add('opus-window-expired-restores-delegate', !fwOff.includes('MAXIMUM SPEC, EVERYWHERE') && fwOff.includes('10x FORCED DILIGENCE'), 'expected normal Opus delegate directive after the window date');
  const guardFW = (fw) => {
    try { return execSync(`node "${join(CLAUDE_H, 'ultramax-guard.mjs')}"`, { input: JSON.stringify({ tool_name: 'Agent', session_id: 'FWX', tool_input: { model: 'sonnet', prompt: 'ultrathink. ZERO-TOLERANCE frame... do x' } }), encoding: 'utf8', timeout: 5000, env: { ...process.env, AURA_OPUS_WINDOW: fw, AURA_ULTRAMAX_FLAG: join(TMP, 'no-umx.json') } }); }
    catch (e) { return (e.stdout || '') + (e.stderr || ''); }
  };
  add('opus-window-guard-blocks-nonopus', guardFW(fwActive).includes('"block"'), 'expected guard to block sonnet (even framed) while the opus window is active');
  add('opus-window-guard-expired-allows-framed', guardFW(fwExpired).includes('"approve"'), 'expected framed sonnet allowed after window expiry (normal mode)');

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
  // F8 (2026-06-17): a greatness stamp now requires a real verify in the transcript to clear Gate 3,
  // so the "all objectives closed → allow" fixture carries a passing verify (closed AND verified).
  add('billion-watchdog-needs-open-objectives', gatekeeper([U('x'), TOOLID('bv', 'Bash', { command: 'npm test' }), RESULT('bv', '5 passed, 0 failed')], true, 'BWA').trim() === '', 'expected allow when every objective is closed (greatness backed by a real verify, F8)');
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

  // ── ultramax-guard cases (Opus-4.8-only fleet at MAX presets) ─────────────
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
  add('ultramax-allows-opus-ultrathink', guardRun('Agent', { model: 'opus', prompt: 'ultrathink. do x' }).includes('"approve"'), 'expected approve: opus model + ultrathink prompt');
  add('ultramax-blocks-fable-spawn', guardRun('Agent', { model: 'fable', prompt: 'ultrathink. do x' }).includes('"block"'), 'expected block: fable spawn while ULTRAMAX (Opus-exclusive) active');
  add('ultramax-allows-inherit-ultrathink', guardRun('Agent', { prompt: 'ultrathink. do x' }).includes('"approve"'), 'expected approve: inherited (Opus) model + ultrathink prompt');
  add('ultramax-blocks-missing-ultrathink', guardRun('Agent', { prompt: 'do x' }).includes('"block"'), 'expected block: fleet spawn prompt missing "ultrathink" (max-thinking lock)');
  add('ultramax-blocks-workflow-model-override', guardRun('Workflow', { script: "await agent('x', {model: 'sonnet'})" }).includes('"block"'), 'expected block: workflow script overrides an agent onto sonnet');
  add('ultramax-allows-workflow-no-override', guardRun('Workflow', { script: "await agent('ultrathink. x', {schema: S})" }).includes('"approve"'), 'expected approve: workflow with no model overrides (inherits Opus)');
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

  // ── L6 (audit 2026-06-17): handoff-aware ledger migration — after auto-compact the new session id
  // must INHERIT the predecessor's OPEN items, else Gate 2/3 silently fail-open across the handoff. ──
  const LEDGER_CLI = join(CLAUDE_H, 'ledger.mjs');
  const migDir = join(TMP, 'mig'); mkdirSync(migDir, { recursive: true });
  writeFileSync(join(migDir, 'FROM.json'), JSON.stringify({ sessionId: 'FROM', ts: Math.floor(Date.now() / 1000), items: [{ id: 1, desc: 'open work', done: false }, { id: 2, desc: 'done work', done: true }] }));
  try { execSync(`node "${LEDGER_CLI}" migrate FROM TO`, { env: { ...process.env, AURA_LEDGER_DIR: migDir }, timeout: 5000 }); } catch {}
  let mig = {}; try { mig = JSON.parse(readFileSync(join(migDir, 'TO.json'), 'utf8')); } catch {}
  add('ledger-migrate-carries-open-items', mig.sessionId === 'TO' && (mig.items || []).some(x => x.desc === 'open work' && !x.done), 'expected L6: migrate re-stamps the predecessor OPEN items onto the successor session');
  add('ledger-migrate-drops-done-items', !((mig.items || []).some(x => x.desc === 'done work')), 'expected L6: already-done items are history, not carried across the handoff');

  // ── Convergent Refinement (2026-06-18): `ledger.mjs refine` records numbered refinement rounds. ──
  const refDir = join(TMP, 'ref'); mkdirSync(refDir, { recursive: true });
  writeFileSync(join(refDir, 'R.json'), JSON.stringify({ sessionId: 'R', ts: Math.floor(Date.now() / 1000), items: [{ id: 1, desc: 'd', done: false }] }));
  try {
    execSync(`node "${LEDGER_CLI}" refine 1 "round 1: edge cases" --session R`, { env: { ...process.env, AURA_LEDGER_DIR: refDir }, timeout: 5000 });
    execSync(`node "${LEDGER_CLI}" refine 1 "round 2: converged" --session R`, { env: { ...process.env, AURA_LEDGER_DIR: refDir }, timeout: 5000 });
  } catch {}
  let ref = {}; try { ref = JSON.parse(readFileSync(join(refDir, 'R.json'), 'utf8')); } catch {}
  add('ledger-refine-records-rounds', (ref.items?.[0]?.refinements || []).length === 2 && ref.items[0].refinements[1].round === 2, 'expected: ledger.mjs refine appends numbered refinement rounds');

  // ── FIX E (audit 2026-06-17): the router decomposes a FRESH substantial action task into PER-PHASE
  // ledger items (incl. the greatness gate) instead of one generic blob — both prior audits' top ask. ──
  const fixeDir = join(TMP, 'fixe'); mkdirSync(fixeDir, { recursive: true });
  let fixe = {};
  try {
    execSync(`node "${ROUTER}"`, { input: JSON.stringify({ prompt: 'build a complete new payments dashboard with auth, error states and tests', session_id: 'FIXE' }), env: { ...process.env, AURA_LEDGER_DIR: fixeDir }, encoding: 'utf8', timeout: 8000 });
    fixe = JSON.parse(readFileSync(join(fixeDir, 'FIXE.json'), 'utf8'));
  } catch {}
  add('fixe-router-per-phase-ledger', (fixe.items || []).length >= 4 && (fixe.items || []).some(x => /Phase 08/.test(x.desc)) && (fixe.items || []).some(x => /Phase 05 TEST/.test(x.desc)), 'expected FIX E: a fresh substantial action task is decomposed into per-phase ledger items incl. a greatness item');
  add('fixe-router-marks-refine-required', (fixe.items || []).some(x => x.refineRequired === true) && (fixe.items || []).some(x => x.greatRequired === false), 'expected Convergent Refinement: router marks the deliverable refineRequired + per-phase sub-steps greatRequired:false');

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
