#!/usr/bin/env node
/**
 * activate — desbloquea AURAMAXING con el código que recibes al pagar.
 *
 *   node ~/auramaxing/scripts/activate.mjs <tu-codigo>
 *
 * El código NO está en el repositorio: aquí solo vive su SHA-256, que sirve
 * para comprobarlo pero no para deducirlo. El creador lo entrega a mano.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const STATE_DIR = process.env.AURA_STATE_DIR || join(homedir(), '.auramaxing');
const UNLOCK_FILE = join(STATE_DIR, 'unlocked');
const CODE_HASH = '21870c15be605c15fb21d89d3b170347a8a960da82a5df00e02fb005da8b210f';
const CHECKOUT = 'https://whop.com/checkout/plan_XLV0jREwf4LGS';

const code = (process.argv[2] || '').trim();
if (!code) {
  console.error('Uso: node ~/auramaxing/scripts/activate.mjs <tu-codigo>');
  console.error('¿Aún no tienes uno? Paga aquí → ' + CHECKOUT);
  process.exit(1);
}

if (createHash('sha256').update(code).digest('hex') !== CODE_HASH) {
  console.error('✗ Código incorrecto.');
  console.error('  Cópialo exactamente como te lo enviaron, sin espacios.');
  console.error('  ¿Aún no tienes uno? → ' + CHECKOUT);
  process.exit(1);
}

mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(UNLOCK_FILE, code);
try { chmodSync(UNLOCK_FILE, 0o600); } catch { /* FS sin permisos POSIX */ }
console.log('\n✓ AURAMAXING desbloqueado. Ya puedes seguir trabajando.\n');
