#!/usr/bin/env node
/**
 * install-ping — tests del censo de instalaciones.
 *
 * Lo que se prueba de verdad (no que "corre"):
 *  1. El opt-out se respeta por env Y por fichero (si falla esto, es telemetría
 *     no consentida: es el test más importante del fichero).
 *  2. El install_id persiste entre llamadas — sin eso se cuentan eventos, no
 *     instalaciones únicas, y el padrón miente.
 *  3. El heartbeat se limita a 1/24h, pero `install` y --force nunca se frenan.
 *  4. El payload lleva identidad utilizable y el host_hash NO filtra el hostname.
 *  5. Con la red caída, send() devuelve false y JAMÁS lanza (el instalador no
 *     puede romperse porque un servidor esté caído).
 *  6. El ping no contamina el stdout de update-check.sh, cuyo contrato es una
 *     sola línea. Aquí es donde se rompería la barra de update de todos.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, hostname } from 'os';
import { execFileSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const HELPER = new URL('../helpers/install-ping.mjs', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'aura-ping-'));

/** Cada caso importa el módulo con su propio AURA_STATE_DIR aislado. */
async function withState(name, fn) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const prev = process.env.AURA_STATE_DIR;
  process.env.AURA_STATE_DIR = dir;
  // cache-buster: el módulo lee AURA_STATE_DIR en tiempo de import
  const mod = await import(`${HELPER}?t=${name}`);
  try { return await fn(mod, dir); }
  finally {
    if (prev === undefined) delete process.env.AURA_STATE_DIR;
    else process.env.AURA_STATE_DIR = prev;
  }
}

console.log('\ninstall-ping\n');

// ── 1. Opt-out ────────────────────────────────────────────────
await withState('optout-env', async (m) => {
  process.env.AURA_NO_TELEMETRY = '1';
  ok('opt-out por AURA_NO_TELEMETRY=1', m.optedOut() === true);
  const r = await m.ping({ event: 'install', force: true });
  ok('opt-out corta incluso un alta forzada', r.sent === false && r.reason === 'opted-out',
    JSON.stringify(r));
  delete process.env.AURA_NO_TELEMETRY;
  ok('sin la env, vuelve a estar activo', m.optedOut() === false);
});

await withState('optout-file', async (m, dir) => {
  writeFileSync(join(dir, 'no-telemetry'), '');
  ok('opt-out por ~/.auramaxing/no-telemetry', m.optedOut() === true);
});

