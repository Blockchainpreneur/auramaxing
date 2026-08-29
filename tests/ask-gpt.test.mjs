#!/usr/bin/env node
/**
 * ask-gpt — el camino de envío por API contra un servidor local.
 *
 * Sin esto, el backend `openai` sólo estaría "escrito", no probado: se verifica
 * que elige modelo consultando la cuenta, que manda el digest completo, que
 * parsea /v1/responses, que cae a /v1/chat/completions cuando el primero falla,
 * y que guarda la respuesta en disco.
 */
import { createServer } from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Servidor que imita a la API. `mode` decide cómo se porta /v1/responses. */
function mockApi(mode) {
  const seen = { auth: null, models: 0, responses: null, chat: null };
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.auth = req.headers.authorization;
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/v1/models') {
        seen.models++;
        return send(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-5' }, { id: 'tts-1' }, { id: 'gpt-4' }] });
      }
      if (req.url === '/v1/responses') {
        seen.responses = JSON.parse(body || '{}');
        if (mode === 'responses-404') return send(404, { error: { message: 'unknown endpoint' } });
        return send(200, { output_text: 'PLAN CONCRETO 1. tocar auth.ts' });
      }
      if (req.url === '/v1/chat/completions') {
        seen.chat = JSON.parse(body || '{}');
        return send(200, { choices: [{ message: { content: 'PLAN DE RESERVA' } }] });
      }
      send(404, { error: { message: 'nope' } });
    });
  });
  return { srv, seen };
}

function runAskGpt(port, outFile, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'ask-gpt.mjs'), '--out', outFile, ...extra], {
      cwd: ROOT,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key-not-real',
        AURA_OPENAI_HOST: '127.0.0.1',
        AURA_OPENAI_PORT: String(port),
        AURA_OPENAI_INSECURE: '1',
        AURA_GPT_MODEL: '',            // fuerza el descubrimiento de modelo
        AURA_GPT_MODEL_CACHE: join(process.env.AURA_DIGEST_PROJECTS || tmpdir(), 'model-cache.txt'),
        AURA_DIGEST_PROJECTS: process.env.AURA_DIGEST_PROJECTS,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// Transcript sintético para que haya al menos una sesión que enviar.
const root = mkdtempSync(join(tmpdir(), 'aura-askgpt-'));
const projDir = join(root, 'projects', '-tmp-proj');
const { mkdirSync, writeFileSync } = await import('fs');
mkdirSync(projDir, { recursive: true });
writeFileSync(join(projDir, 'cccccccc-1111-2222-3333-444444444444.jsonl'),
  JSON.stringify({ type: 'ai-title', aiTitle: 'Sesion mock' }) + '\n' +
  JSON.stringify({
    type: 'user', isSidechain: false, cwd: root, gitBranch: 'main',
    origin: { kind: 'human' }, promptSource: 'typed',
    message: { role: 'user', content: 'necesito escalar el cobro' },
  }) + '\n');
process.env.AURA_DIGEST_PROJECTS = join(root, 'projects');

console.log('\nask-gpt');

// ── caso 1: /v1/responses responde bien ───────────────────────────────────
{
  const { srv, seen } = mockApi('ok');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const outFile = join(root, 'respuesta1.md');
  const { code, out } = await runAskGpt(port, outFile);
  srv.close();

  ok('sale con éxito', code === 0, `code=${code}`);
  ok('descubre el modelo preguntando a la cuenta', seen.models === 1);
  ok('elige gpt-5 sobre gpt-4o', seen.responses?.model === 'gpt-5', `model=${seen.responses?.model}`);
  ok('manda la clave en Authorization', seen.auth === 'Bearer test-key-not-real');
  ok('el envío lleva el contexto de la sesión', /Sesion mock/.test(seen.responses?.input || ''));
  ok('el envío lleva el contrato', /CERO generalidades/.test(seen.responses?.input || ''));
  ok('imprime la respuesta', /PLAN CONCRETO/.test(out));
  ok('guarda la respuesta en --out', existsSync(outFile) && /PLAN CONCRETO/.test(readFileSync(outFile, 'utf8')));
  ok('la cabecera guardada nombra el modelo', /gpt-5/.test(readFileSync(outFile, 'utf8')));
}

// ── caso 2: /v1/responses no existe → cae a chat/completions ──────────────
{
  const { srv, seen } = mockApi('responses-404');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const outFile = join(root, 'respuesta2.md');
  const { code, out } = await runAskGpt(port, outFile);
  srv.close();

  ok('cae a /v1/chat/completions cuando el otro falla', seen.chat !== null);
  ok('el fallback también lleva el digest', /Sesion mock/.test(seen.chat?.messages?.[0]?.content || ''));
  ok('devuelve la respuesta del fallback', code === 0 && /PLAN DE RESERVA/.test(out));
}

// ── caso 3: --dry no manda nada ───────────────────────────────────────────
{
  const { srv, seen } = mockApi('ok');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const { code, out } = await runAskGpt(port, join(root, 'nada.md'), ['--dry']);
  srv.close();
  ok('--dry no llama a la API', seen.responses === null && seen.models === 0);
  ok('--dry imprime el digest', code === 0 && /Sesion mock/.test(out));
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail ? 1 : 0);
