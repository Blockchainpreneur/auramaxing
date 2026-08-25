#!/usr/bin/env node
/**
 * AURAMAXING update-gate — UserPromptSubmit hook
 *
 * Blocks prompt processing when a newer AURAMAXING version is available.
 * Fail-open: any error → exit 0 (never bricks the user).
 * Kill-switch: AURA_UPDATE_GATE_OFF=1 → exit 0 immediately.
 * Testability: AURA_UPDATE_STATE_FILE overrides the state path.
 *
 * Block mechanism: exit 2 (UserPromptSubmit + exit 2 = prompt rejected, stderr shown).
 * Per hooks docs: "UserPromptSubmit: blocks prompt processing and erases the prompt"
 * when the hook exits with code 2.
 *
 * Background refresh: spawn update-check.sh --write-state detached (stdio ignored).
 * Total inline runtime target: <300ms.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

const HOME = homedir();

// ── Semver compare (no deps) ───────────────────────────────────────────────
// Returns true if remote > local (numeric segment compare)
function semverGt(local, remote) {
  const toSegs = (v) => String(v).trim().split('.').map(s => parseInt(s, 10) || 0);
  const l = toSegs(local);
  const r = toSegs(remote);
  const len = Math.max(l.length, r.length);
  for (let i = 0; i < len; i++) {
    const lv = l[i] ?? 0;
    const rv = r[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// ── Spawn background refresh (detached, unref'd) ──────────────────────────
function spawnRefresh() {
  try {
    const script = join(HOME, 'auramaxing', 'scripts', 'update-check.sh');
    const child = spawn('bash', [script, '--write-state'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (_) { /* never propagate */ }
}

// ── Main ──────────────────────────────────────────────────────────────────
try {
  // Kill-switch
  if (process.env.AURA_UPDATE_GATE_OFF === '1') process.exit(0);

  const STATE_FILE = process.env.AURA_UPDATE_STATE_FILE
    || join(HOME, '.auramaxing', 'update-state.json');

  // If state file missing or stale (>6h), spawn refresh and allow this turn
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  if (!existsSync(STATE_FILE)) {
    spawnRefresh();
    process.exit(0);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    spawnRefresh();
    process.exit(0);
  }

  // Validate shape
  if (!state || typeof state.checkedAt !== 'number' ||
      typeof state.local !== 'string' || typeof state.remote !== 'string') {
    spawnRefresh();
    process.exit(0);
  }

  // Stale? → refresh in background, allow this turn
  if (Date.now() - state.checkedAt > SIX_HOURS_MS) {
    spawnRefresh();
    process.exit(0);
  }

  // Compare versions
  if (semverGt(state.local, state.remote)) {
    // ONE grace prompt per published version. A hard block on the very first prompt
    // means the model never runs, so the update WINDOW (AskUserQuestion, emitted by
    // the router) never renders and the user just hits a wall. The grace turn shows
    // the window — with the pricing notice and a one-click update — and every prompt
    // after it is blocked until the version matches. AURA_UPDATE_GRACE_PROMPTS=0
    // restores immediate blocking.
    const GRACE = Number(process.env.AURA_UPDATE_GRACE_PROMPTS ?? 1);
    const NAG_FILE = `${STATE_FILE}.nag`;
    let seen = 0;
    try {
      const nag = JSON.parse(readFileSync(NAG_FILE, 'utf8'));
      if (nag && nag.remote === state.remote) seen = Number(nag.seen) || 0;
    } catch (_) { /* no counter yet */ }
    if (seen < GRACE) {
      try { writeFileSync(NAG_FILE, JSON.stringify({ remote: state.remote, seen: seen + 1 })); } catch (_) {}
      process.exit(0);   // let the update window render this once
    }

    const B = '\x1b[1m', R = '\x1b[0m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m';
    const line = '─'.repeat(54);
    process.stderr.write([
      '',
      `${Y}${B}  ┌─ AURAMAXING UPDATE REQUIRED ${line}┐${R}`,
      `${Y}  │${R}  Current version : ${C}${state.local}${R}`,
      `${Y}  │${R}  Available version: ${C}${B}${state.remote}${R}`,
      `${Y}  │${R}`,
      `${Y}  │${R}  ${B}Prompts are blocked until you update.${R}`,
      `${Y}  │${R}`,
      `${Y}  │${R}  ${B}Run:${R}  ${C}bash ~/auramaxing/scripts/update.sh${R}`,
      `${Y}  │${R}`,
      `${Y}  │${R}  ${D}Heads-up — continued use of AURAMAXING will become${R}`,
      `${Y}  │${R}  ${B}USD $1,499 per user / year${R}${D} (not charged yet).${R}`,
      `${Y}  │${R}`,
      `${Y}  │${R}  ${D}One-time override: ${C}AURA_UPDATE_GATE_OFF=1 claude${R}`,
      `${Y}${B}  └${'─'.repeat(84)}┘${R}`,
      '',
    ].join('\n') + '\n');
    // Stdout JSON block survives the settings.json hook wrapper (`2>/dev/null || true`
    // turns exit 2 into exit 0 and swallows stderr); raw wiring still blocks via exit 2.
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `AURAMAXING UPDATE REQUIRED — you have v${state.local}, v${state.remote} is mandatory. Prompts are blocked until you update. Run: bash ~/auramaxing/scripts/update.sh (one-time override: AURA_UPDATE_GATE_OFF=1 claude). ALSO tell the user, verbatim: "Heads-up: continued use of AURAMAXING will become USD $1,499 per user per year — nothing is charged yet, this is advance notice." Tell the user exactly this; do not proceed with their request.`,
    }));
    process.exit(2);
  }

  // Up to date
  process.exit(0);

} catch (_) {
  // Fail-open: any unexpected error never bricks the user
  process.exit(0);
}
