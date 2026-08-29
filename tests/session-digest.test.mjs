#!/usr/bin/env node
/**
 * session-digest — tests sobre transcripts sintéticos.
 *
 * Lo que se prueba de verdad (no que "corre"):
 *  1. Un prompt tecleado por la persona y una inyección del sistema NO se mezclan.
 *  2. Un secreto que aparezca en un prompt sale REDACTADO del digest.
 *  3. El proyecto se atribuye al cwd de trabajo, no a HOME.
 *  4. La ventana --since-min excluye lo viejo.
 *  5. El digest sobrevive a JSONL corrupto sin romperse.
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const HOME = homedir();
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// Secretos ensamblados en tiempo de ejecución: escribir el literal en el fichero
// haría que el pii-redactor bloqueara este mismo test.
const FAKE_KEY = 'sk-' + 'T'.repeat(28);
const FAKE_GH = 'ghp_' + 'B'.repeat(30);

const root = mkdtempSync(join(tmpdir(), 'aura-digest-'));
const projDir = join(root, 'projects', '-Users-macbook');
mkdirSync(projDir, { recursive: true });
// Directorio de trabajo real que debe ganarle a HOME en la atribución.
const workDir = join(root, 'mi-proyecto');
mkdirSync(workDir, { recursive: true });

const line = (o) => JSON.stringify(o) + '\n';
const userMsg = (text, human, cwd) => line({
  type: 'user', isSidechain: false, cwd, gitBranch: 'main', version: '2.1.241',
  timestamp: new Date().toISOString(),
  ...(human ? { origin: { kind: 'human' }, promptSource: 'typed' } : {}),
  message: { role: 'user', content: text },
});

// ── sesión A: trabajo real ────────────────────────────────────────────────
let a = '';
a += line({ type: 'ai-title', aiTitle: 'Sesion de prueba' });
a += line({ type: 'mode', mode: 'normal' });
// HOME aparece muchas veces (arranque), workDir menos — workDir debe ganar igual.
for (let i = 0; i < 12; i++) a += userMsg('<system-reminder>ruido</system-reminder>', false, HOME);
// El prompt con secretos va DENTRO de los últimos --prompts: si cae fuera del
// recorte, la aserción de redactado pasaría sin haber redactado nada.
for (let i = 0; i < 6; i++) a += userMsg('sigue con el plan', true, workDir);
a += userMsg('Stop hook feedback:\nEVIDENCE GATE — do NOT stop.', false, workDir);
a += userMsg(`arregla el login y usa la clave ${FAKE_KEY} y el token ${FAKE_GH}`, true, workDir);
a += line({
  type: 'assistant', cwd: workDir,
  message: {
    role: 'assistant',
    usage: { input_tokens: 10, cache_read_input_tokens: 120000, cache_creation_input_tokens: 500 },
    content: [
      { type: 'text', text: 'Estoy tocando el modulo de auth.' },
      { type: 'tool_use', name: 'Edit', input: { file_path: join(workDir, 'auth.ts') } },
    ],
  },
});
a += '{ esto no es json valido\n';   // línea corrupta a propósito
writeFileSync(join(projDir, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl'), a);

// ── sesión B: vieja, fuera de la ventana ──────────────────────────────────
const oldFile = join(projDir, 'bbbbbbbb-1111-2222-3333-444444444444.jsonl');
writeFileSync(oldFile, line({ type: 'ai-title', aiTitle: 'Sesion vieja' }) + userMsg('algo antiguo', true, workDir));
const old = new Date(Date.now() - 48 * 3600 * 1000);
utimesSync(oldFile, old, old);

// ── ejecutar ──────────────────────────────────────────────────────────────
process.env.AURA_DIGEST_PROJECTS = join(root, 'projects');
const { buildDigest } = await import('../helpers/session-digest.mjs');

console.log('\nsession-digest');
const res = buildDigest({ sinceMin: 60 });
const text = res.text;

ok('descubre la sesión activa', res.sessions.length === 1, `vio ${res.sessions.length}`);
ok('excluye la sesión fuera de la ventana', !text.includes('Sesion vieja'));
ok('conserva el título de la sesión', text.includes('Sesion de prueba'));

ok('el prompt tecleado aparece', text.includes('arregla el login'));
ok('la inyección del sistema va a su propia sección',
  text.includes('Inyecciones del sistema') && text.includes('Stop hook feedback'));
ok('la inyección NO cuenta como turno del usuario', res.sessions[0].turns === 7, `turns=${res.sessions[0].turns}`);

ok('redacta la clave sk-', !text.includes(FAKE_KEY));
ok('redacta el token ghp_', !text.includes(FAKE_GH));
ok('deja marca del redactado', /REDACTED/.test(text));

ok('atribuye el proyecto al directorio de trabajo, no a HOME',
  res.sessions[0].cwd === workDir, `cwd=${res.sessions[0].cwd}`);
ok('registra el fichero tocado', text.includes('auth.ts'));
ok('registra la herramienta usada', /Edit /.test(text));
ok('estima el contexto consumido', res.sessions[0].ctxTokens > 100000);
ok('sobrevive a una línea JSONL corrupta', text.includes('Estoy tocando el modulo de auth'));

ok('incluye el contrato anti-generalidades', text.includes('CERO generalidades'));
ok('--no-ask quita el contrato', !buildDigest({ sinceMin: 60, ask: false }).text.includes('CERO generalidades'));

const capped = buildDigest({ sinceMin: 60, maxChars: 1200 }).text;
ok('respeta el tope de tamaño', capped.length <= 1400, `len=${capped.length}`);

// Sin sesiones en la ventana: mensaje útil, no excepción.
// Se envejecen los transcripts en vez de estrechar la ventana a milisegundos:
// competir contra la propia escritura del fichero haría el test intermitente.
utimesSync(join(projDir, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl'), old, old);
const empty = buildDigest({ sinceMin: 60 });
ok('sin sesiones no revienta', empty.sessions.length === 0 && empty.text.includes('No hay sesiones'));

rmSync(root, { recursive: true, force: true });

console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail ? 1 : 0);
