#!/usr/bin/env node
/**
 * paywall — el bloqueo de pago de AURAMAXING.
 *
 * Sustituye a update-gate-sequence.test.mjs: el aviso de "ventana gratis" que
 * aquel probaba quedó superseded en v1.26.0 — el producto es de pago desde el
 * primer prompt, y dejar vivos los dos mensajes significaba decirle a la misma
 * persona "te quedan 24h gratis" y "paga ya" en la misma sesión.
 *
 * El código de desbloqueo NO aparece en este fichero ni en ningún otro del
 * repositorio: el caso "desbloqueado" lo prueba leyendo el código de la máquina
 * del creador si está presente. Si se hardcodease aquí, publicarlo en el repo
 * anularía el paywall entero.
 *
 * Lo que se prueba de verdad:
 *  1. Sin código se BLOQUEA (exit 2) y el mensaje lleva precio, checkout y cómo
 *     desbloquear. Un bloqueo sin salida es un bug, no un paywall.
 *  2. Con el código correcto NO se bloquea. Si esto falla, el creador se queda
 *     fuera de su propio producto.
 *  3. Ningún kill-switch documentado lo abre — ni AURA_UPDATE_GATE_OFF ni
 *     AURA_GATEKEEPER_OFF. Era la vía de escape que el propio copy publicaba.
 *  4. Un código inventado, vacío o alterado se rechaza (falla CERRADO).
 *  5. El precio salta de 949 a 1499 pasadas 24h y la ventana no se reinicia.
 *  6. El checkout se abre UNA vez, y sin navegador el bloqueo sigue en pie.
 *  7. activate.mjs rechaza lo inválido y desbloquea con lo válido.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { spawnSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const GATE = new URL('../helpers/update-gate.mjs', import.meta.url).pathname;
const ACTIVATE = new URL('../scripts/activate.mjs', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'aura-paywall-'));

// El código real, solo si esta máquina ya está desbloqueada. Nunca se imprime.
let REAL_CODE = null;
try { REAL_CODE = readFileSync(join(homedir(), '.auramaxing', 'unlocked'), 'utf8').trim() || null; } catch { /* sin desbloquear */ }

function home(name) {
  const h = join(root, name);
  mkdirSync(join(h, '.auramaxing'), { recursive: true });
  return h;
}
const runGate = (h, env = {}) => spawnSync(process.execPath, [GATE], {
  env: { ...process.env, HOME: h, AURA_UPDATE_STATE_FILE: join(h, '.auramaxing', 'update-state.json'), ...env },
  encoding: 'utf8', timeout: 15_000,
});

console.log('\npaywall · bloqueo de pago\n');

// ── 1. Sin código: bloqueado, y con salida ────────────────────
{
  const h = home('sin-codigo');
  const r = runGate(h);
  const out = r.stdout + r.stderr;
  ok('sin código se bloquea', r.status === 2, `exit ${r.status}`);
  ok('dice que es producto de pago', /PAID/i.test(out), JSON.stringify(out.slice(0, 150)));
  ok('lleva el precio de lanzamiento 949', /949/.test(out));
  ok('lleva el precio completo 1,499', /1,499/.test(out));
  ok('lleva la URL de checkout', /whop\.com\/checkout\/plan_XLV0jREwf4LGS/.test(out));
  ok('explica cómo desbloquear', /activate\.mjs/.test(out));
  ok('el bloqueo llega por stdout (el wrapper se traga stderr)',
    /"decision":"block"/.test(r.stdout), JSON.stringify(r.stdout.slice(0, 120)));
  ok('NO publica ningún override', !/AURA_UPDATE_GATE_OFF/.test(out), JSON.stringify(out.slice(0, 200)));
  ok('sigue bloqueado en el prompt siguiente', runGate(h).status === 2);
}

// ── 2. Con el código correcto ─────────────────────────────────
if (REAL_CODE) {
  const h = home('desbloqueado');
  writeFileSync(join(h, '.auramaxing', 'unlocked'), REAL_CODE);
  const r = runGate(h);
  ok('con el código correcto NO se bloquea', r.status === 0, `exit ${r.status}`);
  ok('y no le sale el aviso de pago', !/PAID LICENCE REQUIRED/.test(r.stdout + r.stderr));
} else {
  ok('máquina desbloqueada para probar la exención', false,
    'falta ~/.auramaxing/unlocked — corre scripts/activate.mjs <codigo>');
}

