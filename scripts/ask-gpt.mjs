#!/usr/bin/env node
/**
 * ask-gpt — manda TODO el contexto de las sesiones de Claude Code a ChatGPT
 * por CLI. Nunca abre el navegador, nunca toca Chrome, nunca usa CDP.
 *
 * Backends (se elige solo, en este orden, salvo --backend):
 *   openai  → HTTPS directo a la API con OPENAI_API_KEY. Cero navegador, cero login.
 *   codex   → `codex exec` (usa la sesión de codex ya autenticada).
 *   clip    → copia el digest al portapapeles para pegarlo a mano. Sin credenciales.
 *   print   → lo escribe en stdout / en --out FICHERO.
 *
 * Uso:
 *   node scripts/ask-gpt.mjs                      # elige backend y pregunta
 *   node scripts/ask-gpt.mjs --dry                # sólo enseña el digest
 *   node scripts/ask-gpt.mjs --backend clip       # al portapapeles
 *   node scripts/ask-gpt.mjs --since-min 720      # ventana de sesiones
 *   node scripts/ask-gpt.mjs --model gpt-5.1      # modelo concreto
 *   node scripts/ask-gpt.mjs --out respuesta.md   # guarda la respuesta
 */
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { execFileSync, execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildDigest } from '../helpers/session-digest.mjs';

const HOME = homedir();
const AURA = join(HOME, '.auramaxing');
const OUT_DIR = join(AURA, 'council', 'answers');
// Override para tests: si no, un test escribe la caché real del usuario.
const MODEL_CACHE = process.env.AURA_GPT_MODEL_CACHE || join(AURA, 'council', 'openai-model.txt');

