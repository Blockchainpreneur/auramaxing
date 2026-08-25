#!/usr/bin/env node
/**
 * turn-sentinel — AURAMAXING auto-resume for API-error turn deaths.
 *
 * Problem: when a turn dies with "API Error: Connection closed mid-response"
 * (or stalled stream / ECONNRESET / 529 …), Claude Code aborts the turn BY
 * DESIGN (no retry once visible output streamed), the Stop hook does NOT fire,
 * and the session sits idle until a human types "continue". That halts every
 * autonomous loop.
 *
 * Solution (3 layers, this file is layers 1+2):
 *   L0 prevention  — settings.json env: CLAUDE_CODE_RETRY_WATCHDOG=1 +
 *                    API_TIMEOUT_MS=900000 (official unattended-retry knobs).
 *   L1 event       — hooks.StopFailure (fires exactly on API-error turn death;
 *                    output ignored, so it can only trigger side effects) runs
 *                    `--stopfailure`: classify error, consult backoff ledger,
 *                    spawn a detached `--inject` child, exit fast.
 *   L2 backstop    — launchd job (com.auramaxing.turn-sentinel, every 60s)
 *                    runs `--sweep`: scans recent transcripts for API-error
 *                    tails the hook missed, resolves the session's tty via the
 *                    statusline-maintained tty-map, and injects. Also keeps a
 *                    caffeinate -ims assertion alive while claude TUIs run
 *                    (macOS idle-sleep is a confirmed stream-killer).
 *
 * Injection mechanism: Terminal.app `do script <text> in <tab>` types into the
 * busy foreground process of the tab whose tty matches — no focus steal, no
 * accessibility permission (verified empirically against a live process).
 *
 * Kill-switches: touch ~/.auramaxing/sentinel/KILL  |  AURA_SENTINEL_OFF=1
 * Dry-run: AURA_SENTINEL_DRYRUN=1 (logs instead of injecting)
 * Logs:   ~/.auramaxing/sentinel/sentinel.log
 * Ledger: ~/.auramaxing/sentinel/state.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync, appendFileSync, unlinkSync, rmdirSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const DIR = join(HOME, '.auramaxing', 'sentinel');
const STATE_FILE = join(DIR, 'state.json');
const LOG_FILE = join(DIR, 'sentinel.log');
const TTYMAP_DIR = join(DIR, 'tty-map');
const KILL_FILE = join(DIR, 'KILL');
const CAFF_PID = join(DIR, 'caffeinate.pid');
const PROJECTS = join(HOME, '.claude', 'projects');

const DRYRUN = process.env.AURA_SENTINEL_DRYRUN === '1';
const SKIP_ALIVE = process.env.AURA_SENTINEL_SKIP_ALIVE === '1';
const MAX_ATTEMPTS = parseInt(process.env.AURA_SENTINEL_MAX_ATTEMPTS || '6', 10);
const ATTEMPT_WINDOW_MS = 2 * 3600e3;           // rolling window for MAX_ATTEMPTS
const BACKOFF_S = [20, 60, 180, 420, 900, 900]; // delay before attempt N (0-based)
const SWEEP_GRACE_S = 90;                        // error must be at least this old for sweep
const SWEEP_MAX_AGE_H = 6;                       // ignore errors older than this
const RESUME_TEXT = 'continue — [aura-sentinel auto-resume] the previous response died on an API connection error. Resume EXACTLY where you left off: re-run any tool call whose result was lost and keep the loop going autonomously; do not ask for confirmation.';

// Error classes that a "continue" can rescue. Auth/billing/config errors cannot.
const NON_RESUMABLE = /authentication|credential|billing|credit balance|oauth|invalid_request|model_not_found|401|403/i;
const NON_RESUMABLE_TYPES = new Set(['authentication_failed', 'billing_error', 'oauth_org_not_allowed', 'invalid_request', 'model_not_found']);
const SLOW_TYPES = new Set(['rate_limit', 'overloaded']); // resumable but start deeper in the backoff ladder

mkdirSync(TTYMAP_DIR, { recursive: true });

// ── infra ────────────────────────────────────────────────────────
function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
    if (statSync(LOG_FILE).size > 512 * 1024) {
      const keep = readFileSync(LOG_FILE, 'utf8').split('\n').slice(-400).join('\n');
      writeFileSync(LOG_FILE, keep);
    }
  } catch {}
}
// state.json mutex (finding #5): a lost update erases a session's ledger and
// lets a duplicate injector spawn. mkdir is atomic on the local FS.
const STATE_LOCK = join(DIR, 'state.lock');
function withStateLock(fn) {
  let held = false;
  for (let i = 0; i < 50; i++) {
    try { mkdirSync(STATE_LOCK); held = true; break; }
    catch {
      // steal a stale lock (holder crashed) after 5s
      try { if (Date.now() - statSync(STATE_LOCK).mtimeMs > 5000) { held = true; break; } } catch {}
      const end = Date.now() + 20; while (Date.now() < end) {} // ~20ms spin
    }
  }
  try { return fn(); } finally { if (held) { try { require_rmdir(STATE_LOCK); } catch {} } }
}
function require_rmdir(p) { try { rmdirSync(p); } catch {} }
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { sessions: {} }; }
}

// ── per-session in-flight lock (findings #3, #4) ─────────────────
// One injector per session at a time, keyed on real process liveness — NOT a
// time window. Prevents both the "dedup poisons handled and strands the 2nd
// error" bug and the "DEDUP_MS == max backoff lets a 2nd injector through" bug.
const INFLIGHT_DIR = join(DIR, 'inflight');
const INFLIGHT_TTL_MS = 30 * 60e3; // hard backstop if a holder dies without releasing
mkdirSync(INFLIGHT_DIR, { recursive: true });
function inflightPath(sessionId) { return join(INFLIGHT_DIR, `${sessionId}.lock`); }
/** Atomically claim the injector slot for a session. Returns true if claimed. */
function claimInflight(sessionId) {
  if (!UUID_RE.test(sessionId)) return false;
  const p = inflightPath(sessionId);
  try {
    const fd = openSync(p, 'wx'); // O_EXCL — fails if it exists
    writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    closeSync(fd);
    return true;
  } catch {
    // exists — reclaim if the holder is dead or the lock is older than the TTL
    try {
      const cur = JSON.parse(readFileSync(p, 'utf8'));
      let dead = false;
      if (cur.pid) { try { process.kill(cur.pid, 0); } catch { dead = true; } }
      if (dead || !cur.ts || Date.now() - cur.ts > INFLIGHT_TTL_MS) {
        writeFileSync(p, JSON.stringify({ pid: process.pid, ts: Date.now() }));
        return true;
      }
    } catch {}
    return false;
  }
}
function adoptInflight(sessionId) { // injector child re-stamps the lock with its own pid
  try { writeFileSync(inflightPath(sessionId), JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch {}
}
function releaseInflight(sessionId) {
  try {
    const cur = JSON.parse(readFileSync(inflightPath(sessionId), 'utf8'));
    if (cur.pid && cur.pid !== process.pid) return; // not ours (a newer holder) — leave it
  } catch {}
  try { unlinkSync(inflightPath(sessionId)); } catch {}
}
function saveState(s) {
  const now = Date.now();
  for (const [id, sess] of Object.entries(s.sessions)) {
    sess.attempts = (sess.attempts || []).filter(t => now - t < 24 * 3600e3);
    for (const [u, t] of Object.entries(sess.handled || {})) if (now - t > 24 * 3600e3) delete sess.handled[u];
    if (!sess.attempts.length && !Object.keys(sess.handled || {}).length) delete s.sessions[id];
  }
  try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {}
}
function killed() {
  return existsSync(KILL_FILE) || process.env.AURA_SENTINEL_OFF === '1';
}
function notify(msg) {
  log(`NOTIFY: ${msg}`);
  if (DRYRUN) return;
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "AURAMAXING Sentinel" sound name "Basso"`], { timeout: 5000 });
  } catch {}
}

// ── transcript tail parsing ──────────────────────────────────────
function readTail(file, bytes = 32768) {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, 'r');
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
/** Last user/assistant entry in the transcript tail (skips system/attachment/etc). */
function lastMessageEntry(file) {
  const lines = readTail(file).split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e.type === 'user' || e.type === 'assistant') return e;
    } catch {} // partial first line of the tail window
  }
  return null;
}
function errorTextOf(entry) {
  try {
    const c = entry.message.content;
    if (typeof c === 'string') return c;                       // content can be a bare string (#8)
    if (Array.isArray(c)) return c.map(x => x.text || '').join(' ');
    return '';
  } catch { return ''; }
}
/** If the transcript currently ends on an API-error assistant message, return it. */
function pendingApiError(file) {
  const e = lastMessageEntry(file);
  if (e && e.type === 'assistant' && e.isApiErrorMessage === true) return e;
  return null;
}

// ── tty resolution ───────────────────────────────────────────────
function ownTty() {
  // Hook/tool children are spawned without a controlling tty, so walk the parent
  // chain to the claude process that owns THIS session. Stop at the FIRST claude
  // ancestor: that is my own session. If it is headless (tty "??", e.g. a
  // `claude -p` running inside a Bash tool), return null — there is no tty to
  // resume, and climbing further would wrongly map me onto an OUTER TUI session
  // and inject into it. (finding #2)
  try {
    let pid = process.pid;
    for (let hop = 0; hop < 12 && pid > 1; hop++) {
      const out = execFileSync('ps', ['-o', 'ppid=,tty=,comm=', '-p', String(pid)], { timeout: 3000 }).toString().trim();
      if (!out) break;
      const m = out.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) break;
      const [, ppid, tty, comm] = m;
      if (/(^|\/)claude$/.test(comm.trim())) return tty.startsWith('ttys') ? `/dev/${tty}` : null;
      pid = parseInt(ppid, 10);
    }
  } catch {}
  return null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function writeTtyMap(sessionId, tty, cwd) {
  if (!UUID_RE.test(sessionId)) return; // never let a non-uuid id reach a file path
  try { writeFileSync(join(TTYMAP_DIR, `${sessionId}.json`), JSON.stringify({ tty, cwd: cwd || '', ts: Date.now() })); } catch {}
}
function ttyFor(sessionId) {
  if (!UUID_RE.test(sessionId)) return null;
  try {
    const m = JSON.parse(readFileSync(join(TTYMAP_DIR, `${sessionId}.json`), 'utf8'));
    if (m.tty && /^\/dev\/ttys\d+$/.test(m.tty)) return m.tty;
  } catch {}
  return null;
}
function claudeAliveOn(tty) {
  if (SKIP_ALIVE) return true;
  try {
    const out = execFileSync('ps', ['-axo', 'tty=,comm='], { timeout: 4000 }).toString();
    const short = tty.replace('/dev/', '');
    return out.split('\n').some(l => {
      const parts = l.trim().split(/\s+/);
      return parts[0] === short && /(^|\/)claude$/.test(parts.slice(1).join(' '));
    });
  } catch { return false; }
}
function claudeTuiPids() {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,tty=,comm='], { timeout: 4000 }).toString();
    return out.split('\n').map(l => {
      const p = l.trim().split(/\s+/);
      if (p.length < 3 || !p[1].startsWith('ttys')) return null;
      const comm = p.slice(2).join(' '); // comm path may contain spaces (#9)
      return /(^|\/)claude$/.test(comm) ? { pid: p[0], tty: `/dev/${p[1]}` } : null;
    }).filter(Boolean);
  } catch { return []; }
}
/**
 * Guard against tty REUSE (sweep path only): if the session that errored has
 * exited and a DIFFERENT claude later took over the same tty, injecting would
 * hit the wrong live session. The errored session, by definition, was already
 * running when the error was logged — so require the claude now on `tty` to
 * have started at/before the error time (a reused tty hosts a newer claude).
 * Returns false when it cannot positively confirm — fail closed.
 */
function claudeOnTtyStartedBefore(tty, errEpochMs) {
  try {
    const short = tty.replace('/dev/', '');
    const out = execFileSync('ps', ['-axo', 'tty=,lstart=,comm='], { timeout: 4000 }).toString();
    for (const line of out.split('\n')) {
      const t = line.trim();
      if (!t.startsWith(short + ' ') && !t.startsWith(short + '\t')) continue;
      if (!/(^|\/)claude$/.test(t)) continue;
      // lstart is the 5-field ctime after the tty column: "Sun Jul 20 03:12:44 2026"
      const m = t.match(/^\S+\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})/);
      if (!m) return false;
      const started = Date.parse(m[1]);
      if (!started) return false;
      return started <= errEpochMs + 5000; // 5s slack for logging skew
    }
  } catch {}
  return false;
}

// ── injection ────────────────────────────────────────────────────
function injectIntoTty(tty, text) {
  if (!/^\/dev\/ttys\d+$/.test(tty)) { log(`refusing bad tty ${tty}`); return false; }
  if (DRYRUN) { log(`DRYRUN inject → ${tty}: ${text.slice(0, 60)}…`); return true; }
  const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        do script "${esc}" in t
        return "ok"
      end if
    end repeat
  end repeat
  return "notfound"
end tell`;
  try {
    const res = execFileSync('osascript', ['-e', script], { timeout: 30000 }).toString().trim();
    log(`inject ${tty} → ${res}`);
    return res === 'ok';
  } catch (err) {
    const msg = String(err);
    log(`inject ${tty} FAILED: ${msg.slice(0, 200)}`);
    // ETIMEDOUT / -1743 = Automation TCC consent not granted for this calling
    // context (happens from the launchd backstop, never from the in-session
    // StopFailure hook). Degrade to a notification instead of hanging silently.
    if (/ETIMEDOUT|-1743|not authoriz|not allowed to send/i.test(msg)) {
      notify(`Auto-resume needs a one-time "Control Terminal" grant for the backstop. A session is stuck on ${tty} — type "continue", or approve the Automation prompt. (The in-session hook path is unaffected.)`);
    }
    return false;
  }
}

// ── attempt scheduling (shared by stopfailure + sweep) ───────────
function scheduleResume(sessionId, transcript, tty, errUuid, errType, errText) {
  // Terminal decisions (already handled / non-resumable / budget exhausted) are
  // taken under the state mutex and do NOT need the injector slot.
  const decision = withStateLock(() => {
    const state = loadState();
    const sess = state.sessions[sessionId] = state.sessions[sessionId] || { attempts: [], handled: {} };
    const now = Date.now();
    if (sess.handled[errUuid]) return { act: 'skip' };
    if (NON_RESUMABLE_TYPES.has(errType) || NON_RESUMABLE.test(errText)) {
      sess.handled[errUuid] = now;
      saveState(state);
      return { act: 'nonresumable' };
    }
    const recent = (sess.attempts || []).filter(t => now - t < ATTEMPT_WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      let notifyNow = false;
      if (!sess.exhaustedNotified || now - sess.exhaustedNotified > ATTEMPT_WINDOW_MS) { sess.exhaustedNotified = now; notifyNow = true; }
      saveState(state);
      return { act: 'exhausted', count: recent.length, notifyNow };
    }
    return { act: 'go', recent };
  });
  if (decision.act === 'skip') return;
  if (decision.act === 'nonresumable') { notify(`Session ${sessionId.slice(0, 8)} died on a non-resumable API error (${errType || 'auth/billing'}). Manual action needed.`); return; }
  if (decision.act === 'exhausted') { if (decision.notifyNow) notify(`Session ${sessionId.slice(0, 8)}: ${decision.count} auto-resumes in 2h — backing off. Check the terminal.`); return; }

  // Exactly one injector per session at a time — keyed on real process liveness,
  // not a time window (findings #3, #4). If another injector is in flight we skip
  // WITHOUT marking handled, so this error is re-evaluated once the slot frees.
  if (!claimInflight(sessionId)) { log(`skip schedule session=${sessionId.slice(0, 8)} — an injector is already in flight`); return; }

  const delay = withStateLock(() => {
    const state = loadState();
    const sess = state.sessions[sessionId] = state.sessions[sessionId] || { attempts: [], handled: {} };
    const now = Date.now();
    const recent = (sess.attempts || []).filter(t => now - t < ATTEMPT_WINDOW_MS);
    let idx = Math.min(recent.length, BACKOFF_S.length - 1);
    if (SLOW_TYPES.has(errType)) idx = Math.max(idx, 2); // rate-limit/overloaded: start at 180s
    sess.attempts = [...recent, now];
    sess.handled[errUuid] = now;
    saveState(state);
    return process.env.AURA_SENTINEL_TEST_DELAY_S != null ? parseInt(process.env.AURA_SENTINEL_TEST_DELAY_S, 10) : BACKOFF_S[idx];
  });
  log(`schedule resume session=${sessionId.slice(0, 8)} tty=${tty} delay=${delay}s type=${errType || '?'} err="${errText.slice(0, 90)}"`);
  const child = spawn(process.execPath, [process.argv[1], '--inject', '--tty', tty, '--session', sessionId, '--transcript', transcript, '--delay', String(delay), '--uuid', errUuid], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── mode: --stopfailure (hook) ───────────────────────────────────
async function stopFailure() {
  let input = {};
  try {
    const raw = await new Promise(res => {
      let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => res(d));
      setTimeout(() => res(d), 1500);
    });
    input = JSON.parse(raw || '{}');
  } catch {}
  const sessionId = input.session_id || 'unknown';
  const transcript = input.transcript_path || '';
  const errType = input.error_type || input.errorType || (input.error && input.error.type) || '';
  const errText = typeof input.error === 'string' ? input.error : (input.message || (input.error && input.error.message) || '');
  const tty = ownTty();
  if (tty) writeTtyMap(sessionId, tty, input.cwd);
  log(`StopFailure session=${sessionId.slice(0, 8)} tty=${tty || 'none'} type=${errType || '?'} msg="${String(errText).slice(0, 120)}"`);
  if (killed()) { log('KILL active — no resume'); return; }
  if (!tty) { log('no controlling tty (headless) — skip'); return; }
  if (!transcript || !existsSync(transcript)) { log('no transcript — skip'); return; }
  // The synthetic error entry may land in the transcript a moment after the hook
  // fires; the injector re-reads the tail anyway, so key the ledger on the last
  // known entry uuid (or a time bucket if none).
  const err = pendingApiError(transcript);
  const errUuid = (err && err.uuid) || `sf-${Math.floor(Date.now() / 60000)}`;
  scheduleResume(sessionId, transcript, tty, errUuid, errType, errorTextOf(err) || String(errText));
}

// Give back the attempt this injector reserved — used when it aborts because the
// USER already handled the death, so their manual continues don't burn the
// unattended budget (finding #6).
function refundAttempt(sessionId) {
  withStateLock(() => {
    const state = loadState();
    const sess = state.sessions[sessionId];
    if (sess && sess.attempts && sess.attempts.length) { sess.attempts.pop(); saveState(state); }
  });
}

// ── mode: --inject (detached child) ──────────────────────────────
async function inject(args) {
  const { tty, session, transcript, uuid } = args;
  const uuidMatches = (e) => e && (!uuid || e.uuid === uuid || uuid.startsWith('sf-'));
  adoptInflight(session); // re-stamp the slot with our pid so we own its release
  try {
    const delay = parseInt(args.delay || '0', 10);
    await sleep(delay * 1000);
    if (killed()) { log(`inject aborted (KILL) session=${session.slice(0, 8)}`); return; }
    // Abort if the session already moved on (user typed / another injector won).
    const err = pendingApiError(transcript);
    if (!err) { log(`inject aborted (session moved on) session=${session.slice(0, 8)}`); refundAttempt(session); return; }
    if (!uuidMatches(err)) { log(`inject aborted (different error entry) session=${session.slice(0, 8)}`); return; }
    if (!claudeAliveOn(tty)) { log(`inject aborted (no claude on ${tty}) session=${session.slice(0, 8)}`); return; }
    // If the user is typing on this tty right now, give them a moment — then
    // re-check that the session is still stuck (they may have resumed it manually
    // during the pause; injecting "continue" into a live turn would be wrong).
    try {
      const m = statSync(tty).mtimeMs;
      if (Date.now() - m < 10e3) {
        await sleep(30e3);
        if (killed()) { log(`inject aborted (KILL after typing-guard) session=${session.slice(0, 8)}`); return; }
        const still = pendingApiError(transcript);
        if (!still || !uuidMatches(still)) { log(`inject aborted (resumed during typing-guard) session=${session.slice(0, 8)}`); refundAttempt(session); return; }
      }
    } catch {}
    if (!injectIntoTty(tty, RESUME_TEXT)) return;
    // Verify the resume took: the SAME error entry must no longer be the tail.
    await sleep(120e3);
    const still = pendingApiError(transcript);
    if (still && still.uuid === err.uuid) {
      log(`resume did not take on ${tty} — one plain retry`);
      if (claudeAliveOn(tty)) injectIntoTty(tty, 'continue');
      await sleep(90e3);
      const again = pendingApiError(transcript);
      if (again && again.uuid === err.uuid) notify(`Session ${session.slice(0, 8)} did not auto-resume after API error. Check the terminal.`);
    } else if (still && still.uuid !== err.uuid) {
      // Session resumed but died again on a NEW error — hand off cleanly: release
      // the slot so the fresh death's hook/sweep can claim and handle it (#7).
      log(`resumed but hit a new API error session=${session.slice(0, 8)} — releasing for follow-up`);
    } else {
      log(`resume confirmed session=${session.slice(0, 8)}`);
    }
  } finally {
    releaseInflight(session);
  }
}

// ── mode: --sweep (launchd backstop) ─────────────────────────────
function manageCaffeinate(anyClaude) {
  try {
    let pid = null;
    try { pid = parseInt(readFileSync(CAFF_PID, 'utf8').trim(), 10) || null; } catch {}
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
    if (anyClaude && !alive && !DRYRUN) {
      const c = spawn('caffeinate', ['-ims'], { detached: true, stdio: 'ignore' });
      c.unref();
      writeFileSync(CAFF_PID, String(c.pid));
      log(`caffeinate started pid=${c.pid} (idle-sleep is a confirmed stream killer)`);
    } else if (!anyClaude && alive) {
      try { process.kill(pid); } catch {}
      try { unlinkSync(CAFF_PID); } catch {}
      log('caffeinate stopped (no claude sessions)');
    }
  } catch {}
}
function sweep() {
  if (killed()) return;
  const pids = claudeTuiPids();
  manageCaffeinate(pids.length > 0);
  if (!pids.length && !SKIP_ALIVE) return;
  const now = Date.now();
  let dirs = [];
  try { dirs = readdirSync(PROJECTS); } catch { return; }
  for (const d of dirs) {
    let files = [];
    const dp = join(PROJECTS, d);
    try { files = readdirSync(dp).filter(f => /^[0-9a-f-]{36}\.jsonl$/.test(f)); } catch { continue; }
    for (const f of files) {
      const fp = join(dp, f);
      let mtime;
      try { mtime = statSync(fp).mtimeMs; } catch { continue; }
      if (now - mtime > SWEEP_MAX_AGE_H * 3600e3) continue;
      const err = pendingApiError(fp);
      if (!err) continue;
      const age = now - Date.parse(err.timestamp || 0);
      if (age < SWEEP_GRACE_S * 1000 || age > SWEEP_MAX_AGE_H * 3600e3) continue;
      const sessionId = basename(f, '.jsonl');
      const state = loadState();
      if (state.sessions[sessionId]?.handled?.[err.uuid]) continue; // L1 already on it
      const tty = process.env.AURA_SENTINEL_TEST_TTY || ttyFor(sessionId);
      if (!tty) { log(`sweep: API-error tail in ${sessionId.slice(0, 8)} but no tty mapping — skip`); continue; }
      if (!claudeAliveOn(tty)) continue;
      // tty-reuse guard: only resume if the claude on this tty predates the error
      // (i.e. it's the SAME session that died, not a newer one that reused the tty).
      const errEpoch = Date.parse(err.timestamp || 0);
      if (!SKIP_ALIVE && errEpoch && !claudeOnTtyStartedBefore(tty, errEpoch)) {
        log(`sweep: ${sessionId.slice(0, 8)} tty ${tty} now hosts a newer claude (tty reuse) — skip to avoid wrong-session inject`);
        continue;
      }
      scheduleResume(sessionId, fp, tty, err.uuid, err.error || '', errorTextOf(err));
    }
  }
}

// ── entry ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv[0];
const args = {};
for (let i = 1; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];

try {
  if (mode === '--stopfailure') await stopFailure();
  else if (mode === '--inject') await inject(args);
  else if (mode === '--sweep') sweep();
  else { console.error('usage: turn-sentinel.mjs --stopfailure | --sweep | --inject --tty T --session S --transcript P --delay N --uuid U'); process.exit(1); }
} catch (e) {
  log(`ERROR ${mode}: ${String(e).slice(0, 300)}`);
}
process.exit(0);
