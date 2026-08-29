#!/usr/bin/env node
/**
 * users.mjs — el padrón, ejecutado de verdad contra un servidor stub.
 *
 * Por qué existe: sin la service-role key este script no se había ejecutado
 * NUNCA. Un padrón que no corre, o que trunca, es peor que no tenerlo — diría
 * un número menor de usuarios con total confianza.
 *
 * Lo que se prueba de verdad:
 *  1. Corre de punta a punta y agrega por instalación, no por evento.
 *  2. PAGINA: con 2.500 filas (2,5 páginas) no pierde ni una — este es el fallo
 *     que tenía el `limit` fijo, y aparecía sólo al pasar de 1.000 eventos.
 *  3. El gh_login que llega null en el primer ping y relleno después se
 *     consolida (si no, un usuario identificado se contaría como anónimo).
 *  4. Sin service-role key no adivina: sale por error con instrucciones.
 */
import { createServer } from 'http';
import { execFile } from 'child_process';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const SCRIPT = new URL('../scripts/users.mjs', import.meta.url).pathname;

// ── Padrón sintético: 3 instalaciones, 2.500 eventos ──────────
// La instalación B manda su primer ping SIN identidad y la rellena después:
// es el caso real de una máquina sin `gh` autenticado todavía.
const INSTALLS = [
  { id: '11111111-1111-4111-8111-111111111111', gh: 'ana-dev',  email: 'ana@example.com',  os: 'darwin' },
  { id: '22222222-2222-4222-8222-222222222222', gh: 'beto-dev', email: null,               os: 'linux'  },
  { id: '33333333-3333-4333-8333-333333333333', gh: null,       email: null,               os: 'win32'  },
];
const rows = [];
const t0 = Date.parse('2026-08-01T00:00:00Z');
for (let i = 0; i < 2500; i++) {
  const inst = INSTALLS[i % 3];
  const firstOfB = inst.id.startsWith('2') && i < 3;   // primer ping de B: anónimo
  rows.push({
    install_id: inst.id,
    event: i < 3 ? 'install' : 'heartbeat',
    version: '1.25.0',
    gh_login: firstOfB ? null : inst.gh,
    git_email: firstOfB ? null : inst.email,
    os: inst.os, arch: 'arm64', node_version: 'v20.19.0', tz: 'UTC',
    host_hash: 'h' + inst.id.slice(0, 8),
    created_at: new Date(t0 + i * 60_000).toISOString(),
  });
}

let served = 0;
const server = createServer((req, res) => {
  const m = /(\d+)-(\d+)/.exec(req.headers['range'] || '');
  const from = m ? Number(m[1]) : 0;
  const to = m ? Number(m[2]) : rows.length - 1;
  const page = rows.slice(from, to + 1);
  served++;
  res.writeHead(206, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(page));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const REST = `http://127.0.0.1:${server.address().port}/rest`;

// ASÍNCRONO a propósito: spawnSync congela el event loop de ESTE proceso, y el
// servidor stub vive aquí — con spawnSync el hijo espera una respuesta que nadie
// puede enviar y el test muere por timeout. Bloqueo mutuo, no fallo del script.
const run = (extra = [], env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [SCRIPT, ...extra], {
    env: { ...process.env, AURA_REGISTRY_REST: REST,
      AURA_REGISTRY_SERVICE_KEY: 'clave-de-prueba', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  }, (err, stdout, stderr) => resolve({
    status: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '',
  }));
});

console.log('\nusers.mjs · padrón\n');

const r = await run();
ok('el script corre sin explotar', r.status === 0, `exit ${r.status} · ${r.stderr.slice(0, 200)}`);
ok('cuenta 3 instalaciones únicas, no 2.500 eventos', /\b3 instalaciones\b/.test(r.stdout),
  JSON.stringify(r.stdout.slice(-200)));
ok('los 2.500 eventos llegan enteros (paginación)', /2500 eventos/.test(r.stdout),
  JSON.stringify(r.stdout.slice(-200)));
ok('hizo falta más de una página', served >= 3, `${served} peticiones`);
ok('identifica a 2 de 3 (la tercera no tiene identidad)', /\b2 identificadas\b/.test(r.stdout),
  JSON.stringify(r.stdout.slice(-200)));
ok('lista a ana-dev con su email', /ana-dev/.test(r.stdout) && /ana@example\.com/.test(r.stdout));
ok('consolida el gh_login que llegó tarde', /beto-dev/.test(r.stdout));
ok('la instalación sin identidad no se inventa un nombre',
  (r.stdout.match(/—/g) || []).length >= 2, JSON.stringify(r.stdout.slice(-300)));

const j = await run(['--json']);
let parsed = null;
try { parsed = JSON.parse(j.stdout); } catch { /* queda null */ }
ok('--json es JSON válido', Array.isArray(parsed) && parsed.length === 3,
  JSON.stringify((j.stdout || j.stderr).slice(0, 200)));
if (parsed) {
  const beto = parsed.find(u => u.install_id.startsWith('2'));
  ok('el conteo de pings por instalación cuadra',
    parsed.reduce((a, u) => a + u.pings, 0) === 2500,
    String(parsed.map(u => u.pings)));
  ok('beto-dev queda identificado pese al primer ping anónimo', beto.gh_login === 'beto-dev',
    String(beto.gh_login));
}

const noKey = await run([], { AURA_STATE_DIR: '/nonexistent-dir-xyz',
  AURA_REGISTRY_SERVICE_KEY: '' });
ok('sin service-role key falla en vez de mentir', noKey.status === 1);
ok('y dice exactamente dónde conseguirla', /service_role/.test(noKey.stderr),
  JSON.stringify(noKey.stderr.slice(0, 160)));

server.close();
console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
