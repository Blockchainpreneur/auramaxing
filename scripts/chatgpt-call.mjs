#!/usr/bin/env node
/**
 * chatgpt-call — sends the live project context to ChatGPT in the user's own
 * Chrome (CDP :9222, existing window, NEW TAB, never closed) and then starts a
 * voice call on that same conversation, so ChatGPT already has full context.
 *
 * Fired automatically by helpers/gpt-council.mjs when 2+ Claude Code terminals
 * are mid-task. Runs detached in the background — never blocks the hook.
 *
 * Usage:
 *   node chatgpt-call.mjs --request <req.json>     # hook path (builds brief itself)
 *   node chatgpt-call.mjs --brief <file.md>        # send a prepared brief
 *   node chatgpt-call.mjs --text "..."             # send raw text
 *   node chatgpt-call.mjs --no-voice               # send context, skip the call
 *   node chatgpt-call.mjs --dry                    # print the brief, touch nothing
 */
import { fileURLToPath } from 'url';
import { spawn, spawnSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const SELF = fileURLToPath(import.meta.url);

// Node 20 needs --experimental-websocket for the global WebSocket used by cdp-lite.
if (typeof WebSocket === 'undefined') {
  const r = spawnSync(process.execPath, ['--experimental-websocket', SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}

const HOME = homedir();
const AURA = join(HOME, '.auramaxing');
const DIR = process.env.AURA_COUNCIL_DIR || join(AURA, 'council');
const LOG = join(DIR, 'council.log');
const STATE = join(DIR, 'state.json');
const ANSWERS = join(DIR, 'answers');
const SHOTS = join(DIR, 'shots');
for (const d of [DIR, ANSWERS, SHOTS]) mkdirSync(d, { recursive: true });

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const has = (n) => argv.includes(n);

const CDP_PORT = Number(process.env.AURA_CDP_PORT || 9222);
// MODE: call = read the answer aloud + open the mic (default, what a "call" means)
//       speak = read aloud only, mic stays closed (no ambient audio captured)
//       text  = deliver the answer in the thread only
const MODE = (process.env.AURA_COUNCIL_MODE || 'call').toLowerCase();
const VOICE = !has('--no-voice') && process.env.AURA_COUNCIL_VOICE !== '0' && MODE === 'call';
const READ_ALOUD = !has('--no-read') && process.env.AURA_COUNCIL_READ_ALOUD !== '0' && MODE !== 'text';
const FOCUS_CHROME = has('--focus') || process.env.AURA_COUNCIL_FOCUS === '1';

/** macOS banner so the user knows a live call just opened (the mic is hot). */
function notify(r) {
  const msg = r.status === 'call-started'
    ? `Llamada abierta con contexto de ${r.project} · micrófono ACTIVO`
    : r.speaking ? `ChatGPT está leyendo los pasos de ${r.project}` : `Contexto de ${r.project} enviado a ChatGPT`;
  try {
    execSync(`osascript -e ${JSON.stringify(`display notification ${JSON.stringify(msg)} with title "AURAMAXING Council" sound name "Glass"`)}`, { timeout: 4000 });
  } catch {}
  if (FOCUS_CHROME) {
    try { execSync(`osascript -e 'tell application "Google Chrome" to activate'`, { timeout: 4000 }); } catch {}
  }
}
const ANSWER_WAIT_MS = Number(process.env.AURA_COUNCIL_ANSWER_MS || 150000);

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  try { appendFileSync(LOG, s + '\n'); } catch {}
  if (process.stdout.isTTY || has('--verbose') || has('--dry')) console.log(s);
}

function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const s = { ...readState(), ...patch };
  try { writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch {}
  return s;
}
function releaseLock() {
  try { execSync(`rm -rf "${join(DIR, 'lock')}"`, { timeout: 2000 }); } catch {}
}

// ── 1. Build the payload ──────────────────────────────────────────────────────
let request = null;
let brief = null;
const reqPath = arg('--request');
if (reqPath && existsSync(reqPath)) {
  request = JSON.parse(readFileSync(reqPath, 'utf8'));
} else if (arg('--brief')) {
  brief = readFileSync(arg('--brief'), 'utf8');
} else if (arg('--text')) {
  brief = arg('--text');
}
if (!brief) {
  if (!request) {
    request = { cwd: process.cwd(), prompt: '(sin prompt)', sessionId: null, peers: [] };
  }
  const { buildBrief } = await import(join(HOME, 'auramaxing', 'helpers', 'council-brief.mjs'));
  brief = buildBrief(request);
}
const project = arg('--project') || request?.project || basename(request?.cwd || process.cwd());

if (has('--dry')) {
  console.log(brief);
  console.log(`\n--- ${brief.length} chars · project=${project} · mode=${MODE} (read=${READ_ALOUD} mic=${VOICE}) ---`);
  process.exit(0);
}

// Hard watchdog: this runs detached, so it must never linger as a zombie.
const WATCHDOG_MS = Number(process.env.AURA_COUNCIL_WATCHDOG_MS || 300000);
setTimeout(() => {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] WATCHDOG: aborting after ${WATCHDOG_MS}ms\n`); } catch {}
  try { execSync(`rm -rf ${JSON.stringify(join(DIR, 'lock'))}`); } catch {}
  process.exit(3);
}, WATCHDOG_MS).unref();

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
try { writeFileSync(join(DIR, 'briefs-last.md'), brief); } catch {}

// ── 2. Make sure the CDP browser is up (never launches a second window) ───────
function cdpAlive() {
  try {
    execSync(`curl -sf http://127.0.0.1:${CDP_PORT}/json/version >/dev/null 2>&1`, { timeout: 3000 });
    return true;
  } catch { return false; }
}
if (!cdpAlive()) {
  log('CDP down → starting browser-server.mjs');
  try {
    execSync(`node "${join(HOME, 'auramaxing', 'scripts', 'browser-server.mjs')}"`, { timeout: 60000, stdio: 'ignore' });
  } catch (e) { log(`browser-server failed: ${e.message}`); }
  if (!cdpAlive()) {
    log('ABORT: no CDP browser available');
    writeState({ lastStatus: 'no-browser', lastTs: Date.now() });
    releaseLock();
    process.exit(2);
  }
}

const { CDP } = await import(join(HOME, 'auramaxing', 'helpers', 'cdp-lite.mjs'));

// ── page-side helpers (stringified into the tab) ──────────────────────────────
const IS_COMPOSER_READY = () => !!document.querySelector('#prompt-textarea');
// NOTE (verified live 2026-08-25): ChatGPT keeps #prompt-textarea mounted DURING a
// voice call, so presence of the composer must NOT be used to infer "no call".
// The only reliable signal is the end-call / mute control.
const IS_VOICE_ACTIVE = () => {
  const labels = [...document.querySelectorAll('button,[role="button"]')]
    .map((b) => b.getAttribute('aria-label') || '').join('|');
  return /finalizar (la )?voz|end voice|apagar micr[oó]fono|mute microphone|silenciar micr/i.test(labels);
};
const MARK_READ_ALOUD = () => {
  const prev = document.querySelector('[data-aura-read]');
  if (prev) prev.removeAttribute('data-aura-read');
  const re = /voz alta|read aloud|leer en voz|reproducir/i;
  // Scope to the LAST assistant turn: an unscoped search happily marks the
  // read-aloud button of an older message and speaks the wrong answer.
  const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const scope = turns[turns.length - 1]?.closest('article') || document;
  const all = [...scope.querySelectorAll('button,[role="button"],[role="menuitem"]'),
               ...document.querySelectorAll('[role="menuitem"]')];
  const cand = all.find((b) => re.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''} ${b.innerText || ''}`));
  if (!cand) return { found: false };
  cand.setAttribute('data-aura-read', '1');
  return { found: true, label: (cand.getAttribute('aria-label') || cand.innerText || '').trim().slice(0, 40) };
};
const MARK_MORE_ACTIONS = () => {
  const prev = document.querySelector('[data-aura-more]');
  if (prev) prev.removeAttribute('data-aura-more');
  const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const last = turns[turns.length - 1];
  const scope = last?.closest('article') || document;
  const cand = [...scope.querySelectorAll('button,[role="button"]')]
    .find((b) => /m[aá]s acciones|more actions/i.test(b.getAttribute('aria-label') || ''));
  if (!cand) return { found: false };
  cand.setAttribute('data-aura-more', '1');
  return { found: true };
};
const MARK_VOICE_BUTTON = () => {
  const prev = document.querySelector('[data-aura-voice]');
  if (prev) prev.removeAttribute('data-aura-voice');
  const btns = [...document.querySelectorAll('button,[role="button"]')];
  const label = (b) => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''} ${b.title || ''}`;
  const dictation = /dictad|dictat|micr[oó]fono|microphone/i;
  const voice = /iniciar voz|modo de voz|voice mode|start voice|usar voz|voice chat|llamada/i;
  const cand = btns.find((b) => voice.test(label(b)) && !dictation.test(label(b)));
  if (!cand) {
    return { found: false, labels: btns.map(label).map((s) => s.trim()).filter(Boolean).slice(0, 40) };
  }
  cand.setAttribute('data-aura-voice', '1');
  return { found: true, label: label(cand).trim() };
};
const LAST_ANSWER = () => {
  const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const last = nodes[nodes.length - 1];
  return last ? (last.innerText || '').trim() : '';
};
const IS_STREAMING = () => {
  const btns = [...document.querySelectorAll('button,[role="button"]')];
  return btns.some((b) => /detener|stop streaming|stop generating|parar/i.test(b.getAttribute('aria-label') || '')) ||
    !!document.querySelector('[data-testid="stop-button"]');
};

// ── 3. Drive the tab ─────────────────────────────────────────────────────────
let cdp;
const result = { project, ts: Date.now(), voice: VOICE, status: 'unknown' };
try {
  cdp = await CDP.connect(CDP_PORT, 20000);
  await cdp.grantPermissions('https://chatgpt.com', ['audioCapture']).catch(() => {});

  const st = readState();
  let session = null;
  let reused = false;

  // Reuse this project's own conversation tab when it is still open.
  const wanted = st.projects?.[project]?.conversationUrl;
  if (wanted) {
    const t = await cdp.findPage(new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (t) {
      session = await cdp.attach(t.targetId);
      // Never talk over a live call: if the user is mid-conversation there, leave it alone.
      if (await session.call(IS_VOICE_ACTIVE).catch(() => false)) {
        log('SKIP: llamada en curso en la pestaña del proyecto — no se interrumpe');
        result.status = 'call-already-active';
        throw { handled: true };
      }
      reused = true;
      log(`reusing conversation tab for ${project}: ${wanted}`);
    }
  }
  if (!session) {
    session = await cdp.newTab('https://chatgpt.com/');
    log(`opened new ChatGPT tab for ${project}`);
  }
  // A background tab gets its renderer throttled, which strands Runtime.evaluate
  // (observed: 30s timeout on the very first click). Foreground it before driving.
  await session.bringToFront();

  const ready = await session.waitFor(IS_COMPOSER_READY, { timeout: 60000 });
  if (!ready) {
    const voiceBusy = await session.call(IS_VOICE_ACTIVE);
    if (voiceBusy) {
      log('SKIP: a voice call is already live in that tab');
      result.status = 'call-already-active';
      throw { handled: true };
    }
    const head = await session.call(() => document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '));
    log(`ABORT: composer never appeared. page says: ${head}`);
    result.status = /log in|inicia sesión|sign up/i.test(head) ? 'login-required' : 'no-composer';
    throw { handled: true };
  }

  // Type the brief with TRUSTED input (Input.insertText → ProseMirror commits it).
  await session.click('#prompt-textarea');
  await session.focus('#prompt-textarea');
  await session.insertText(brief);
  let typed = await session.call(() => (document.querySelector('#prompt-textarea')?.innerText || '').length);
  if (typed < brief.length * 0.5) {
    log(`insertText landed ${typed}/${brief.length} chars → paste fallback`);
    await session.call((t) => {
      const el = document.querySelector('#prompt-textarea');
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    }, brief);
    typed = await session.call(() => (document.querySelector('#prompt-textarea')?.innerText || '').length);
  }
  if (typed < 200) {
    log(`ABORT: composer only holds ${typed} chars`);
    result.status = 'compose-failed';
    throw { handled: true };
  }
  log(`context staged in composer: ${typed} chars`);

  const sent = await session.click('[data-testid="send-button"], button[aria-label*="Enviar" i], button[aria-label*="Send" i]');
  if (!sent) await session.pressEnter();
  await new Promise((r) => setTimeout(r, 1500));
  const cleared = await session.waitFor(() => (document.querySelector('#prompt-textarea')?.innerText || '').trim().length < 20, { timeout: 15000 });
  if (!cleared) { await session.pressEnter(); await new Promise((r) => setTimeout(r, 1500)); }
  log('context sent');

  // Wait for the answer to finish streaming, then archive it.
  // Two independent signals — the stop control (localized label, can miss) AND
  // text growth (language-proof). Without the growth check a missed label
  // truncates the answer to whatever had rendered in the first second.
  await session.waitFor(IS_STREAMING, { timeout: 20000, interval: 500 });
  const deadline = Date.now() + ANSWER_WAIT_MS;
  let lastLen = -1, stable = 0;
  while (Date.now() < deadline) {
    const [streaming, len] = await Promise.all([
      session.call(IS_STREAMING).catch(() => false),
      session.call(LAST_ANSWER).then((t) => (t || '').length).catch(() => 0),
    ]);
    stable = len === lastLen ? stable + 1 : 0;
    lastLen = len;
    if (!streaming && stable >= 2 && len > 0) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Only NOW is the URL canonical: right after send it is still a transient
  // `/c/WEB:<uuid>` placeholder that no later run could ever re-open.
  let convUrl = await session.url();
  for (let i = 0; i < 5 && !/\/c\/[0-9a-f-]{16,}$/i.test(convUrl); i++) {
    await new Promise((r) => setTimeout(r, 1200));
    convUrl = await session.url();
  }
  if (/\/c\/[0-9a-f-]{16,}$/i.test(convUrl)) {
    const projects = { ...(readState().projects || {}) };
    projects[project] = { conversationUrl: convUrl, ts: Date.now() };
    writeState({ projects });
  } else {
    log(`conversation URL never became canonical (${convUrl}) — next run starts a fresh thread`);
  }

  const answer = await session.call(LAST_ANSWER).catch(() => '');
  if (answer) {
    const ap = join(ANSWERS, `${stamp}-${project}.md`);
    writeFileSync(ap, `# ChatGPT · ${project} · ${new Date().toISOString()}\n${convUrl}\n\n${answer}\n`);
    writeFileSync(join(DIR, 'last-answer.md'), `${convUrl}\n\n${answer}\n`);
    log(`answer captured (${answer.length} chars) → ${ap}`);
    result.answerChars = answer.length;
    result.answerPath = ap;
  } else {
    log('no answer text captured (kept going)');
  }

  // ── 4. Make it an actual call: speak the answer, then open the mic ─────────
  await session.bringToFront();
  result.status = 'context-sent';

  if (READ_ALOUD && answer) {
    let mark = await session.call(MARK_READ_ALOUD);
    if (!mark?.found) {
      // Read-aloud usually lives behind the message's "…" (Más acciones) menu.
      const more = await session.call(MARK_MORE_ACTIONS);
      if (more?.found) {
        await session.click('[data-aura-more="1"]');
        await new Promise((r) => setTimeout(r, 900));
        mark = await session.call(MARK_READ_ALOUD);
      }
    }
    if (mark?.found) {
      const ok = await session.click('[data-aura-read="1"]');
      log(`read-aloud clicked (${mark.label}) → ${ok}`);
      result.readAloud = ok;
      const speaking = await session.waitFor(() => [...document.querySelectorAll('audio,video')].some((a) => !a.paused) ||
        [...document.querySelectorAll('button,[role="button"]')].some((b) => /detener|stop reading|pausar/i.test(b.getAttribute('aria-label') || '')),
      { timeout: 8000, interval: 600 });
      result.speaking = !!speaking;
      log(`speaking: ${!!speaking}`);
    } else {
      log('read-aloud control not found');
      await session.pressKey('Escape', 'Escape', 27).catch(() => {});
    }
  }

  if (VOICE) {
    let live = false;
    let label = null;
    for (let attempt = 1; attempt <= 3 && !live; attempt++) {
      const mark = await session.call(MARK_VOICE_BUTTON);
      if (!mark?.found) {
        live = await session.call(IS_VOICE_ACTIVE).catch(() => false);
        if (live) break;
        log(`voice button not found (try ${attempt}). buttons: ${JSON.stringify(mark?.labels || []).slice(0, 400)}`);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      label = mark.label;
      const rect = await session.rectOf('[data-aura-voice="1"]');
      if (!rect) { await new Promise((r) => setTimeout(r, 800)); continue; }
      const hit = await session.hitTest(rect.x, rect.y);
      if (hit && hit.label && !/voz|voice/i.test(hit.label)) {
        log(`click point covered by "${hit.label}" — retrying`);
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      await session.clickAt(rect.x, rect.y);
      live = !!(await session.waitFor(IS_VOICE_ACTIVE, { timeout: 6000, interval: 400 }));
      log(`voice click attempt ${attempt} (${label}) → ${live ? 'CALL LIVE' : 'no change'}`);
    }
    result.status = live ? 'call-started' : (result.speaking ? 'answer-spoken-no-mic' : 'context-sent-no-voice');
    result.voiceLive = live;
  }

  await session.screenshot(join(SHOTS, `${stamp}-${project}.png`)).catch(() => {});
  notify(result);
  result.conversationUrl = convUrl;
  log(`DONE ${project}: ${result.status} (${reused ? 'same thread' : 'new thread'})`);
} catch (e) {
  if (!e?.handled) {
    const msg = String(e?.message || e);
    result.status = /Session with given id not found|Target closed|socket closed/i.test(msg) ? 'tab-closed' : 'error';
    result.error = msg;
    log(`${result.status.toUpperCase()}: ${msg}`);
  }
} finally {
  writeState({ lastRun: result, lastStatus: result.status, lastTs: Date.now() });
  try { writeFileSync(join(DIR, 'last-run.json'), JSON.stringify(result, null, 2)); } catch {}
  releaseLock();
  for (const [d, keep] of [[ANSWERS, 60], [SHOTS, 30]]) {
    try {
      const files = readdirSync(d).sort();
      for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(d, f));
    } catch {}
  }
  try { cdp?.close(); } catch {}
  process.exit(result.status === 'error' ? 1 : 0);
}