const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', x: '\x1b[0m' };
const log = (s = '') => process.stderr.write(s + '\n');

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const num = (f, d) => { const v = Number(val(f)); return Number.isFinite(v) && v > 0 ? v : d; };

if (has('--help') || has('-h')) {
  log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

// ── credenciales (sin navegador) ──────────────────────────────────────────
function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  for (const p of [join(AURA, 'secrets', 'openai.key'), join(HOME, '.openai.key')]) {
    try { if (existsSync(p)) { const k = readFileSync(p, 'utf8').trim(); if (k) return k; } } catch {}
  }
  return null;
}

function codexReady() {
  try {
    const out = execSync('codex login status 2>&1', { encoding: 'utf8', timeout: 8000 });
    return !/not logged in/i.test(out);
  } catch { return false; }
}

// ── backend: OpenAI API directa ───────────────────────────────────────────
// Host desviable SÓLO hacia loopback, y sólo así se permite http en claro: es
// como los tests ejercitan el camino de envío de verdad sin una clave real.
const API_HOST = process.env.AURA_OPENAI_HOST || 'api.openai.com';
const API_PORT = Number(process.env.AURA_OPENAI_PORT) || 443;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(API_HOST);
const transport = LOOPBACK && process.env.AURA_OPENAI_INSECURE === '1' ? httpRequest : httpsRequest;

function apiPost(path, key, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = transport({
      hostname: API_HOST, port: API_PORT, path, method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(data); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j ?? data);
        reject(new Error(`HTTP ${res.statusCode}: ${j?.error?.message || String(data).slice(0, 300)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout tras ${Math.round(timeoutMs / 1000)}s`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * No se adivina el nombre del modelo: se pregunta a la cuenta qué tiene y se
 * elige el mejor disponible. Un default hardcodeado caduca y devuelve un 404
 * que parece un fallo del script.
 */
async function pickModel(key, override) {
  if (override) return override;
  if (process.env.AURA_GPT_MODEL) return process.env.AURA_GPT_MODEL;
  try {
    const cached = readFileSync(MODEL_CACHE, 'utf8').trim();
    if (cached) return cached;
  } catch {}
  const prefs = [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^o[34]$/, /^gpt-4\.1$/, /^gpt-4o$/, /^gpt-4/];
  const res = await apiPost('/v1/models', key, null, 20000);
  const ids = (res?.data || []).map((m) => m.id).filter((id) => !/audio|realtime|image|tts|whisper|embed|moderation/.test(id));
  for (const re of prefs) {
    const hit = ids.filter((id) => re.test(id)).sort()[0];
    if (hit) {
      try { mkdirSync(join(AURA, 'council'), { recursive: true }); writeFileSync(MODEL_CACHE, hit); } catch {}
      return hit;
    }
  }
  throw new Error(`la cuenta no expone ningún modelo de chat utilizable (${ids.length} modelos vistos)`);
}

async function sendOpenAI(digest, key, modelOverride) {
  const model = await pickModel(key, modelOverride);
  log(`${C.dim}backend openai · modelo ${model}${C.x}`);
  // /v1/responses es el endpoint actual; si la cuenta sólo tiene el antiguo,
  // se reintenta con chat/completions en vez de fallar.
  try {
    const r = await apiPost('/v1/responses', key, { model, input: digest });
    const text = r.output_text
      || (r.output || []).flatMap((o) => (o.content || []).map((c) => c.text)).filter(Boolean).join('\n');
    if (text) return { text, model };
    throw new Error('respuesta vacía de /v1/responses');
  } catch (e) {
    log(`${C.dim}/v1/responses falló (${e.message}); reintento con /v1/chat/completions${C.x}`);
    try {
      const r = await apiPost('/v1/chat/completions', key, {
        model, messages: [{ role: 'user', content: digest }],
      });
      const text = r?.choices?.[0]?.message?.content;
      if (!text) throw new Error('respuesta vacía de /v1/chat/completions');
      return { text, model };
    } catch (e2) {
      // Un modelo cacheado que la cuenta ya no sirve envenenaría todas las
      // ejecuciones siguientes: se tira la caché para que la próxima redescubra.
      try { unlinkSync(MODEL_CACHE); } catch {}
      throw e2;
    }
  }
}

// ── backend: codex CLI ────────────────────────────────────────────────────
function sendCodex(digest, modelOverride) {
  log(`${C.dim}backend codex · codex exec (sandbox read-only)${C.x}`);
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-'];
  if (modelOverride) args.splice(1, 0, '-m', modelOverride);
  const text = execFileSync('codex', args, {
    input: digest, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return { text: text.trim(), model: modelOverride || 'codex' };
}

// ── backend: portapapeles ─────────────────────────────────────────────────
function sendClip(digest) {
  execFileSync('pbcopy', { input: digest });
  log(`${C.g}✓${C.x} digest copiado al portapapeles (${digest.length} chars).`);
  log(`  Pégalo en chat.openai.com cuando quieras — no hace falta ninguna credencial.`);
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────
const t0 = Date.now();
const digestRes = buildDigest({
  sinceMin: num('--since-min', 240),
  prompts: num('--prompts', 6),
  maxChars: num('--max', 60000),
  ask: !has('--no-ask'),
});
const digest = digestRes.text;

log('');
log(`${C.b}AURAMAXING · contexto de sesiones → ChatGPT (CLI, sin navegador)${C.x}`);
log(`${C.dim}${digestRes.sessions.length} sesión(es) · ${digestRes.projects.length} proyecto(s) · ${digest.length} chars${C.x}`);
for (const s of digestRes.sessions) {
  log(`${C.dim}  · ${s.project.padEnd(18)} ${(s.branch || '-').padEnd(14)} ${s.title || ''}${C.x}`);
}
log('');

if (has('--dry')) {
  process.stdout.write(digest + '\n');
  process.exit(0);
}

if (!digestRes.sessions.length) {
  log(`${C.y}Sin sesiones activas en la ventana. Prueba --since-min 720.${C.x}`);
  process.exit(0);
}

const key = openaiKey();
let backend = val('--backend', null);
if (!backend) {
  if (key) backend = 'openai';
  else if (codexReady()) backend = 'codex';
  else backend = 'clip';
}

let answer = null;
try {
  if (backend === 'openai') {
    if (!key) throw new Error('no hay OPENAI_API_KEY (env o ~/.auramaxing/secrets/openai.key)');
    answer = await sendOpenAI(digest, key, val('--model', null));
  } else if (backend === 'codex') {
    if (!codexReady()) throw new Error('codex no está autenticado — `printenv OPENAI_API_KEY | codex login --with-api-key`');
    answer = sendCodex(digest, val('--model', null));
  } else if (backend === 'clip') {
    sendClip(digest);
  } else if (backend === 'print') {
    process.stdout.write(digest + '\n');
  } else {
    throw new Error(`backend desconocido: ${backend} (openai|codex|clip|print)`);
  }
} catch (e) {
  log(`${C.r}✗ backend ${backend} falló:${C.x} ${e.message}`);
  // Nunca se pierde el trabajo del digest: se deja siempre a mano.
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    const p = join(OUT_DIR, `digest-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    writeFileSync(p, digest);
    log(`  El digest quedó guardado en ${p}`);
    log(`  Envíalo con:  node ~/auramaxing/scripts/ask-gpt.mjs --backend clip`);
  } catch {}
  process.exit(1);
}

if (answer?.text) {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = val('--out', join(OUT_DIR, `${stamp}.md`));
  const header = `# Consejo ChatGPT — ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\n`
    + `modelo ${answer.model} · ${digestRes.sessions.length} sesiones · ${digestRes.projects.join(', ')}\n\n---\n\n`;
  writeFileSync(file, header + answer.text + '\n');
  process.stdout.write('\n' + answer.text + '\n');
  log('');
  log(`${C.g}✓${C.x} respuesta guardada en ${file} ${C.dim}(${Math.round((Date.now() - t0) / 1000)}s)${C.x}`);
}
