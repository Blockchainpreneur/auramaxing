#!/usr/bin/env node
/**
 * Tests for the ChatGPT Council trigger (helpers/gpt-council.mjs + council-brief.mjs).
 * Run: node tests/gpt-council.test.mjs
 *
 * Everything runs against an isolated AURA_COUNCIL_DIR with AURA_COUNCIL_NO_SPAWN=1,
 * so no browser is touched and the user's real council state is never mutated.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const HOOK = join(homedir(), 'auramaxing', 'helpers', 'gpt-council.mjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

let DIR;
function fresh() {
  DIR = mkdtempSync(join(tmpdir(), 'council-test-'));
  mkdirSync(join(DIR, 'sessions'), { recursive: true });
  return DIR;
}
function run(payload, args = [], env = {}) {
  try {
    return execFileSync(process.execPath, [HOOK, ...args], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, AURA_COUNCIL_DIR: DIR, AURA_COUNCIL_NO_SPAWN: '1', ...env },
    });
  } catch (e) { return `THREW:${e.message}`; }
}
const requests = () => readdirSync(DIR).filter((f) => f.startsWith('request-'));
// In production the driver releases the lock in its finally block; with
// AURA_COUNCIL_NO_SPAWN=1 no driver runs, so the tests release it by hand.
const driverFinished = () => { try { rmSync(join(DIR, 'lock'), { recursive: true, force: true }); } catch {} };
const state = () => { try { return JSON.parse(readFileSync(join(DIR, 'state.json'), 'utf8')); } catch { return {}; } };
const sessionFile = (sid) => join(DIR, 'sessions', `${sid}.json`);
const sess = (sid) => JSON.parse(readFileSync(sessionFile(sid), 'utf8'));

const A = { session_id: 'sessA', cwd: join(homedir(), 'auramaxing'), prompt: 'arregla el webhook de stripe' };
const B = { session_id: 'sessB', cwd: homedir(), prompt: 'construye el council de chatgpt' };

console.log('\ngpt-council');

// 1 — a single working terminal must stay silent
fresh();
let out = run(A);
ok('1 sesión ocupada → no dispara', requests().length === 0 && out.trim() === '', out.slice(0, 80));
ok('1 sesión ocupada → queda registrada como busy', sess('sessA').state === 'busy');

// 2 — the second concurrent terminal triggers the council
out = run(B);
ok('2 sesiones ocupadas → dispara', requests().length === 1, `requests=${requests().length}`);
ok('2 sesiones → avisa en stdout', /COUNCIL/.test(out) && /2 terminales/.test(out), out.slice(0, 120));
ok('2 sesiones → estado dispatched', state().lastStatus === 'dispatched' && state().lastBusy === 2);
const req = JSON.parse(readFileSync(join(DIR, requests()[0]), 'utf8'));
ok('request lleva el prompt vivo', req.prompt === B.prompt);
ok('request lleva la otra terminal como peer', req.peers.length === 1 && req.peers[0].prompt === A.prompt);

// 3 — one dispatch per PROMPT: the same prompt never opens a second tab, so a
// tab the user closed stays closed until the next prompt.
driverFinished();
run(B);
ok('mismo prompt → NO reabre', requests().length === 1, `requests=${requests().length}`);
run(B);
ok('mismo prompt, tercera vez → sigue sin reabrir', requests().length === 1);

// 3b — a NEW prompt earns a new dispatch immediately (no time cooldown)
run({ session_id: 'sessB', cwd: homedir(), prompt: 'prompt nuevo y distinto' });
ok('prompt nuevo → dispara otra vez (sin esperar)', requests().length === 2, `requests=${requests().length}`);
driverFinished();

// 3c — time throttling still available, but opt-in
run({ session_id: 'sessB', cwd: homedir(), prompt: 'un tercer prompt' }, [], { AURA_COUNCIL_COOLDOWN_MIN: '60' });
ok('AURA_COUNCIL_COOLDOWN_MIN sigue funcionando si lo pides', requests().length === 2, `requests=${requests().length}`);

// 4 — --force overrides every guard
run({ session_id: 'sessB', cwd: homedir(), prompt: 'un tercer prompt' }, ['--force']);
ok('--force ignora los guardas', requests().length === 3, `requests=${requests().length}`);

// 5 — Stop marks the terminal idle, dropping it out of the busy count
fresh(); driverFinished();
run(A); run(B);
ok('setup: dispara con 2', requests().length === 1);
driverFinished();
run(A, ['--stop']);
ok('--stop marca idle', sess('sessA').state === 'idle');
run({ session_id: 'sessB', cwd: homedir(), prompt: 'prompt posterior al stop' });
ok('1 busy tras el stop → no dispara', requests().length === 1, `requests=${requests().length}`);

// 6 — a crashed terminal must not keep the council armed forever
fresh();
writeFileSync(sessionFile('ghost'), JSON.stringify({
  sessionId: 'ghost', pid: 999999, cwd: homedir(), project: 'ghost', state: 'busy', updatedTs: Date.now(),
}));
run(A);
ok('sesión con pid muerto → no cuenta', requests().length === 0);
ok('sesión con pid muerto → se borra', !existsSync(sessionFile('ghost')));

// 7 — an abandoned busy marker expires
fresh();
writeFileSync(sessionFile('stale'), JSON.stringify({
  sessionId: 'stale', pid: process.pid, cwd: homedir(), project: 'stale', state: 'busy',
  updatedTs: Date.now() - 60 * 60 * 1000,
}));
run(A);
ok('marcador busy viejo (>TTL) → no cuenta', requests().length === 0);

// 8 — only one terminal wins the race
fresh();
run(A);
mkdirSync(join(DIR, 'lock'));
run(B);
ok('lock activo → no hay disparo duplicado', requests().length === 0);

// 9 — the OFF switch
fresh();
run(A);
run(B, [], { AURA_COUNCIL_OFF: '1' });
ok('AURA_COUNCIL_OFF=1 apaga el council', requests().length === 0);

// 10 — a live pid that is NOT claude (recycled pid) must not count as a terminal
fresh();
writeFileSync(sessionFile('recycled'), JSON.stringify({
  sessionId: 'recycled', pid: 1, cwd: homedir(), project: 'recycled', state: 'busy', updatedTs: Date.now(),
}));
run(A);
ok('pid vivo pero no-claude (reciclado) → no cuenta', requests().length === 0);

console.log('\ncouncil-brief');
const { buildBrief, scrubSecrets } = await import(join(homedir(), 'auramaxing', 'helpers', 'council-brief.mjs'));

// The brief leaves the machine, so it must never carry a credential.
// Fixtures are assembled at runtime: a literal one would trip the PII shield.
const K = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const fx = {
  openai: 's' + 'k-proj-' + K.toLowerCase(),
  gh: 'gh' + 'p_' + K,
  aws: 'AK' + 'IA' + 'IOSFODNN7EXAMPL' + 'E',  // real key ids are AKIA + 16
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.ey' + 'Jyb2xlIjoic2VydmljZSJ9.abcdefghijk',
  pw: 'sup3rs3cret',
};
const dirty = [
  `OPENAI_API_KEY=${fx.openai}`,
  `token: ${fx.gh}`,
  `aws: ${fx.aws}`,
  `SUPABASE_SERVICE_ROLE_KEY = ${fx.jwt}`,
  `postgres://admin:${fx.pw}@db.example.com:5432/app`,
].join('\n');
const clean = scrubSecrets(dirty);
ok('scrub: borra api-key / token de git / clave aws', !clean.includes(fx.openai) && !clean.includes(fx.gh) && !clean.includes(fx.aws), clean);
ok('scrub: borra el JWT de service_role', !clean.includes(fx.jwt), clean);
ok('scrub: borra la contraseña de la URL de conexión', !clean.includes(fx.pw), clean);
ok('scrub: no destruye el texto alrededor', /OPENAI_API_KEY/.test(clean) && /postgres:\/\//.test(clean));

const brief = buildBrief({
  cwd: join(homedir(), 'auramaxing'), prompt: 'construye el council', sessionId: null,
  peers: [{ project: 'actions.xyz', state: 'busy', prompt: 'checkout con stripe' }],
});
ok('incluye el prompt vivo', brief.includes('construye el council'));
ok('incluye las otras terminales', brief.includes('actions.xyz') && brief.includes('checkout con stripe'));
ok('incluye estado de git del repo', /Rama:/.test(brief));
ok('prohíbe explícitamente las generalidades', /CERO generalidades/.test(brief) && /mejora la UX/.test(brief));
ok('exige acción/lógica/aceptación/riesgo', ['ACCIÓN:', 'LÓGICA:', 'DESCARTADO:', 'ACEPTACIÓN:', 'RIESGO:', 'APALANCAMIENTO:'].every((k) => brief.includes(k)));
ok('exige el cierre de una sola línea', /SI SOLO PUEDO HACER UNA COSA HOY/.test(brief));
ok('pide arrancar la llamada con los pasos', /modo voz/.test(brief));
ok('cabe en el composer (<=9100 chars)', brief.length <= 9100, `len=${brief.length}`);

try { rmSync(DIR, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
