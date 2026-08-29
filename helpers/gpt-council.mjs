#!/usr/bin/env node
/**
 * gpt-council — AURAMAXING "second brain" trigger.
 *
 * Rule (user directive 2026-08-25): whenever 2+ Claude Code terminal sessions are
 * mid-task (a prompt submitted, Stop not fired yet), push the live project context
 * to ChatGPT in the user's Chrome and start a voice call on that thread asking for
 * SPECIFIC, non-generic next steps to scale + perfect the work.
 *
 * Modes:
 *   (no args)   UserPromptSubmit — register this session as BUSY, maybe trigger
 *   --stop      Stop hook — mark this session IDLE
 *   --status    print the live session registry + council state
 *   --force     trigger regardless of how many sessions are busy
 *   --dry       build + print the brief, do not touch the browser
 *
 * Never blocks: always exits 0 on the hook paths, work happens detached.
 */
import { spawn, execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const AURA = join(HOME, '.auramaxing');
const DIR = process.env.AURA_COUNCIL_DIR || join(AURA, 'council');
const SESS = join(DIR, 'sessions');
const STATE = join(DIR, 'state.json');
const LOCK = join(DIR, 'lock');
const LOG = join(DIR, 'council.log');
const CALL = join(HOME, 'auramaxing', 'scripts', 'chatgpt-call.mjs');

const MIN_SESSIONS = Number(process.env.AURA_COUNCIL_MIN_SESSIONS || 2);
// One dispatch per PROMPT, not per time window (user directive 2026-08-25): the
// council opens once when you send a prompt, and if you close the tab it stays
// closed until your NEXT prompt. Time throttling is opt-in, off by default.
const COOLDOWN_MS = Number(process.env.AURA_COUNCIL_COOLDOWN_MIN || 0) * 60_000;
const SAME_PROMPT_WINDOW_MS = Number(process.env.AURA_COUNCIL_SAME_PROMPT_SEC || 90) * 1000;
const BUSY_TTL_MS = Number(process.env.AURA_COUNCIL_BUSY_TTL_MIN || 45) * 60_000;
const LOCK_TTL_MS = 6 * 60_000;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const OFF = process.env.AURA_COUNCIL_OFF === '1' || existsSync(join(DIR, 'OFF'));
// OPT-IN, deliberately. This hook drives a real browser and can open the user's
// MICROPHONE. Shipping that on-by-default on someone else's machine is not
// acceptable, so it stays inert until the operator turns it on explicitly:
//   touch ~/.auramaxing/council/ENABLED     (or AURA_COUNCIL_ON=1)
const ENABLED = process.env.AURA_COUNCIL_ON === '1' || existsSync(join(DIR, 'ENABLED'));

mkdirSync(SESS, { recursive: true });

function log(line) {
  try { execSync(`printf '%s\\n' ${JSON.stringify(`[${new Date().toISOString()}] ${line}`)} >> ${JSON.stringify(LOG)}`, { timeout: 1500 }); } catch {}
}
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { try { writeFileSync(p, JSON.stringify(o, null, 2)); } catch {} };

/**
 * The Claude Code process that owns this hook (hook → sh → claude).
 * Returns { pid, verified }: `verified` is false when no `claude` ancestor could be
 * identified (deeper wrapper chains, a renamed binary, `ps` unavailable). That flag
 * is what keeps liveness honest — see `alive()`. Without it the hook stored a pid its
 * OWN liveness check then rejected, and the council silently never fired.
 */
function claudePid() {
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i++) {
    let out = '';
    try { out = execSync(`${PS_BIN} -o ppid=,comm= -p ${pid}`, { encoding: 'utf8', timeout: 2500 }).trim(); } catch { break; }
    const m = out.match(/^(\d+)\s+(.*)$/);
    if (!m) break;
    if (/claude/i.test(m[2])) return { pid, verified: true };
    pid = Number(m[1]);
  }
  return { pid: process.ppid, verified: false };
}
/**
 * Liveness must confirm the pid is still a CLAUDE process: macOS recycles pids,
 * and a recycled pid would keep a dead terminal "busy" forever.
 *
 * FAIL-SAFE DIRECTION MATTERS. `process.kill(pid, 0)` already proved the pid
 * exists; the `ps` call only refines *which* process it is. If `ps` itself fails
 * or times out (a loaded machine — reproduced under `npm test`), treating that as
 * "dead" silently evicts a terminal that is very much alive and the council stops
 * firing. An existing pid is therefore assumed alive unless `ps` SUCCEEDS and
 * says it is not claude.
 */
