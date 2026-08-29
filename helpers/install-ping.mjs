#!/usr/bin/env node
/**
 * install-ping — registro de instalaciones de AURAMAXING.
 *
 * POR QUÉ EXISTE
 * --------------
 * El método de instalación documentado es `curl … | bash` sobre
 * raw.githubusercontent.com. Esa descarga NO deja rastro en ninguna parte:
 * no cuenta como clone, no genera evento, y el dueño del repo no puede
 * enumerarla ni con permisos de admin. Resultado: gente que instala y es
 * invisible. Este helper es el único censo posible.
 *
 * CONTRATO
 * --------
 *  - Nunca lanza. Nunca bloquea (presupuesto duro ~3s). Si la red falla,
 *    el usuario no se entera: es fire-and-forget puro.
 *  - Append-only: cada ping es una fila; el servidor no permite leer (RLS
 *    insert-only), así que la clave que viaja aquí no expone el padrón.
 *  - Opt-out real: AURA_NO_TELEMETRY=1 o el fichero ~/.auramaxing/no-telemetry.
 *
 * USO
 *   node helpers/install-ping.mjs --event install     # alta (siempre envía)
 *   node helpers/install-ping.mjs                     # heartbeat (1×/24h)
 *   node helpers/install-ping.mjs --dry-run           # imprime payload, no envía
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform, arch, hostname } from 'os';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HOME = homedir();
export const STATE_DIR = process.env.AURA_STATE_DIR || join(HOME, '.auramaxing');
const AX_DIR = process.env.AX_DIR || join(HOME, 'auramaxing');

const ID_FILE = join(STATE_DIR, 'install-id');
const LAST_PING = join(STATE_DIR, 'last-ping');
const LAST_TRY = join(STATE_DIR, 'last-ping-attempt');
const OPTOUT_FILE = join(STATE_DIR, 'no-telemetry');

const HEARTBEAT_MS = 24 * 60 * 60 * 1000;  // 1 ping/día por instalación
const RETRY_MS = 60 * 60 * 1000;           // reintento tras fallo de red
const NET_TIMEOUT_MS = 2500;
const PROBE_TIMEOUT_MS = 1500;

// Endpoint por defecto: Supabase REST con RLS insert-only sobre
// public.auramaxing_installs. La clave es publishable a propósito — sin
// política de SELECT no puede leer nada.
const DEFAULT_URL =
  'https://afftkllnqfkashsdzdvg.supabase.co/rest/v1/auramaxing_installs';
const DEFAULT_KEY = 'sb_publishable_qIL9hG3PhL2Vedjk4TXlng_18EPos5f';

export const registryUrl = () => process.env.AURA_REGISTRY_URL || DEFAULT_URL;
export const registryKey = () => process.env.AURA_REGISTRY_KEY || DEFAULT_KEY;

/** Opt-out por env o por fichero. Cualquiera de los dos basta. */
export function optedOut() {
  const v = String(process.env.AURA_NO_TELEMETRY || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return existsSync(OPTOUT_FILE);
}

/**
 * Identificador estable de la instalación. Se genera una vez y persiste;
 * es lo que permite contar instalaciones ÚNICAS en vez de eventos sueltos.
 */
export function installId() {
  try {
    if (existsSync(ID_FILE)) {
      const cur = readFileSync(ID_FILE, 'utf8').trim();
      if (/^[0-9a-f-]{36}$/i.test(cur)) return cur;
    }
  } catch { /* fichero ilegible: se regenera abajo */ }
  const id = randomUUID();
  try {
    mkdirSync(dirname(ID_FILE), { recursive: true });
    writeFileSync(ID_FILE, id + '\n');
  } catch { /* disco de solo lectura: el ping sigue siendo válido, sin persistir */ }
  return id;
}

/** Throttle del heartbeat. `install` y --force lo saltan siempre. */
export function shouldSend(event, now = Date.now()) {
  if (event !== 'heartbeat') return true;
  try {
    const last = Number(readFileSync(LAST_PING, 'utf8').trim());
    if (Number.isFinite(last) && now - last < HEARTBEAT_MS) return false;
  } catch { /* sin marca previa: toca enviar */ }
  // Si el último intento falló hace nada, no repetir el trabajo caro (spawn de
  // `gh` + fetch) en CADA sesión: con el endpoint caído eso era un coste fijo
  // por arranque para siempre.
  try {
    const tried = Number(readFileSync(LAST_TRY, 'utf8').trim());
    if (Number.isFinite(tried) && now - tried < RETRY_MS) return false;
  } catch { /* sin intento previo */ }
  return true;
}

function markSent(now = Date.now()) {
  try {
    mkdirSync(dirname(LAST_PING), { recursive: true });
    writeFileSync(LAST_PING, String(now) + '\n');
  } catch { /* no persistir solo significa un ping de más mañana */ }
}

function markAttempt(now = Date.now()) {
  try {
    mkdirSync(dirname(LAST_TRY), { recursive: true });
    writeFileSync(LAST_TRY, String(now) + '\n');
  } catch { /* sin marca, solo se reintenta antes */ }
}

/** Ejecuta un comando corto y devuelve stdout, o null si falla/tarda. */
function probe(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || null;
  } catch { return null; }
}

function localVersion() {
  try {
    return readFileSync(join(AX_DIR, 'VERSION'), 'utf8').trim().slice(0, 32) || null;
  } catch { return null; }
}

/**
 * Identidad. Es lo que convierte "35 clones anónimos" en una lista de personas.
 * Best-effort: si `gh` no está o no hay sesión, el ping viaja igual con null.
 */
function identity() {
  const gh = probe('gh', ['api', 'user', '--jq', '.login']);
  const email = probe('git', ['config', '--global', 'user.email']);
  return {
    gh_login: gh && /^[A-Za-z0-9-]{1,64}$/.test(gh) ? gh : null,
    git_email: email && email.includes('@') ? email.slice(0, 254) : null,
  };
}

export function buildPayload(event = 'heartbeat') {
  const { gh_login, git_email } = identity();
  return {
    install_id: installId(),
    event,
    version: localVersion(),
    gh_login,
    git_email,
    os: platform(),
    arch: arch(),
    node_version: process.version,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    // Pseudónimo del equipo: agrupa varias instalaciones de la misma máquina
    // sin exponer el hostname real.
    host_hash: createHash('sha256').update(hostname() + HOME).digest('hex').slice(0, 32),
  };
}

export async function send(payload, { url = registryUrl(), key = registryKey() } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), NET_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;   // red caída, DNS, timeout: silencio absoluto
  } finally {
    clearTimeout(t);
  }
}

export async function ping({ event = 'heartbeat', force = false, dryRun = false } = {}) {
  if (optedOut()) return { sent: false, reason: 'opted-out' };
  if (!force && !shouldSend(event)) return { sent: false, reason: 'throttled' };
  const payload = buildPayload(event);
  if (dryRun) return { sent: false, reason: 'dry-run', payload };
  markAttempt();
  const ok = await send(payload);
  if (ok) markSent();
  return { sent: ok, reason: ok ? 'ok' : 'network', payload };
}

// ── CLI ───────────────────────────────────────────────────────
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const event = get('--event') || 'heartbeat';
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  ping({ event, force, dryRun })
    .then((r) => {
      if (dryRun) console.log(JSON.stringify(r.payload, null, 2));
      else if (process.env.AURA_PING_VERBOSE) console.log(`install-ping: ${r.reason}`);
      process.exit(0);
    })
    .catch(() => process.exit(0));   // jamás propagar un fallo al instalador
}
