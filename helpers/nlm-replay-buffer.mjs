#!/usr/bin/env node
/**
 * AURAMAXING NLM Buffer Replay
 *
 * Drains both retry and dead-letter queues by re-routing entries to
 * `notebooklm note create` (the source-add CLI path is broken upstream:
 * Google's response format changed and notebooklm-py raises
 * "Failed to get SOURCE_ID from registration response"). Notes are a
 * reliable substitute — same notebook, same searchability, smaller blast
 * radius if a single payload fails.
 *
 * Behavior:
 *   - Pre-flight: cookie sync + auth probe. Aborts if auth bad.
 *   - Reads RETRY then DEAD-LETTER (configurable).
 *   - For each entry: synthesize a note from {title, payload, ts, project}
 *     and call `notebooklm note create -t <title> <content>`.
 *   - Successful entries are removed (file is rewritten).
 *   - Permanent failures stay in dead-letter (already at attempts>=3 there).
 *   - Retry failures get attempts++ and stay in retry; >=3 attempts → moved
 *     to dead-letter.
 *
 * Usage:
 *   node nlm-replay-buffer.mjs              # drain retry + dead-letter
 *   node nlm-replay-buffer.mjs --retry-only
 *   node nlm-replay-buffer.mjs --dead-only
 *   node nlm-replay-buffer.mjs --limit 50
 *   node nlm-replay-buffer.mjs --dry-run
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const RETRY = join(AUR, 'nlm-write-buffer.retry.jsonl');
const DEAD = join(AUR, 'nlm-write-buffer.dead-letter.jsonl');
const NLM_BIN = findNlm();

const args = process.argv.slice(2);
const RETRY_ONLY = args.includes('--retry-only');
const DEAD_ONLY = args.includes('--dead-only');
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) : Infinity;
})();
const SKIP_SYNC = args.includes('--no-cookie-sync');

function log(msg) { process.stderr.write(`[nlm-replay] ${msg}\n`); }

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writeJsonl(path, entries) {
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}

function refreshCookies() {
  if (SKIP_SYNC) return true;
  try {
    const sync = join(import.meta.url.replace('file://', '').replace(/[^/]+$/, ''), 'nlm-cookie-sync.mjs');
    execSync(`node "${sync}"`, { timeout: 25000, stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (e) {
    log(`cookie-sync failed: ${e.message?.slice(0, 100)}`);
    return false;
  }
}

function authProbe() {
  try {
    const out = execSync(`${NLM_BIN} list 2>&1 | head -3`, {
      encoding: 'utf8', timeout: 8000, shell: '/bin/bash',
      env: { ...process.env, PATH: pythonEnv().PATH },
    });
    if (/Authentication expired|Redirected|notebooklm login|Missing required cookies/i.test(out)) {
      return { ok: false, reason: out.trim().split('\n')[0].slice(0, 120) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e.stdout || e.stderr || e.message || '').toString().slice(0, 120) };
  }
}

/**
 * Build a Markdown note body from a buffered entry.
 * Notes carry the same content as sources but stored as note objects
 * (always queryable, no source-id parsing required).
 */
function entryToNote(entry) {
  const ts = entry.ts || new Date().toISOString();
  const type = entry.type || 'unknown';
  const project = entry.project || 'unknown';
  const title = entry.title
    ? entry.title.slice(0, 90)
    : `${type} ${ts.slice(0, 10)} — ${project}`;
  const header = `> ts: ${ts} · type: ${type} · project: ${project}`;
  const body = (entry.payload || '').toString();
  // NotebookLM notes have a content cap (~50k); truncate with footer
  const MAX = 48000;
  const content = body.length > MAX
    ? body.slice(0, MAX) + `\n\n... [truncated ${body.length - MAX} chars]`
    : body;
  return { title, content: `${header}\n\n${content}` };
}

function postNote(noteTitle, noteContent) {
  // Pass content via stdin? No — note create takes content as positional arg.
  // To avoid ARG_MAX issues with huge content, write to a temp file and read it.
  // But CLI takes content positionally; for safety stay under 100k via truncation in entryToNote.
  // Encode as base64 path? simpler: pass content directly as last arg.
  const escapedTitle = noteTitle.replace(/"/g, '\\"');
  // Write content to a temp file and inject via shell substitution (avoids
  // shell-escape pitfalls for newlines, quotes, backticks).
  const tmpFile = join('/tmp', `aura-replay-note-${process.pid}-${Math.random().toString(36).slice(2,8)}.txt`);
  writeFileSync(tmpFile, noteContent);
  try {
    const cmd = `${NLM_BIN} note create -t "${escapedTitle}" "$(cat "${tmpFile}")"`;
    execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      shell: '/bin/bash',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pythonEnv().PATH },
    });
    return { ok: true };
  } catch (e) {
    const err = (e.stderr?.toString() || e.message || '').slice(0, 200);
    return { ok: false, error: err };
  } finally {
    try { execSync(`rm -f "${tmpFile}"`, { stdio: 'ignore', timeout: 2000 }); } catch {}
  }
}

async function drainQueue(label, path, isDeadLetter) {
  const entries = readJsonl(path);
  if (entries.length === 0) {
    log(`${label}: empty`);
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  log(`${label}: ${entries.length} entries to drain`);

  if (DRY_RUN) {
    log(`(dry-run) would attempt ${Math.min(entries.length, LIMIT)} entries`);
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const remaining = [];
  let succeeded = 0, failed = 0;
  let processed = 0;

  for (const entry of entries) {
    if (processed >= LIMIT) { remaining.push(entry); continue; }
    processed++;
    const { title, content } = entryToNote(entry);
    const res = postNote(title, content);
    if (res.ok) {
      succeeded++;
    } else {
      failed++;
      // For retry queue: increment attempts; >=3 → dead letter
      // For dead letter: leave in dead letter (record latest error)
      const updated = { ...entry, attempts: (entry.attempts || 0) + 1, lastError: res.error };
      if (!isDeadLetter && updated.attempts >= 3) {
        try { appendFileSync(DEAD, JSON.stringify(updated) + '\n'); } catch {}
      } else {
        remaining.push(updated);
      }
    }
    // Brief jitter to avoid hammering the API
    if (processed % 5 === 0) execSync('sleep 0.4');
  }

  // Add any over-LIMIT entries verbatim back to remaining (already pushed)
  writeJsonl(path, remaining);
  log(`${label}: ${succeeded} ✓ / ${failed} ✗ / ${remaining.length} left`);
  return { processed, succeeded, failed };
}

async function main() {
  if (!NLM_BIN) { log('NotebookLM CLI not installed'); process.exit(1); }

  log('Refreshing cookies from Chrome...');
  refreshCookies();

  const probe = authProbe();
  if (!probe.ok) {
    log(`Auth not ready: ${probe.reason}`);
    log('Run: open Chrome, sign into notebooklm.google.com, then re-run this');
    process.exit(2);
  }
  log('Auth verified ✓');

  const totals = { processed: 0, succeeded: 0, failed: 0 };

  if (!DEAD_ONLY) {
    const r = await drainQueue('retry', RETRY, false);
    totals.processed += r.processed; totals.succeeded += r.succeeded; totals.failed += r.failed;
  }
  if (!RETRY_ONLY) {
    const d = await drainQueue('dead-letter', DEAD, true);
    totals.processed += d.processed; totals.succeeded += d.succeeded; totals.failed += d.failed;
  }

  log(`DONE: ${totals.succeeded}/${totals.processed} delivered, ${totals.failed} still failing`);
  console.log(JSON.stringify(totals));
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