const PS_BIN = process.env.AURA_COUNCIL_PS_BIN || 'ps';
const alive = (pid, verified = true) => {
  try { process.kill(pid, 0); } catch { return false; }
  // Only a pid we positively identified as claude may be rejected for not being
  // claude — otherwise the check contradicts what was recorded.
  if (!verified) return true;
  try { return /claude/i.test(execSync(`${PS_BIN} -o comm= -p ${pid}`, { encoding: 'utf8', timeout: 2500 })); }
  catch { return true; }
};

async function stdinPayload() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const timer = setTimeout(() => { try { process.stdin.destroy(); } catch {} }, 1200);
  try { for await (const c of process.stdin) chunks.push(c); } catch {}
  clearTimeout(timer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function liveSessions() {
  const out = [];
  let files = [];
  try { files = readdirSync(SESS).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    const p = join(SESS, f);
    const s = readJson(p);
    if (!s) { try { unlinkSync(p); } catch {} continue; }
    const stale = Date.now() - (s.updatedTs || 0) > BUSY_TTL_MS;
    const dead = s.pid ? !alive(s.pid, s.pidVerified !== false) : false;
    if (dead || (stale && s.state === 'busy')) {
      if (dead) { try { unlinkSync(p); } catch {} continue; }
      s.state = 'stale';
    }
    out.push(s);
  }
  return out;
}

function takeLock() {
  try {
    if (existsSync(LOCK)) {
      const age = Date.now() - statSync(LOCK).mtimeMs;
      if (age < LOCK_TTL_MS) return false;
      try { execSync(`rm -rf ${JSON.stringify(LOCK)}`, { timeout: 1500 }); } catch {}
    }
    mkdirSync(LOCK); // atomic: throws if another session won the race
    return true;
  } catch { return false; }
}

// ── --status ────────────────────────────────────────────────────────────────
if (has('--status')) {
  const sessions = liveSessions();
  const st = readJson(STATE, {});
  // Estado real de 3 valores. Antes se imprimía 'NOT ENABLED' y acto seguido
  // 'council: ON', que se contradecía: OFF sólo miraba el kill-switch.
  const estado = OFF ? 'OFF (kill-switch AURA_COUNCIL_OFF)'
    : ENABLED ? 'ON'
    : 'PAUSADO — `touch ~/.auramaxing/council/ENABLED` (o AURA_COUNCIL_ON=1) para reactivarlo';
  console.log(`council: ${estado}  ·  min sessions: ${MIN_SESSIONS}  ·  1 disparo por prompt${COOLDOWN_MS ? ` · cooldown ${COOLDOWN_MS / 60000}min` : ''}`);
  console.log(`busy now: ${sessions.filter((s) => s.state === 'busy').length} / registered ${sessions.length}`);
  for (const s of sessions) {
    console.log(`  ${s.state.padEnd(5)} pid ${String(s.pid).padEnd(7)} ${String(s.project).padEnd(18)} ${new Date(s.updatedTs).toISOString().slice(11, 19)}  "${String(s.prompt || '').slice(0, 60)}"`);
  }
  console.log(`last run: ${st.lastStatus || 'never'} ${st.lastTs ? new Date(st.lastTs).toISOString() : ''}`);
  if (st.lastRun?.conversationUrl) console.log(`thread: ${st.lastRun.conversationUrl}`);
  process.exit(0);
}

// Not enabled on this machine → completely inert (no state, no browser, no mic).
if (!ENABLED) process.exit(0);

const payload = await stdinPayload();
const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
const cwd = payload.cwd || process.cwd();
const prompt = payload.prompt || payload.user_prompt || '';
const project = basename(cwd) || 'proyecto';
const sessFile = join(SESS, `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);

// ── --stop (Stop hook): this terminal finished its task ─────────────────────
if (has('--stop')) {
  const prev = readJson(sessFile, {});
  const own = claudePid();
  writeJson(sessFile, { ...prev, sessionId, pid: prev.pid || own.pid, pidVerified: prev.pidVerified ?? own.verified, cwd, project, state: 'idle', updatedTs: Date.now() });
  process.exit(0);
}

// ── UserPromptSubmit: register BUSY, then decide ────────────────────────────
const { pid, verified: pidVerified } = claudePid();
const prev = readJson(sessFile, {});
writeJson(sessFile, {
  sessionId, pid, pidVerified, cwd, project, state: 'busy',
  prompt: prompt.slice(0, 400), promptTs: Date.now(), updatedTs: Date.now(),
  turns: (prev.turns || 0) + 1,
});

if (OFF && !has('--force')) process.exit(0);

const sessions = liveSessions();
const busy = sessions.filter((s) => s.state === 'busy');
const peers = busy.filter((s) => s.sessionId !== sessionId);

if (busy.length < MIN_SESSIONS && !has('--force')) process.exit(0);

const st = readJson(STATE, {});

// Same prompt, already served → do NOT open a second tab, and do NOT reopen one
// the user deliberately closed. Only the next prompt earns a new dispatch.
const turnKey = `${sessionId}:${createHash('sha1').update(prompt).digest('hex').slice(0, 12)}`;
if (st.lastTurnKey === turnKey && Date.now() - (st.lastTurnTs || 0) < SAME_PROMPT_WINDOW_MS && !has('--force')) {
  process.exit(0);
}
if (COOLDOWN_MS && Date.now() - (st.lastTs || 0) < COOLDOWN_MS && !has('--force')) process.exit(0);
if (!takeLock() && !has('--force')) process.exit(0);

const req = {
  sessionId, cwd, project, prompt,
  peers: peers.map((p) => ({ project: p.project, state: p.state, prompt: p.prompt, cwd: p.cwd })),
  busyCount: busy.length,
  ts: Date.now(),
};
// hygiene: drop request payloads older than a day so the dir cannot grow forever
try {
  for (const f of readdirSync(DIR)) {
    if (!f.startsWith('request-')) continue;
    const fp = join(DIR, f);
    if (Date.now() - statSync(fp).mtimeMs > 86_400_000) unlinkSync(fp);
  }
} catch {}
const reqPath = join(DIR, `request-${Date.now()}.json`);
writeJson(reqPath, req);
writeJson(STATE, { ...st, lastTs: Date.now(), lastTurnKey: turnKey, lastTurnTs: Date.now(), lastStatus: 'dispatched', lastProject: project, lastBusy: busy.length });

if (has('--dry')) {
  const { buildBrief } = await import(join(HOME, 'auramaxing', 'helpers', 'council-brief.mjs'));
  console.log(buildBrief(req));
  try { execSync(`rm -rf ${JSON.stringify(LOCK)}`); } catch {}
  process.exit(0);
}

if (process.env.AURA_COUNCIL_NO_SPAWN !== '1') {
  const child = spawn(process.execPath, [CALL, '--request', reqPath, '--project', project], {
    detached: true, stdio: 'ignore', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  child.unref();
}

log(`dispatch: ${busy.length} busy sessions (${busy.map((s) => s.project).join(', ')}) → ChatGPT context+call for ${project}`);
console.log(`[AURAMAXING COUNCIL] ${busy.length} terminales activas → contexto de "${project}" enviado a ChatGPT + llamada iniciándose en background (log: ~/.auramaxing/council/council.log).`);
process.exit(0);
