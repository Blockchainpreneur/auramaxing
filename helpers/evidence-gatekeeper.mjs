#!/usr/bin/env node
/**
 * AURAMAXING Evidence Gatekeeper (Stop hook) — anti-laziness teeth, v3.
 *
 * Verifies OUTCOMES, not utterances. Blocks the turn from ending when:
 *   (Gate 1) source was changed without a PASSING verification, OR
 *   (Gate 2) the session task-ledger still has OPEN items (long-horizon completion), OR
 *   (Gate 3) source changed + deliverable marked done WITHOUT the Absolute-Greatness pass.
 *
 * v3 — "10x more rigorous, stop nothing early" (the loop must not give up after one block):
 *   - PERSISTENT BOUNDED RE-BLOCK: in normal/ULTRAMAX mode the gate now re-blocks on EVERY
 *     stop attempt while a gate is still failing — not just once. Bounded by AURA_GK_MAX_NUDGES
 *     (default 20) per user-prompt, auto-reset when the prompt changes (turnKey). Previously a
 *     single block then `stop_hook_active → ALLOW` let the loop die after one nudge; that was the
 *     "loops stop way before they should" hole. Now the loop persists to 100/100 or the cap.
 *   - Wider analysis budget (4.5s self-timeout, 5s hook budget) so long-loop transcripts still get
 *     inspected instead of failing open.
 *   - Longer ledger freshness (24h) so a long-running task stays enforced.
 *
 * SAFETY (fail-open by design — can NEVER wedge a turn):
 *   - Kill-switch: AURA_GATEKEEPER_OFF=1 disables entirely.
 *   - Bounded: at most AURA_GK_MAX_NUDGES re-blocks per prompt, then ALLOW.
 *   - No session id → original single-block behavior (block once, then allow) — can't bound, so don't loop.
 *   - Any parse/IO error → ALLOW. Self-timeout → ALLOW.
 *   - Ledger ignored unless same-session AND fresh (<24h); malformed/missing → ALLOW.
 *   - BILLION mode keeps its own dedicated watchdog (separate cap + message); not double-counted here.
 *   - Only gates real SOURCE files; docs/markdown/json/config excluded.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ALLOW = () => process.exit(0);
if (process.env.AURA_GATEKEEPER_OFF === '1') ALLOW();
const timeout = setTimeout(ALLOW, Number(process.env.AURA_GK_TIMEOUT_MS) || 4500);

// Source extensions that warrant verification when changed. Docs/config intentionally excluded.
// Money/crypto coverage (audit 2026-06-16, G-1): smart contracts (.sol Solidity, .vy Vyper,
// .move, .cairo) + modern TS module variants (.mts/.cts) + DB money-models (.prisma) were
// ESCAPING the gate — a contract/schema edit could end the turn with ZERO verification. Added.
const SRC = /\.(tsx?|mtsx?|ctsx?|jsx?|mjs|cjs|vue|svelte|astro|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|php|css|scss|sql|sol|vy|move|cairo|prisma)$/i;
// Source edits made through the SHELL (sed -i / tee / >|>> redirection into a code file) — so Gate 1/3
// can't be escaped by writing code via Bash instead of the Edit/Write tools (audit 2026-06-15, hole H3).
const BASH_SRC_WRITE = /\b(?:sed\s+-i\b|tee\b)[^|;&\n]*\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|php|css|scss|sql)\b|[>]{1,2}\s*['"]?[^\s'"|;&]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|php|css|scss|sql)\b/i;
// Real test/build/lint RUNNERS. Generic verbs match ONLY at command position behind a real runner,
// so `echo test`, `cat tests/x`, `ls test/` do not pass the gate.
// Real test/build/lint RUNNERS. Includes smart-contract toolchains (audit 2026-06-16, G-1 follow-up):
// Foundry `forge test`, `hardhat test`/`npx hardhat test`, Solana `anchor test`, `truffle test` — without
// these the gate would NOT credit a crypto dev who DID test their contract, and false-block the loop.
const VERIFY_CMD = /\b(vitest|jest|pytest|playwright|tsc|eslint|ruff|mypy|pyright|rspec|phpunit)\b|\bcargo\s+(test|check|clippy)\b|\bgo\s+test\b|\bdotnet\s+test\b|\bdeno\s+(test|check)\b|\bnode\s+--(check|test)\b|(?:^|[;&|]\s*)(?:npm|yarn|pnpm|bun|make)\s+(?:run\s+)?(?:test|build|lint|type-?check|check)\b|\b(?:forge|hardhat|anchor|truffle)\s+(?:test|build|check|coverage)\b|\bnpx\s+(?:hardhat|truffle)\b|\bevals?\/run\.mjs\b/i;
// gstack/skills that count as verification.
const VERIFY_SKILL = new Set(['qa', 'qa-only', 'review', 'cso', 'verify', 'investigate', 'design-review', 'benchmark', 'canary']);
// Failure signals inside a verify command's RESULT.
// Failure vocabulary covers the major runners (audit 2026-06-15 F1): vitest `×`, eslint `✖`,
// cargo `error[E…]`, rspec `N failures`, go/make `*** Error`, panics, exited-with-status N.
const FAIL_I = /\b[1-9]\d*\s+(?:failed|failing|failures?|errors?)\b|[✗✖×❌]|\berror(?:\s+TS\d|\[E?\d)|Traceback \(most recent call last\)|AssertionError|\bpanic:|\bELIFECYCLE\b|npm error|exit(?:ed)?(?:\s+with)?\s+(?:code|status)\s+[1-9]|make(?:\[\d+\])?:\s*\*\*\*|\bnon-zero exit\b/i;
const FAIL_CS = /\bFAILED\b|\bFAIL\s+\S/;
const isFail = (t) => FAIL_I.test(t) || FAIL_CS.test(t);

const STALE_SEC = 24 * 3600; // ledger freshness window — long tasks stay enforced

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString().trim() || '{}'); } catch { return {}; }
}

const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c || ''));

// Stable-ish key for the CURRENT user prompt, so the nudge counter auto-resets when the prompt changes.
function turnKeyOf(line, idx) {
  try {
    const o = JSON.parse(line);
    const t = text(o.message?.content ?? o.content).slice(0, 160);
    let h = 0; const s = idx + '|' + t;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return String(h >>> 0);
  } catch { return String(idx); }
}

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
  const turnKey = turnKeyOf(lines[start] || '', start);
  const mutated = [];
  const verifyIds = [];           // tool_use ids of verify Bash commands this turn
  const verifyPos = {};           // tool_use_id -> line index (for STALE-VERIFY ordering, F-C)
  const resultById = {};          // tool_use_id -> result text
  const errorById = {};           // tool_use_id -> is_error:true (authoritative fail bit, F2)
  let lastMutatePos = -1;         // line index of the LAST source mutation this turn (F-C)
  let skillVerifyPos = -1;        // line index of the last verifying Skill call (F-C)
  for (let i = start; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.isSidechain) continue;  // subagent/sidechain lines must NOT credit the PARENT's gate (F9)
    const content = o.message?.content ?? o.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item) continue;
      if (item.type === 'tool_result' && item.tool_use_id) {
        resultById[item.tool_use_id] = text(item.content);
        if (item.is_error === true) errorById[item.tool_use_id] = true;
        continue;
      }
      if (item.type !== 'tool_use') continue;
      const name = item.name || '';
      const inp = item.input || {};
      if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') {
        const fp = inp.file_path || inp.notebook_path || '';
        if (SRC.test(fp)) { mutated.push(fp); lastMutatePos = i; }
      }
      if (name === 'Bash' && typeof inp.command === 'string') {
        if (VERIFY_CMD.test(inp.command)) { verifyIds.push(item.id); verifyPos[item.id] = i; }
        if (BASH_SRC_WRITE.test(inp.command)) { mutated.push('bash-edit:' + inp.command.slice(0, 60)); lastMutatePos = i; }
      }
      if (name === 'Skill' && VERIFY_SKILL.has((inp.skill || '').toLowerCase())) skillVerifyPos = i;
      // Task/Agent intentionally NOT counted: spawning an agent is an utterance, not an outcome.
    }
  }
  // RED DOMINATES (F2+F4): a verify "failed" if its tool_result carried is_error:true OR its captured
  // text matches a failure signal. A SINGLE failing verify means NOT verified — even if other verifies
  // are green (the old `some(!isFail)` let one green mask a red). An UNCAPTURED result still leans OK
  // (Stop fires after results land; preserves fail-open for the not-yet-flushed edge).
  const vFailed = (id) => errorById[id] === true || (resultById[id] != null && isFail(resultById[id]));
  // STALE-VERIFY GUARD (F-C audit 2026-06-15 + F-RED audit 2026-06-16): a verify — RED or GREEN — only
  // counts if it ran STRICTLY AFTER the last source mutation. A check that predates your latest edit
  // reflects OLD code: a stale GREEN must not clear the gate (F-C), and SYMMETRICALLY a stale RED must
  // not wedge it (F-RED). The old `anyFailed = some(vFailed)` scanned ALL verifies, so once anything went
  // red the turn could never clear even after a genuine red→edit→green recovery — bounded only by the
  // nudge cap. Restricting BOTH sides to `> lastMutatePos` is masking-SAFE: the green-masks-red attack
  // (real test red → trivial test green, with NO edit between) keeps the red AFTER lastMutatePos, so red
  // still dominates within the post-mutation window. Only a real red→EDIT→green (you fixed and re-ran)
  // clears. `>` excludes same-line parallel calls (they run against pre-edit state).
  const afterEdit = (id) => verifyPos[id] > lastMutatePos;
  const anyFailedAfter = verifyIds.some(id => afterEdit(id) && vFailed(id));   // red dominates the post-edit window
  const anyOkAfter     = verifyIds.some(id => afterEdit(id) && !vFailed(id));
  const skillVerified  = skillVerifyPos > lastMutatePos;   // skill verification must also post-date the edit
  const cmdVerified = anyOkAfter && !anyFailedAfter;
  const ranButFailed = anyFailedAfter;                     // a POST-edit red is the only "ran but failed"
  return { mutated: [...new Set(mutated)], verified: cmdVerified || skillVerified, ranButFailed, turnKey };
}

function ledgerPath(sessionId) {
  if (process.env.AURA_LEDGER_FILE) return process.env.AURA_LEDGER_FILE;
  const dir = process.env.AURA_LEDGER_DIR || join(homedir(), '.auramaxing', 'ledger');
  const per = join(dir, `${sessionId}.json`);
  if (sessionId && existsSync(per)) return per;        // per-session (concurrent-safe)
  return join(homedir(), '.auramaxing', 'ledger.json'); // legacy fallback
}

function openLedger(sessionId) {
  try {
    const p = ledgerPath(sessionId);
    if (!existsSync(p)) return null;
    const l = JSON.parse(readFileSync(p, 'utf8'));
    if (!l || !Array.isArray(l.items)) return null;
    if (!sessionId || l.sessionId !== sessionId) return null;                   // STRICTLY session-scoped
    if (l.ts && (Math.floor(Date.now() / 1000) - l.ts) > STALE_SEC) return null; // stale → ignore
    const open = l.items.filter(x => x && !x.done);
    return open.length ? open : null;
  } catch { return null; }
}

// Gate 3 helper — done items lacking a recorded Absolute-Greatness pass, for THIS session, fresh.
function greatnessPending(sessionId) {
  try {
    const p = ledgerPath(sessionId);
    if (!existsSync(p)) return [];
    const l = JSON.parse(readFileSync(p, 'utf8'));
    if (!l || !Array.isArray(l.items)) return [];
    if (!sessionId || l.sessionId !== sessionId) return [];
    if (l.ts && (Math.floor(Date.now() / 1000) - l.ts) > STALE_SEC) return [];
    // A `great` close counts ONLY with real evidence — bare `done`, empty, or the ledger.mjs
    // default placeholder "(no evidence given)" do NOT satisfy greatness (audit 2026-06-15, hole H1/B).
    const hasRealGreatness = (x) => x.greatness && x.greatness.passed &&
      typeof x.greatness.evidence === 'string' && x.greatness.evidence.trim().length > 0 &&
      x.greatness.evidence.trim() !== '(no evidence given)';
    return l.items.filter(x => x && x.done && !hasRealGreatness(x));
  } catch { return []; }
}

// Highest-priority FAILING gate → its block message (or null if every gate passes).
function failingGateMessage(sessionId, mutated, verified, ranButFailed) {
  // Gate 1 — source changed without PASSING verification.
  if (mutated.length > 0 && !verified) {
    const sample = mutated.slice(0, 6).map(f => '  - ' + f.replace(homedir(), '~')).join('\n');
    const head = ranButFailed
      ? 'EVIDENCE GATE — do NOT stop. Your verification ran but FAILED (red). You changed source and the test/build did not pass:'
      : 'EVIDENCE GATE — do NOT stop. You changed source code but produced ZERO passing verification this turn:';
    return [head, sample, '',
      'Produce EVIDENCE (not "should work"):',
      '  1. ROOT CAUSE with file:line.',
      '  2. RUN the real check (tests / build / typecheck / lint, or /qa · /review · /cso) and PASTE the PASSING output.',
      '  3. REGRESSION — add/run a test that would have caught this; show it green.',
      '  4. If red, fix and re-run. Loop to 100/100, then stop.',
      'Kill-switch: AURA_GATEKEEPER_OFF=1 only if verification is genuinely impossible here.'].join('\n');
  }
  // Gate 2 — open session ledger (long-horizon completion forcing).
  const open = openLedger(sessionId);
  if (open) {
    const items = open.slice(0, 8).map(x => `  [${x.id}] ${x.desc}`).join('\n');
    return ['COMPLETENESS GATE — do NOT stop. The task ledger has OPEN items for this session:',
      items, '',
      'Finish them (or explicitly de-scope with the user). As each completes, mark it:',
      `  node ~/.claude/helpers/ledger.mjs done <id> --session ${sessionId || ''}`,
      'The gate clears when all items are done. Never stop with open work — the ledger is what context forgets.',
      'Kill-switch: AURA_GATEKEEPER_OFF=1.'].join('\n');
  }
  // Gate 3 — ABSOLUTE GREATNESS GATE (Phase 08). DECOUPLED from this-turn source mutation:
  // fires whenever a DONE deliverable lacks a REAL greatness pass. The old `if (mutated.length>0)`
  // wrap let a bare-`done` item end the turn on any non-editing closing turn — the dominant
  // resilience hole (audit 2026-06-15: greatness "almost never fired"). Fail-open preserved
  // (no/stale/wrong-session ledger → greatnessPending returns []).
  const pending = greatnessPending(sessionId);
  if (pending.length) {
    const items = pending.slice(0, 8).map(x => `  [${x.id}] ${x.desc}`).join('\n');
    return ['ABSOLUTE GREATNESS GATE — do NOT stop. The deliverable is marked done WITHOUT a real greatness pass (Phase 08):',
      items, '',
      'Closing with bare `done` (or empty / "(no evidence given)" evidence) does NOT satisfy the gate. Answer all THREE, each YES with EVIDENCE:',
      '  Q1. Does it meet/exceed the 20x hypothesis (measurable evidence)?',
      '  Q2. Would the 3 best-in-class references consider this competitive or better?',
      '  Q3. Is it production-ready RIGHT NOW (not "needs polish", not "MVP-fine")?',
      `Then record the pass with REAL evidence:  node ~/.claude/helpers/ledger.mjs great <id> "<specific evidence>" --session ${sessionId || ''}`,
      'Kill-switch: AURA_GATEKEEPER_OFF=1.'].join('\n');
  }
  return null;
}

// ── GENERAL BOUNDED RE-BLOCK COUNTER (normal/ULTRAMAX) ──────────────────────
// Returns {count,cap} while under cap (→ block), or null when the cap is exhausted (→ allow).
// Auto-resets when the user prompt (turnKey) changes. Persisted per session so it survives the
// separate hook processes of one turn. Needs a sessionId to be bounded; without one → null (allow).
function gkNudge(sessionId, turnKey) {
  try {
    if (!sessionId) return null;
    const cap = Math.max(1, parseInt(process.env.AURA_GK_MAX_NUDGES || '20', 10) || 20);
    const dir = process.env.AURA_GK_NUDGE_DIR || join(homedir(), '.auramaxing', 'gk-nudges');
    const fp = join(dir, `${sessionId}.json`);
    let st = {};
    try { st = JSON.parse(readFileSync(fp, 'utf8')) || {}; } catch {}
    if (st.turnKey !== turnKey) st = { turnKey, count: 0 };
    st.count = (st.count || 0) + 1;
    try { mkdirSync(dir, { recursive: true }); writeFileSync(fp, JSON.stringify(st)); } catch {}
    if (st.count > cap) return null;                     // budget exhausted → allow
    return { count: st.count, cap };
  } catch { return null; }                               // any error → allow (never wedge)
}

// ── BILLION WATCHDOG (the perpetual engine does not stop with open objectives) ──
function isBillionArmed(sessionId) {
  try {
    if (!sessionId) return false;
    const bf = process.env.AURA_BILLION_FLAG || join(homedir(), '.auramaxing', 'billion-mode.json');
    if (!existsSync(bf)) return false;
    const f = JSON.parse(readFileSync(bf, 'utf8'));
    return !!f && f.sessionId === sessionId && (Math.floor(Date.now() / 1000) - (f.ts || 0)) <= 24 * 3600;
  } catch { return false; }
}

function billionNudge(sessionId) {
  try {
    if (!sessionId) return null;
    const bf = process.env.AURA_BILLION_FLAG || join(homedir(), '.auramaxing', 'billion-mode.json');
    if (!existsSync(bf)) return null;
    const f = JSON.parse(readFileSync(bf, 'utf8'));
    if (!f || f.sessionId !== sessionId) return null;
    if ((Math.floor(Date.now() / 1000) - (f.ts || 0)) > 24 * 3600) return null;
    const open = openLedger(sessionId);
    if (!open) return null;
    const cap = Math.max(1, parseInt(process.env.AURA_BILLION_NUDGES || '12', 10) || 12);
    const count = (f.nudges || 0) + 1;
    if (count > cap) return null;                       // budget cap → allow the stop
    f.nudges = count;
    writeFileSync(bf, JSON.stringify(f));
    return { count, cap, open };
  } catch { return null; }
}

function block(reason) { clearTimeout(timeout); process.stdout.write(JSON.stringify({ decision: 'block', reason })); process.exit(0); }

async function main() {
  try {
    const input = await readStdin();
    const sessionId = input.session_id;
    const tp = input.transcript_path;
    if (!tp || !existsSync(tp)) ALLOW();                  // can't inspect → fail-open

    let mutated, verified, ranButFailed, turnKey;
    try { ({ mutated, verified, ranButFailed, turnKey } = analyzeTurn(tp)); } catch { ALLOW(); }

    const msg = failingGateMessage(sessionId, mutated, verified, ranButFailed);
    if (!msg) ALLOW();                                    // every gate passes → stop is allowed

    // ── BILLION mode: dedicated watchdog owns the re-nudge loop (separate cap + message) ──
    if (isBillionArmed(sessionId)) {
      if (!input.stop_hook_active) block(msg);            // first stop in a billion session → standard gate block
      const bn = billionNudge(sessionId);
      if (bn) {
        const items = bn.open.slice(0, 6).map(x => `  [${x.id}] ${x.desc.slice(0, 160)}`).join('\n');
        block(['🚀 BILLION WATCHDOG (nudge ' + bn.count + '/' + bn.cap + ') — the perpetual engine does NOT stop with open objectives:',
          items, '',
          'CONTINUE the top objective NOW — resume-first: read ~/.auramaxing/billion/<project>/STATE.json + GOALS.md and act.',
          'If an objective is GENUINELY blocked externally: write the blocker to STATE.json, move the human-facing part to SUGGESTIONS.md,',
          'pick the next autonomous objective and keep working. Only if NOTHING can advance: SCHEDULE continuation (the loop skill / cron),',
          'quote the schedule as evidence, then close the ledger items that are truly done with `ledger.mjs done/great <id> --session ' + (sessionId || '') + '`.',
          'The loop exits ONLY on: goal/revenue gate met · budget cap · "billion off" · detected dead-end. Kill-switch: AURA_GATEKEEPER_OFF=1.'].join('\n'));
      }
      // billion watchdog returned null. If an OPEN LEDGER exists, the billion cap governs → allow.
      // Otherwise a Gate-1/Gate-3 failure remains (unverified source / no real greatness) — do NOT
      // single-shot allow; fall through to the general bounded nudge so it keeps re-blocking (F10).
      if (openLedger(sessionId)) ALLOW();
    }

    // ── NORMAL / ULTRAMAX mode ──────────────────────────────────────────────
    // No session id → can't bound a multi-block loop safely → original single-block behavior.
    if (!sessionId) {
      if (input.stop_hook_active) ALLOW();                // loop-guard (block at most once)
      block(msg);
    }

    // Has session → PERSISTENT BOUNDED enforcement: re-block on every stop until the gate
    // passes or the per-prompt nudge budget is exhausted. This is the "don't stop early" fix.
    const gk = gkNudge(sessionId, turnKey);
    if (!gk) ALLOW();                                     // cap exhausted → allow (never wedge)
    block(input.stop_hook_active
      ? msg + `\n\n— LOOP CONTINUATION ${gk.count}/${gk.cap}: the gate is STILL failing. Do NOT stop. Keep working to 100/100. (Bounded by AURA_GK_MAX_NUDGES; AURA_GATEKEEPER_OFF=1 overrides if genuinely impossible.)`
      : msg);
  } catch {
    ALLOW();                                              // any error → fail-open
  }
}
main().catch(ALLOW);
