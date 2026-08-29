#!/usr/bin/env node
/**
 * update-gate — secuencia OBLIGATORIA: primero actualizar, después el precio.
 *
 * Lo que se prueba de verdad:
 *  1. El bloqueo por versión sigue bloqueando (exit 2) tras el turno de gracia.
 *  2. El copy del BLOQUEO no habla de dinero — a esas alturas el usuario solo
 *     tiene que actualizar; mezclar precio ahí rompe el orden pedido.
 *  3. Al bloquear se deja la marca update-pending.json.
 *  4. En el primer prompt DESPUÉS de actualizar sale el aviso EN MAYÚSCULAS
 *     con el precio, y se abre la ventana de 24h (free-until).
 *  5. El aviso no se repite: sale una vez y desaparece.
 *  6. Sin haber estado bloqueado nunca, un equipo al día no recibe el aviso por
 *     esta vía (lo cubre session-start) — el gate no inventa avisos.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const GATE = new URL('../helpers/update-gate.mjs', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'aura-gate-'));
const HOME = join(root, 'home');
const AX = join(HOME, '.auramaxing');
mkdirSync(AX, { recursive: true });
const STATE = join(AX, 'update-state.json');

const setState = (local, remote) =>
  writeFileSync(STATE, JSON.stringify({ checkedAt: Date.now(), local, remote }));

const run = () => spawnSync(process.execPath, [GATE], {
  env: { ...process.env, HOME, AURA_UPDATE_STATE_FILE: STATE, AURA_NO_TELEMETRY: '1' },
  encoding: 'utf8', timeout: 15_000,
});

console.log('\nupdate-gate · secuencia update → precio\n');

// ── 1-3. Desactualizado: gracia, luego bloqueo ────────────────
setState('1.24.3', '1.25.0');
const grace = run();
ok('el primer prompt es de gracia (la ventana puede renderizar)', grace.status === 0,
  `exit ${grace.status}`);

const blocked = run();
ok('el segundo prompt YA bloquea', blocked.status === 2, `exit ${blocked.status}`);
ok('el bloqueo dice qué versión hace falta',
  /1\.25\.0/.test(blocked.stderr + blocked.stdout));
ok('el copy del bloqueo NO menciona el precio',
  !/1,499|1499|\$/.test(blocked.stderr),
  JSON.stringify(blocked.stderr.slice(0, 200)));
ok('al bloquear queda la marca update-pending.json',
  existsSync(join(AX, 'update-pending.json')));

// ── 4. Tras actualizar: el aviso, y en MAYÚSCULAS ─────────────
setState('1.25.0', '1.25.0');           // el update aterrizó
const after = run();
const out = after.stdout + after.stderr;
ok('tras actualizar ya no bloquea', after.status === 0, `exit ${after.status}`);
ok('avisa de las ÚLTIMAS 24 HORAS gratis', /LAST 24 HOURS/.test(out), JSON.stringify(out.slice(0, 300)));
ok('avisa del precio anual', /1,499/.test(out) && /YEAR/.test(out));
ok('el aviso va en MAYÚSCULAS', /LAST 24 HOURS OF AURAMAXING FOR FREE/.test(out));
ok('instruye al modelo a repetirlo en mayúsculas',
  /IN CAPITAL LETTERS/.test(after.stdout), JSON.stringify(after.stdout.slice(0, 200)));
ok('la marca de pendiente se consume', !existsSync(join(AX, 'update-pending.json')));

const until = Number(readFileSync(join(AX, 'free-until'), 'utf8').trim());
const hours = (until - Date.now()) / 3600000;
ok('la ventana libre dura 24h', hours > 23.5 && hours <= 24.05, `${hours.toFixed(2)}h`);

// ── 5. No se repite ───────────────────────────────────────────
const again = run();
ok('el aviso no se repite al siguiente prompt',
  !/LAST 24 HOURS/.test(again.stdout + again.stderr),
  JSON.stringify((again.stdout + again.stderr).slice(0, 200)));

// ── 6. Equipo que nunca estuvo bloqueado ──────────────────────
const HOME2 = join(root, 'home2');
mkdirSync(join(HOME2, '.auramaxing'), { recursive: true });
const STATE2 = join(HOME2, '.auramaxing', 'update-state.json');
writeFileSync(STATE2, JSON.stringify({ checkedAt: Date.now(), local: '1.25.0', remote: '1.25.0' }));
const clean = spawnSync(process.execPath, [GATE], {
  env: { ...process.env, HOME: HOME2, AURA_UPDATE_STATE_FILE: STATE2 },
  encoding: 'utf8', timeout: 15_000,
});
ok('sin bloqueo previo el gate no inventa avisos',
  clean.status === 0 && !/LAST 24 HOURS/.test(clean.stdout + clean.stderr));

// ── Fail-open: el gate nunca puede tumbar una sesión ──────────
writeFileSync(STATE, '{corrupto');
const broken = run();
ok('estado corrupto → fail-open (exit 0)', broken.status === 0, `exit ${broken.status}`);

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
