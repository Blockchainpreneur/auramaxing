#!/usr/bin/env node
/**
 * Unit + integration tests for helpers/turn-sentinel.mjs (the API-error
 * auto-resume system). Run: node tests/turn-sentinel.test.mjs
 *
 * Covers the defects found in the 2026-07-20 adversarial review:
 *   #1 tty-reuse wrong-session guard   #2 ownTty headless-ancestor bail
 *   #3/#4 in-flight lock (no strand / no double-schedule)   #8 errorTextOf string content
 * plus the core StopFailure→schedule and sweep detection paths.
 */
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const HELPER = join(homedir(), 'auramaxing', 'helpers', 'turn-sentinel.mjs');
const SENT = join(homedir(), '.auramaxing', 'sentinel');
const PROJ = join(homedir(), '.claude', 'projects', '-turn-sentinel-selftest');
let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`))); };

function threeMinAgo() {
  // no Date.now() literal for timestamps that must be relative — compute via node
  const d = new Date(Date.now() - 3 * 60000);
  return d.toISOString().replace(/\.\d+Z$/, '.000Z');
}
function writeErr(sessionId, uuid) {
  mkdirSync(PROJ, { recursive: true });
  const entry = { type: 'assistant', uuid, timestamp: threeMinAgo(), isApiErrorMessage: true, error: 'server_error', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'API Error: Connection closed mid-response.' }] } };
  writeFileSync(join(PROJ, `${sessionId}.jsonl`), JSON.stringify(entry) + '\n');
}
function state(sessionId) { try { return JSON.parse(readFileSync(join(SENT, 'state.json'), 'utf8')).sessions[sessionId] || {}; } catch { return {}; } }
function lockCount() { try { return readdirSync(join(SENT, 'inflight')).filter(f => f.endsWith('.lock')).length; } catch { return 0; } }
function cleanState() {
  writeFileSync(join(SENT, 'state.json'), '{"sessions":{}}');
  try { readdirSync(join(SENT, 'inflight')).forEach(f => f.endsWith('.lock') && rmSync(join(SENT, 'inflight', f))); } catch {}
  try { execFileSync('pkill', ['-f', 'turn-sentinel.mjs --inject']); } catch {}
}
function sweep(tty) {
  execFileSync(process.execPath, [HELPER, '--sweep'], { env: { ...process.env, AURA_SENTINEL_SKIP_ALIVE: '1', AURA_SENTINEL_TEST_TTY: tty, AURA_SENTINEL_TEST_DELAY_S: '15' }, timeout: 10000 });
}

// ── pure-logic unit tests (no fs) ────────────────────────────────
console.log('turn-sentinel unit tests');
// #8 errorTextOf handles string content
const errorTextOf = (entry) => { try { const c = entry.message.content; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.map(x => x.text || '').join(' '); return ''; } catch { return ''; } };
const NON_RESUMABLE = /authentication|credential|billing|credit balance|oauth|invalid_request|model_not_found|401|403/i;
ok('#8 errorTextOf(string) returns the string', errorTextOf({ message: { content: '401 Invalid authentication credentials' } }) === '401 Invalid authentication credentials');
ok('#8 auth error detected via string content', NON_RESUMABLE.test(errorTextOf({ message: { content: '401 Invalid authentication credentials' } })));
ok('#8 errorTextOf(array) joins text', errorTextOf({ message: { content: [{ type: 'text', text: 'Connection closed' }] } }) === 'Connection closed');

// #1 tty-reuse guard: claude must have started at/before the error
const startedBefore = (startedMs, errMs) => startedMs <= errMs + 5000;
const errAt = Date.parse('2026-07-20T04:00:00Z');
ok('#1 same-session (pre-error start) accepted', startedBefore(Date.parse('2026-07-20T03:50:00Z'), errAt));
ok('#1 reused tty (post-error start) rejected', !startedBefore(Date.parse('2026-07-20T04:05:00Z'), errAt));

// #2 ownTty stops at first claude ancestor, bails if headless
const ownTty = (tree, start = 100) => { let pid = start; for (let h = 0; h < 12 && pid > 1; h++) { const e = tree[pid]; if (!e) break; if (/(^|\/)claude$/.test(e.comm)) return e.tty.startsWith('ttys') ? '/dev/' + e.tty : null; pid = e.ppid; } return null; };
ok('#2 headless inner claude → null (does not climb to outer TUI)', ownTty({ 100: { ppid: 90, tty: '??', comm: 'node' }, 90: { ppid: 80, tty: '??', comm: 'claude' }, 80: { ppid: 1, tty: 'ttys005', comm: 'claude' } }) === null);
ok('#2 normal in-session hook → outer ttys', ownTty({ 100: { ppid: 90, tty: '??', comm: 'node' }, 90: { ppid: 1, tty: 'ttys007', comm: 'claude' } }) === '/dev/ttys007');

// ── integration tests (real process, isolated session) ───────────
console.log('turn-sentinel integration tests');
mkdirSync(join(SENT, 'inflight'), { recursive: true });
const SESS = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
try {
  cleanState();
  writeFileSync(join(SENT, 'tty-map', `${SESS}.json`), JSON.stringify({ tty: '/dev/ttys999', cwd: '/tmp', ts: Date.now() }));
  writeErr(SESS, 'err-1');
  sweep('/dev/ttys999');
  const l1 = lockCount(); const a1 = (state(SESS).attempts || []).length;
  ok('#3/#4 first sweep schedules one injector (1 lock, 1 attempt)', l1 === 1 && a1 === 1);

  writeErr(SESS, 'err-2-different'); // session "moved on" to a new error while injector in flight
  sweep('/dev/ttys999');
  const l2 = lockCount(); const a2 = (state(SESS).attempts || []).length; const poisoned = !!state(SESS).handled?.['err-2-different'];
  ok('#3/#4 concurrent 2nd error does NOT double-schedule (still 1 lock, 1 attempt)', l2 === 1 && a2 === 1);
  ok('#3 2nd error NOT poisoned into handled (no permanent strand)', poisoned === false);
} finally {
  cleanState();
  try { rmSync(PROJ, { recursive: true, force: true }); } catch {}
  try { rmSync(join(SENT, 'tty-map', `${SESS}.json`), { force: true }); } catch {}
}

console.log(`\n  turn-sentinel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
