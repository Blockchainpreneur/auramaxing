#!/usr/bin/env node
/**
 * users — el padrón de instalaciones de AURAMAXING (solo para el dueño).
 *
 * Lee public.auramaxing_installs con la service-role key, que NUNCA viaja en
 * el instalador ni vive en el repo: se guarda en ~/.auramaxing/registry.env.
 * Los clientes solo pueden INSERT (RLS), así que nadie más puede listar esto.
 *
 *   node scripts/users.mjs            # tabla de instalaciones únicas
 *   node scripts/users.mjs --json     # salida cruda
 *   node scripts/users.mjs --events   # log de eventos sin agregar
 *   node scripts/users.mjs --days 30  # ventana (por defecto: todo)
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATE_DIR = process.env.AURA_STATE_DIR || join(homedir(), '.auramaxing');
const ENV_FILE = join(STATE_DIR, 'registry.env');
const PROJECT_REF = process.env.AURA_REGISTRY_REF || 'afftkllnqfkashsdzdvg';
const BASE = process.env.AURA_REGISTRY_REST
  || `https://${PROJECT_REF}.supabase.co/rest/v1/auramaxing_installs`;
const PAGE = 1000;   // tope duro de PostgREST por respuesta

/** Lee KEY=value de ~/.auramaxing/registry.env (sin dependencias). */
function fileEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const KEY = process.env.AURA_REGISTRY_SERVICE_KEY || fileEnv().AURA_REGISTRY_SERVICE_KEY;

if (!KEY) {
  console.error(`No hay service-role key.

  1. https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api-keys
  2. Copia la clave "service_role" (secret)
  3. printf 'AURA_REGISTRY_SERVICE_KEY=<clave>\\n' > ${ENV_FILE} && chmod 600 ${ENV_FILE}

La clave da lectura completa: no la pegues en el repo ni en un commit.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const asEvents = args.includes('--events');
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : null;

/**
 * Descarga TODAS las filas paginando por Range. Un `limit` fijo trunca sin
 * avisar: el padrón parecería completo y estaría mintiendo. Se pagina hasta
 * que una página vuelve incompleta.
 */
async function fetchAll() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const params = new URLSearchParams({
      select: 'install_id,event,version,gh_login,git_email,os,arch,node_version,tz,host_hash,created_at',
      order: 'created_at.asc',
    });
    if (Number.isFinite(days) && days > 0) {
      params.set('created_at', `gte.${new Date(Date.now() - days * 864e5).toISOString()}`);
    }
    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok && res.status !== 206) {
      console.error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
    const page = await res.json();
    if (!Array.isArray(page)) {
      console.error(`Respuesta inesperada: ${JSON.stringify(page).slice(0, 200)}`);
      process.exit(1);
    }
    out.push(...page);
    if (page.length < PAGE) return out;   // última página
  }
}

const rows = await fetchAll();

if (asEvents) {
  console.log(asJson ? JSON.stringify(rows, null, 2)
    : rows.map(r => `${r.created_at.slice(0, 19)}  ${r.event.padEnd(9)} ${(r.gh_login || '—').padEnd(22)} v${r.version || '?'} ${r.os}`).join('\n'));
  process.exit(0);
}

// Agregación por instalación única. Un install_id = una máquina/instalación;
// gh_login puede llegar null en los primeros pings y rellenarse después, así
// que nos quedamos con el último valor NO nulo.
const byInstall = new Map();
for (const r of rows) {
  const cur = byInstall.get(r.install_id) || {
    install_id: r.install_id, pings: 0, first_seen: r.created_at, last_seen: r.created_at,
    gh_login: null, git_email: null, version: null, os: null, tz: null, host_hash: null,
  };
  cur.pings++;
  cur.last_seen = r.created_at;
  for (const f of ['gh_login', 'git_email', 'version', 'os', 'tz', 'host_hash']) {
    if (r[f]) cur[f] = r[f];
  }
  byInstall.set(r.install_id, cur);
}

const users = [...byInstall.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen));

if (asJson) {
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}

const identified = users.filter(u => u.gh_login || u.git_email);
const machines = new Set(users.map(u => u.host_hash).filter(Boolean));
const active7 = users.filter(u => Date.now() - Date.parse(u.last_seen) < 7 * 864e5);

console.log(`\nAURAMAXING — padrón de instalaciones\n${'─'.repeat(96)}`);
console.log(
  'GITHUB'.padEnd(22) + 'EMAIL'.padEnd(30) + 'VER'.padEnd(9) +
  'OS'.padEnd(9) + 'PINGS'.padEnd(7) + 'ALTA'.padEnd(12) + 'ÚLTIMO'
);
console.log('─'.repeat(96));
for (const u of users) {
  console.log(
    (u.gh_login || '—').slice(0, 21).padEnd(22) +
    (u.git_email || '—').slice(0, 29).padEnd(30) +
    (u.version || '?').padEnd(9) +
    (u.os || '?').padEnd(9) +
    String(u.pings).padEnd(7) +
    u.first_seen.slice(0, 10).padEnd(12) +
    u.last_seen.slice(0, 10)
  );
}
console.log('─'.repeat(96));
console.log(`${users.length} instalaciones · ${identified.length} identificadas · ` +
  `${machines.size} máquinas · ${active7.length} activas 7d · ${rows.length} eventos\n`);