// ── 3. Ningún kill-switch lo abre ─────────────────────────────
{
  const h = home('killswitch');
  ok('AURA_UPDATE_GATE_OFF=1 no lo abre', runGate(h, { AURA_UPDATE_GATE_OFF: '1' }).status === 2);
  ok('AURA_GATEKEEPER_OFF=1 no lo abre', runGate(h, { AURA_GATEKEEPER_OFF: '1' }).status === 2);
  ok('AURA_NO_TELEMETRY=1 no lo abre', runGate(h, { AURA_NO_TELEMETRY: '1' }).status === 2);
}

// ── 4. Códigos inválidos: falla cerrado ───────────────────────
{
  const cases = [
    ['inventado', 'AURAMAX-00000000'],
    ['vacío', ''],
    ['basura', 'no-es-un-codigo'],
    ['con el hash en vez del código', '21870c15be605c15fb21d89d'],
  ];
  for (const [label, value] of cases) {
    const h = home('malo-' + label.replace(/\s+/g, '-'));
    writeFileSync(join(h, '.auramaxing', 'unlocked'), value);
    ok(`código ${label} se rechaza`, runGate(h).status === 2);
  }
  if (REAL_CODE) {
    const h = home('alterado');
    writeFileSync(join(h, '.auramaxing', 'unlocked'), REAL_CODE.slice(0, -1) + 'X');
    ok('un código correcto con un carácter cambiado se rechaza', runGate(h).status === 2);
  }
}

// ── 5. La ventana de descuento ────────────────────────────────
{
  const h = home('ventana');
  const r1 = runGate(h);
  ok('el primer bloqueo ofrece el precio de lanzamiento', /949/.test(r1.stdout + r1.stderr));
  const since = Number(readFileSync(join(h, '.auramaxing', 'paywall-since'), 'utf8').trim());
  ok('la ventana queda sellada con marca temporal', Number.isFinite(since) && since > 0);

  runGate(h);
  const since2 = Number(readFileSync(join(h, '.auramaxing', 'paywall-since'), 'utf8').trim());
  ok('la ventana NO se reinicia en cada prompt', since === since2, `${since} vs ${since2}`);

  writeFileSync(join(h, '.auramaxing', 'paywall-since'), String(Date.now() - 25 * 3600 * 1000));
  const o2 = (() => { const r = runGate(h); return r.stdout + r.stderr; })();
  ok('pasadas 24h ya no ofrece el precio de lanzamiento como vigente',
    !/NEXT 24 HOURS/.test(o2), JSON.stringify(o2.slice(0, 200)));
  ok('y anuncia que la ventana de lanzamiento terminó',
    /launch price has ended/i.test(o2), JSON.stringify(o2.slice(0, 200)));
  ok('sigue bloqueando', runGate(h).status === 2);
}

// ── 6. Checkout: una vez, y nunca imprescindible ──────────────
{
  const h = home('checkout');
  runGate(h, { PATH: '/nonexistent' });   // sin `open` disponible
  ok('marca el checkout como abierto', existsSync(join(h, '.auramaxing', 'checkout-opened')));
  const first = readFileSync(join(h, '.auramaxing', 'checkout-opened'), 'utf8');
  runGate(h); runGate(h);
  ok('no lo reabre en cada prompt',
    readFileSync(join(h, '.auramaxing', 'checkout-opened'), 'utf8') === first);
  ok('sin navegador el bloqueo sigue funcionando',
    runGate(h, { PATH: '/nonexistent' }).status === 2);
}

// ── 7. activate.mjs ───────────────────────────────────────────
{
  const h = home('activar');
  const st = join(h, '.auramaxing');
  const runAct = (arg) => spawnSync(process.execPath, [ACTIVATE, ...(arg ? [arg] : [])], {
    env: { ...process.env, HOME: h, AURA_STATE_DIR: st }, encoding: 'utf8', timeout: 15_000,
  });
  const noArg = runAct();
  ok('sin argumento explica qué hacer y dónde pagar',
    noArg.status === 1 && /whop\.com/.test(noArg.stderr), JSON.stringify(noArg.stderr.slice(0, 120)));
  ok('un código inventado se rechaza', runAct('AURAMAX-DEADBEEF').status === 1);
  ok('y no deja fichero de desbloqueo escrito', !existsSync(join(st, 'unlocked')));

  if (REAL_CODE) {
    const r = runAct(REAL_CODE);
    ok('el código correcto desbloquea', r.status === 0 && /desbloqueado/i.test(r.stdout),
      JSON.stringify(r.stdout.slice(0, 120)));
    ok('y a partir de ahí el gate deja pasar', runGate(h).status === 0);
  }
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