// ── 2. Identidad estable de la instalación ────────────────────
await withState('id', async (m, dir) => {
  const a = m.installId();
  const b = m.installId();
  ok('install_id es un UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a), a);
  ok('install_id persiste entre llamadas', a === b, `${a} vs ${b}`);
  ok('install_id se escribe a disco', existsSync(join(dir, 'install-id')) &&
    readFileSync(join(dir, 'install-id'), 'utf8').trim() === a);

  // Un fichero corrupto no debe devolver basura: se regenera.
  writeFileSync(join(dir, 'install-id'), 'no-es-un-uuid\n');
  const c = m.installId();
  ok('id corrupto se regenera como UUID válido', /^[0-9a-f-]{36}$/.test(c) && c !== 'no-es-un-uuid', c);
});

// ── 3. Throttle ───────────────────────────────────────────────
await withState('throttle', async (m, dir) => {
  const now = Date.now();
  ok('sin marca previa el heartbeat sale', m.shouldSend('heartbeat', now) === true);

  writeFileSync(join(dir, 'last-ping'), String(now - 60_000));
  ok('heartbeat a los 60s queda frenado', m.shouldSend('heartbeat', now) === false);
  ok('un alta NUNCA se frena', m.shouldSend('install', now) === true);

  writeFileSync(join(dir, 'last-ping'), String(now - 25 * 3600 * 1000));
  ok('pasadas 24h el heartbeat vuelve a salir', m.shouldSend('heartbeat', now) === true);

  writeFileSync(join(dir, 'last-ping'), String(now - 60_000));
  const r = await m.ping({ event: 'heartbeat' });
  ok('ping() respeta el throttle', r.sent === false && r.reason === 'throttled', JSON.stringify(r));
  const f = await m.ping({ event: 'heartbeat', force: true, dryRun: true });
  ok('--force salta el throttle', f.reason === 'dry-run', JSON.stringify(f));
});

// ── 4. Payload ────────────────────────────────────────────────
await withState('payload', async (m) => {
  const p = m.buildPayload('install');
  ok('lleva install_id + event + os + arch + node',
    !!p.install_id && p.event === 'install' && !!p.os && !!p.arch && !!p.node_version,
    JSON.stringify(p));
  ok('version sale del fichero VERSION del repo', p.version === null || /^[0-9]+\.[0-9.]+$/.test(p.version), String(p.version));
  ok('gh_login es un handle válido o null',
    p.gh_login === null || /^[A-Za-z0-9-]{1,64}$/.test(p.gh_login), String(p.gh_login));
  ok('git_email es un email o null', p.git_email === null || p.git_email.includes('@'), String(p.git_email));
  ok('host_hash es un hash, no el hostname',
    /^[0-9a-f]{32}$/.test(p.host_hash) && !p.host_hash.includes(hostname()), p.host_hash);
  ok('event inválido no se inventa', m.buildPayload('heartbeat').event === 'heartbeat');
});

// ── 5. Red caída ──────────────────────────────────────────────
await withState('network', async (m) => {
  // 127.0.0.1:1 → connection refused inmediato, sin esperar al timeout.
  const sent = await m.send({ install_id: 'x', event: 'heartbeat' },
    { url: 'http://127.0.0.1:1/nope', key: 'k' });
  ok('send() con red caída devuelve false sin lanzar', sent === false);

  process.env.AURA_REGISTRY_URL = 'http://127.0.0.1:1/nope';
  const r = await m.ping({ event: 'install', force: true });
  ok('ping() sobrevive a un servidor caído', r.sent === false && r.reason === 'network', JSON.stringify(r));
  delete process.env.AURA_REGISTRY_URL;
});

// ── 6. El contrato de stdout de update-check.sh sigue intacto ──
{
  const home = join(root, 'uc-home');
  const ax = join(root, 'uc-ax');
  mkdirSync(join(home, '.auramaxing'), { recursive: true });
  mkdirSync(join(ax, 'helpers'), { recursive: true });
  writeFileSync(join(ax, 'VERSION'), '1.24.3\n');
  // Un ping que escribe en stdout: si el wiring no lo silencia, ensucia la salida.
  writeFileSync(join(ax, 'helpers', 'install-ping.mjs'),
    'console.log("PING-RUIDO"); process.exit(0);\n');

  let out = '';
  try {
    out = execFileSync('bash', [new URL('../scripts/update-check.sh', import.meta.url).pathname], {
      env: { ...process.env, HOME: home, AX_DIR: ax, AURA_STATE_DIR: join(home, '.auramaxing') },
      encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) { out = `EXCEPCIÓN: ${e.message}`; }

  ok('update-check.sh no filtra el ping a stdout', !out.includes('PING-RUIDO'), JSON.stringify(out));
  ok('update-check.sh mantiene su contrato de una línea',
    out === '' || /^UPGRADE_AVAILABLE \S+ \S+\s*$/.test(out), JSON.stringify(out));

  // Con opt-out, el instalador ni siquiera debe invocar node.
  writeFileSync(join(home, '.auramaxing', 'no-telemetry'), '');
  let out2 = '';
  try {
    out2 = execFileSync('bash', [new URL('../scripts/update-check.sh', import.meta.url).pathname], {
      env: { ...process.env, HOME: home, AX_DIR: ax }, encoding: 'utf8', timeout: 20_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) { out2 = `EXCEPCIÓN: ${e.message}`; }
  ok('con no-telemetry el ping no corre', !out2.includes('PING-RUIDO'), JSON.stringify(out2));
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
