#!/usr/bin/env node
/**
 * AURAMAXING NLM Health Check (SessionStart hook)
 *
 * Runs at session start. Quick checks:
 *   1. Try a fresh cookie sync from Chrome (≤2s)
 *   2. Probe `notebooklm list` (≤4s)
 *   3. If healthy: silent. If unhealthy: emit a one-line directive into the
 *      session context so Claude knows to flag it to the user.
 *
 * Always exits 0. Total budget: 8s, but typically <3s.
 *
 * Output (only when degraded — printed to stdout = goes into Claude's context):
 *   [AURAMAXING NLM] <status>: <one-line action>
 *
 * Status file (always written):
 *   ~/.auramaxing/nlm-health.json  { ok, status, reason, ts, retryCount, deadCount }
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const HEALTH_FILE = join(AUR, 'nlm-health.json');
const RETRY = join(AUR, 'nlm-write-buffer.retry.jsonl');
const DEAD = join(AUR, 'nlm-write-buffer.dead-letter.jsonl');

mkdirSync(AUR, { recursive: true });

function countLines(path) {
  if (!existsSync(path)) return 0;
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).length; }
  catch { return 0; }
}

function writeHealth(record) {
  try { writeFileSync(HEALTH_FILE, JSON.stringify(record, null, 2)); } catch {}
}

function tryNlmList() {
  // Use the Python module fallback explicitly — avoids PATH issues for the
  // `notebooklm` shim which often isn't installed.
  try {
    const out = execSync('python3 -m notebooklm list 2>&1 | head -3', {
      encoding: 'utf8', timeout: 4500, shell: '/bin/bash',
    });
    if (/Authentication expired|Redirected|notebooklm login|Missing required cookies/i.test(out)) {
      return { ok: false, reason: 'auth-expired' };
    }
    if (/Notebooks/i.test(out) || /^[│┃┡┏]/m.test(out)) {
      return { ok: true };
    }
    // Inconclusive — assume bad to be safe
    return { ok: false, reason: 'unknown', detail: out.slice(0, 100) };
  } catch (e) {
    const msg = (e.stdout || e.stderr || e.message || '').toString();
    if (/Authentication expired|Redirected|notebooklm login|Missing required cookies/i.test(msg)) {
      return { ok: false, reason: 'auth-expired' };
    }
    if (/No module named/i.test(msg)) return { ok: false, reason: 'no-cli' };
    if (/timed out|ETIMEDOUT/i.test(msg)) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'unknown', detail: msg.slice(0, 100) };
  }
}

function attemptCookieSync() {
  // Run the cookie-sync helper in <3s. If it succeeds → state will improve.
  try {
    execSync(`node "${join(HOME, 'auramaxing', 'helpers', 'nlm-cookie-sync.mjs')}"`, {
      timeout: 4000, stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch { return false; }
}

const ts = new Date().toISOString();
const retryCount = countLines(RETRY);
const deadCount = countLines(DEAD);

// First probe — maybe everything's already fine
let probe = tryNlmList();

if (!probe.ok && probe.reason === 'auth-expired') {
  // Try recovery: sync cookies from Chrome and re-probe
  if (attemptCookieSync()) {
    probe = tryNlmList();
  }
}

const record = { ok: probe.ok, status: probe.ok ? 'healthy' : probe.reason, ts, retryCount, deadCount };
writeHealth(record);

// Emit advisory ONLY when degraded — silent on healthy path
if (!probe.ok) {
  const queueNote = (retryCount + deadCount) > 0
    ? ` Buffered: ${retryCount} retry + ${deadCount} dead-letter.`
    : '';
  let line;
  switch (probe.reason) {
    case 'auth-expired':
      line = `[AURAMAXING NLM] auth expired — open Chrome, sign into notebooklm.google.com, then \`node ~/auramaxing/helpers/nlm-cookie-sync.mjs\` (or run \`python3 -m notebooklm login\` for full re-auth).${queueNote}`;
      break;
    case 'no-cli':
      line = `[AURAMAXING NLM] CLI not installed — \`pip3 install notebooklm\`. NLM delegation offline.`;
      break;
    case 'timeout':
      line = `[AURAMAXING NLM] CLI timed out on probe — Google API may be slow. Will recover automatically.${queueNote}`;
      break;
    default:
      line = `[AURAMAXING NLM] degraded (${probe.reason}): ${probe.detail || 'unknown'}.${queueNote}`;
  }
  process.stdout.write(line + '\n');
}

process.exit(0);
