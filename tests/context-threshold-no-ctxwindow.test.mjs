#!/usr/bin/env node
/**
 * Regression test — context-threshold-monitor.mjs 40% auto-handoff fallback.
 *
 * UserPromptSubmit never receives `context_window` in stdin (the monitor's own
 * comment documents this), so the ONLY way the handoff can ever fire is via the
 * last-ctx.json fallback that statusline.sh persists. This test locks that path:
 * given a payload with NO context_window and a persisted (stale) last-ctx.json
 * whose pct is above the 55% ceiling, `[CONTEXT-AUTO-REFRESH]` MUST fire.
 *
 * Guards the exact bug where dropping the fallback (or mis-reading last-ctx.json)
 * would silently kill auto-handoff in production, since stdin never carries the %.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MONITOR = join(HERE, '..', 'helpers', 'context-threshold-monitor.mjs');

// Isolated HOME so the monitor's ~/.auramaxing resolves into a throwaway dir.
const fakeHome = mkdtempSync(join(tmpdir(), 'aura-ctx-test-'));
const aur = join(fakeHome, '.auramaxing');
mkdirSync(aur, { recursive: true });

// Persisted "stale" statusline value — above the 55% ceiling, within the 600s TTL.
writeFileSync(join(aur, 'last-ctx.json'), JSON.stringify({ pct: 72, model: 'claude-opus-4-8' }));

// UserPromptSubmit-shaped payload: NO context_window, unique session id (fresh flag).
const payload = JSON.stringify({
  session_id: `regtest-${process.pid}`,
  cwd: fakeHome,
  prompt: 'keep building the feature',
});

let out = '';
try {
  out = execFileSync('node', [MONITOR], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
    timeout: 15000,
  });
} catch (e) {
  out = `${e.stdout || ''}${e.stderr || ''}`;
}

rmSync(fakeHome, { recursive: true, force: true });

if (!out.includes('[CONTEXT-AUTO-REFRESH]')) {
  console.error('FAIL: no-context_window payload + stale last-ctx.json above threshold did NOT fire [CONTEXT-AUTO-REFRESH]');
  console.error('--- monitor output ---\n' + out);
  process.exit(1);
}

console.log('PASS: [CONTEXT-AUTO-REFRESH] fires from last-ctx.json fallback when stdin has no context_window');
process.exit(0);
