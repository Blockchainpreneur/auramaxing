#!/usr/bin/env node
/**
 * session-digest — TODO el contexto de las sesiones vivas de Claude Code,
 * en un solo texto, SIN abrir el navegador.
 *
 * Fuente de verdad: los transcripts que Claude Code escribe siempre en
 * ~/.claude/projects/<slug>/<sessionId>.jsonl. No depende del Council
 * (pausado) ni de ningún hook: si hay una terminal viva, hay transcript.
 *
 * Por sesión extrae: proyecto, cwd, rama, título, contexto usado, últimos
 * prompts del usuario, qué estaba haciendo el agente, herramientas/archivos
 * tocados, ledger abierto. Por proyecto: git (rama, sucios, commits, diffstat)
 * y el documento rector. Global: next-action + tarea actual.
 *
 * Todo pasa por scrubSecrets() antes de salir: el digest está pensado para
 * pegarse/enviarse fuera de la máquina.
 *
 * Uso:
 *   node helpers/session-digest.mjs                 # imprime el digest
 *   node helpers/session-digest.mjs --since-min 60  # ventana de actividad
 *   node helpers/session-digest.mjs --json          # metadatos, sin prosa
 *   node helpers/session-digest.mjs --no-ask        # sin el bloque "LO QUE PIDO"
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import { homedir, hostname } from 'os';
import { scrubSecrets } from './council-brief.mjs';

const HOME = homedir();
const AURA = join(HOME, '.auramaxing');
// Override sólo para tests: apunta el descubrimiento a transcripts sintéticos.
const PROJECTS = process.env.AURA_DIGEST_PROJECTS || join(HOME, '.claude', 'projects');

// Sólo se lee la cola del transcript: son ficheros de decenas de MB y lo único
// que importa es el estado reciente.
const TAIL_BYTES = 700 * 1024;
const DEFAULTS = { sinceMin: 240, prompts: 6, maxChars: 60000, ask: true };

// ── utilidades ────────────────────────────────────────────────────────────
function sh(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return fallback; }
}

function clip(s, n) {
  if (!s) return '';
  s = String(s).replace(/\r/g, '').trim();
  return s.length > n ? s.slice(0, n).trimEnd() + ' …[cortado]' : s;
}

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return 'hace segundos';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h}h ${m % 60}min`;
}

function tail(path, bytes = TAIL_BYTES) {
  let fd;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // descarta línea partida
    return text;
  } catch { return ''; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch {} } }
}

/**
 * Clasifica una entrada `user`:
 *   'typed'    → lo tecleó la persona (origin.kind==='human'), su intención real
 *   'injected' → resumen de compactación, Stop-hook, auto-resume del sentinel…
 *   null       → ruido (tool_result, system-reminder, comando)
 *
 * La distinción importa: mezclar un "Stop hook feedback:" con un prompt humano
 * hace que el consejo se dirija a lo que dijo un hook, no a lo que quiere el usuario.
 */
function promptKind(entry) {
  if (entry.type !== 'user' || entry.isSidechain) return null;
  const c = entry.message?.content;
  if (typeof c !== 'string') return null;              // array = tool_result
  const t = c.trim();
  if (!t || t.length < 2) return null;
  if (t.startsWith('<')) return null;                  // <system-reminder>, <command-name>…
  if (/^\[(AURAMAXING|MAXXING-SDR|CONTEXT-AUTO-REFRESH)/.test(t)) return null;
  if (/^Caveat: The messages below/.test(t)) return null;
  return entry.origin?.kind === 'human' ? 'typed' : 'injected';
}

/**
 * Directorio de trabajo REAL de la sesión = el cwd más frecuente en el transcript.
 *
 * El nombre del directorio de transcripts codifica el cwd de ARRANQUE, no el
 * proyecto: aquí todas las terminales nacen en `~` y entran al proyecto después,
 * así que el slug las colapsaría todas en `/Users/macbook`. La frecuencia sí
 * distingue (econ-about, ai.pump, aipump-monitor…). El slug queda de reserva
 * para cuando ningún cwd observado exista ya en disco.
 */
function resolveCwd(file, cwdCounts) {
  const total = [...cwdCounts.values()].reduce((a, b) => a + b, 0);
  const floor = Math.max(3, total * 0.05);
  // HOME es el cwd por defecto de toda terminal, nunca "el proyecto": cualquier
  // otro directorio con presencia real (≥5% de las entradas) lo desbanca.
  const observed = [...cwdCounts.entries()]
    .sort((a, b) => {
      const solid = (e) => (e[0] !== HOME && e[1] >= floor ? 1 : 0);
      return solid(b) - solid(a) || b[1] - a[1];
    })
    .map(([c]) => c);
  const slug = basename(join(file, '..'));
  const decoded = '/' + slug.replace(/^-+/, '').split('-').join('/');
  for (const cand of [...observed, decoded]) {
    try { if (cand && existsSync(cand) && statSync(cand).isDirectory()) return cand; } catch {}
  }
  return observed[0] || HOME;
}

function textOf(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function toolLabel(block) {
  const i = block.input || {};
  const arg = i.file_path || i.path || i.pattern || i.command || i.url || i.prompt || '';
  return `${block.name}${arg ? ' ' + clip(String(arg).split('\n')[0], 90) : ''}`;
}

// ── lectura de una sesión ─────────────────────────────────────────────────
function readSession(file, opts) {
  const raw = tail(file);
  if (!raw) return null;

  const s = {
    sessionId: basename(file, '.jsonl'),
    file,
    mtime: statSync(file).mtimeMs,
    cwd: '', branch: '', version: '', title: '', mode: '',
    prompts: [], injected: [], lastAssistant: '', tools: [], files: [],
    ctxTokens: 0, compacts: 0, turns: 0, workdirs: [],
  };
  const cwdCounts = new Map();

  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }

    if (j.cwd) cwdCounts.set(j.cwd, (cwdCounts.get(j.cwd) || 0) + 1);
    if (j.gitBranch) s.branch = j.gitBranch;
    if (j.version) s.version = j.version;

    switch (j.type) {
      case 'ai-title': if (j.aiTitle) s.title = j.aiTitle; break;
      case 'mode': if (j.mode) s.mode = j.mode; break;
      case 'system':
        if (j.subtype === 'compact_boundary') s.compacts++;
        break;
      case 'user': {
        const kind = promptKind(j);
        if (kind === 'typed') {
          s.turns++;
          s.prompts.push({ ts: j.timestamp, text: j.message.content });
        } else if (kind === 'injected') {
          s.injected.push({ ts: j.timestamp, text: j.message.content });
        }
        break;
      }
      case 'assistant': {
        const u = j.message?.usage;
        if (u) {
          const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          if (used > s.ctxTokens) s.ctxTokens = used;
        }
        const t = textOf(j.message).trim();
        if (t) s.lastAssistant = t;
        for (const b of j.message?.content || []) {
          if (b.type !== 'tool_use') continue;
          s.tools.push(toolLabel(b));
          const f = b.input?.file_path || b.input?.notebook_path;
          if (f) s.files.push(f);
        }
        break;
      }
      default: break;
    }
  }

  s.prompts = s.prompts.slice(-opts.prompts).reverse();
  s.injected = s.injected.slice(-2).reverse();
  s.tools = [...new Set(s.tools)].slice(-14).reverse();
  s.files = [...new Set(s.files)].slice(-14).reverse();
  s.cwd = resolveCwd(file, cwdCounts);
  s.workdirs = [...cwdCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([c]) => c !== s.cwd)
    .slice(0, 3)
    .map(([c, n]) => `${c} (${n})`);
  return s;
}

// ── descubrimiento ────────────────────────────────────────────────────────
function discover(opts) {
  const cutoff = Date.now() - opts.sinceMin * 60000;
  const found = [];
  let dirs = [];
  try { dirs = readdirSync(PROJECTS); } catch { return found; }
  for (const d of dirs) {
    const dir = join(PROJECTS, d);
    let files = [];
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch { continue; }
    for (const f of files) {
      const p = join(dir, f);
      try { if (statSync(p).mtimeMs >= cutoff) found.push(p); } catch {}
    }
  }
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

// ── contexto por proyecto (una vez por cwd, no por sesión) ────────────────
function projectContext(cwd) {
  const ctx = { cwd, project: basename(cwd) || cwd, git: null, doc: null };
  const inRepo = sh('git rev-parse --is-inside-work-tree 2>/dev/null', cwd) === 'true';
  if (inRepo) {
    ctx.git = {
      branch: sh('git rev-parse --abbrev-ref HEAD', cwd, '?'),
      commits: sh('git log --oneline -5', cwd),
      dirty: sh('git status --porcelain | head -20', cwd),
      diffstat: sh('git diff --stat HEAD | tail -12', cwd),
      remote: sh('git remote get-url origin 2>/dev/null', cwd),
    };
  }
  const names = ['PRD.md', 'STATUS.md', 'SPEC.md', 'PLAN.md', 'CLAUDE.md', 'ROADMAP.md', 'README.md'];
  for (const n of names) {
    const p = join(cwd, n);
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        const body = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).slice(0, 40).join('\n');
        ctx.doc = { name: n, body: clip(body, 1500) };
        break;
      }
    } catch {}
  }
  return ctx;
}

function openLedger(sessionId) {
  for (const p of [join(AURA, 'ledger', `${sessionId}.json`), join(AURA, 'ledger.json')]) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, 'utf8'));
      const open = (j.items || []).filter((i) => !i.done);
      if (open.length) return open.map((i) => `#${i.id} ${clip(i.desc, 160)}`);
    } catch {}
  }
  return [];
}

function globalState() {
  const g = {};
  try {
    const p = join(AURA, 'next-action.txt');
    if (existsSync(p)) g.nextAction = clip(readFileSync(p, 'utf8'), 500);
  } catch {}
  try {
    const p = join(AURA, 'current-task.json');
    if (existsSync(p)) {
      const t = JSON.parse(readFileSync(p, 'utf8'));
      g.currentTask = clip(`${t.label || t.id || ''}`, 200);
    }
  } catch {}
  try {
    g.auramaxing = readFileSync(join(HOME, 'auramaxing', 'VERSION'), 'utf8').trim();
  } catch {}
  return g;
}

// ── el contrato: lo que se le exige a ChatGPT ─────────────────────────────
const ASK = `## LO QUE PIDO

Eres el consejo técnico de este operador. Arriba tienes el estado REAL y COMPLETO
de todas sus terminales de Claude Code trabajando en paralelo ahora mismo.

Dame los MEJORES PRÓXIMOS PASOS para escalar y perfeccionar este trabajo.

REGLAS DURAS — el incumplimiento invalida la respuesta:
1. CERO generalidades. Prohibido "mejora los tests", "considera refactorizar",
   "documenta mejor", "añade monitorización". Si un consejo se puede aplicar a
   cualquier otro proyecto, no lo escribas.
2. Cada paso cita el archivo, la función, el comando, la rama o la métrica
   CONCRETA que aparece arriba. Si no puedes anclarlo a algo del contexto, fuera.
3. Cada paso lleva su cadena lógica completa: por qué ESTO y no otra cosa, qué
   supuesto lo sostiene y qué evidencia del contexto lo respalda.
4. Si dos sesiones se pisan (mismo archivo, mismo objetivo, ramas divergentes),
   dilo primero y explícito: es el riesgo más caro que hay aquí.
5. Si el contexto es insuficiente para una recomendación, dilo — no rellenes.

FORMATO por cada paso (ordenados de mayor a menor apalancamiento):

### N. <acción en imperativo, una línea>
- SESIÓN/PROYECTO: cuál de los de arriba
- ACCIÓN: el cambio exacto (archivo:línea, comando, o diff conceptual)
- LÓGICA: por qué esto ahora; el razonamiento completo, sin saltos
- DESCARTADO: qué alternativa evaluaste y por qué pierde
- ACEPTACIÓN: cómo se verifica que quedó bien (test, comando, número)
- RIESGO: qué se rompe si sale mal, y el rollback
- APALANCAMIENTO: impacto × ejecutabilidad ÷ esfuerzo, y el número que lo justifica

Cierra con:
SI SOLO PUEDO HACER UNA COSA HOY: <una frase, la de mayor apalancamiento>
LO QUE ESTOY HACIENDO MAL: <la crítica más dura que sostenga la evidencia de arriba>`;

// ── render ────────────────────────────────────────────────────────────────
export function buildDigest(userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const files = discover(opts);
  const sessions = files.map((f) => readSession(f, opts)).filter(Boolean);

  // Se descarta sólo lo que no tiene NADA (arranque en blanco). Una sesión que
  // en su cola sólo ejecuta herramientas sigue siendo trabajo en curso.
  const live = sessions.filter((s) => s.prompts.length || s.lastAssistant || s.tools.length || s.injected.length);

  const projects = new Map();
  for (const s of live) if (!projects.has(s.cwd)) projects.set(s.cwd, projectContext(s.cwd));

  const g = globalState();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const out = [];

  out.push('# CONTEXTO COMPLETO — SESIONES CLAUDE CODE EN CURSO');
  out.push(`Generado ${now} · máquina ${hostname()} · AURAMAXING v${g.auramaxing || '?'}`);
  out.push(`${live.length} sesión(es) con actividad en los últimos ${opts.sinceMin} min · ${projects.size} proyecto(s)`);
  out.push('');

  if (!live.length) {
    out.push('No hay sesiones de Claude Code con actividad en la ventana pedida.');
    out.push('Amplía la ventana:  node ~/auramaxing/helpers/session-digest.mjs --since-min 720');
    return { text: out.join('\n'), sessions: [], projects: [] };
  }

  // Resumen de una línea por sesión — lo primero que lee el modelo.
  out.push('## RESUMEN');
  live.forEach((s, i) => {
    const p = projects.get(s.cwd);
    const branch = p.git?.branch || s.branch || 'sin repo';
    out.push(`${i + 1}. [${p.project}] ${s.title || '(sin título)'} — rama ${branch} · ${ago(s.mtime)} · ${s.turns} turnos${s.compacts ? ` · ${s.compacts} compactación(es)` : ''}`);
  });
  out.push('');

  if (g.nextAction || g.currentTask) {
    out.push('## ESTADO GLOBAL');
    if (g.currentTask) out.push(`Tarea actual: ${g.currentTask}`);
    if (g.nextAction) out.push(`next-action.txt: ${g.nextAction}`);
    out.push('');
  }

  live.forEach((s, i) => {
    const p = projects.get(s.cwd);
    out.push(`## SESIÓN ${i + 1}/${live.length} — ${p.project}`);
    out.push(`- cwd: ${s.cwd}`);
    out.push(`- session: ${s.sessionId.slice(0, 8)} · Claude Code v${s.version || '?'}${s.mode ? ` · modo ${s.mode}` : ''}`);
    out.push(`- última actividad: ${ago(s.mtime)} · contexto usado ≈ ${Math.round(s.ctxTokens / 1000)}k tokens`);
    if (s.workdirs.length) out.push(`- también trabajando en: ${s.workdirs.join(' · ')}`);

    if (p.git) {
      out.push(`- git: rama ${p.git.branch}${p.git.remote ? ` · origin ${p.git.remote}` : ''}`);
      if (p.git.commits) out.push(`- commits recientes:\n${p.git.commits.split('\n').map((l) => `    ${l}`).join('\n')}`);
      if (p.git.dirty) out.push(`- sin commitear:\n${p.git.dirty.split('\n').map((l) => `    ${l}`).join('\n')}`);
      if (p.git.diffstat) out.push(`- diffstat:\n${p.git.diffstat.split('\n').map((l) => `    ${l}`).join('\n')}`);
    } else {
      out.push('- git: (no es un repo)');
    }

    const led = openLedger(s.sessionId);
    if (led.length) out.push(`- ledger abierto:\n${led.map((l) => `    ${l}`).join('\n')}`);

    if (s.prompts.length) {
      out.push('');
      out.push('### Lo que pidió el usuario (más reciente primero)');
      s.prompts.forEach((pr, k) => out.push(`${k + 1}. ${clip(pr.text, 700)}`));
    }

    if (s.injected.length) {
      out.push('');
      out.push('### Inyecciones del sistema (NO son intención del usuario)');
      s.injected.forEach((pr) => out.push(`- ${clip(pr.text, 260)}`));
    }

    if (s.lastAssistant) {
      out.push('');
      out.push('### Último razonamiento/respuesta del agente');
      out.push(clip(s.lastAssistant, 1600));
    }

    if (s.tools.length) {
      out.push('');
      out.push('### Herramientas recientes');
      out.push(s.tools.map((t) => `- ${t}`).join('\n'));
    }
    if (s.files.length) {
      out.push('');
      out.push('### Archivos tocados');
      out.push(s.files.map((f) => `- ${f}`).join('\n'));
    }
    out.push('');
  });

  const seenDoc = new Set();
  for (const p of projects.values()) {
    if (!p.doc || seenDoc.has(p.cwd)) continue;
    seenDoc.add(p.cwd);
    out.push(`## DOCUMENTO RECTOR — ${p.project}/${p.doc.name}`);
    out.push(p.doc.body);
    out.push('');
  }

  if (opts.ask) out.push(ASK);

  let text = scrubSecrets(out.join('\n'));
  if (text.length > opts.maxChars) {
    // Recorta por el medio: la cabecera (resumen) y el contrato final son lo
    // que no puede perderse.
    const head = Math.floor(opts.maxChars * 0.72);
    const tailN = opts.maxChars - head - 60;
    text = `${text.slice(0, head)}\n\n…[digest recortado a ${opts.maxChars} chars]…\n\n${text.slice(-tailN)}`;
  }

  return {
    text,
    sessions: live.map((s) => ({
      sessionId: s.sessionId, cwd: s.cwd, project: basename(s.cwd),
      title: s.title, branch: projects.get(s.cwd)?.git?.branch || s.branch, turns: s.turns,
      lastActivity: new Date(s.mtime).toISOString(), ctxTokens: s.ctxTokens,
      lastPrompt: clip(s.prompts[0]?.text || '', 200),
    })),
    projects: [...projects.keys()],
  };
}

export default buildDigest;

// ── CLI ───────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('session-digest.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const num = (flag, def) => {
    const i = argv.indexOf(flag);
    if (i === -1) return def;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  const res = buildDigest({
    sinceMin: num('--since-min', DEFAULTS.sinceMin),
    prompts: num('--prompts', DEFAULTS.prompts),
    maxChars: num('--max', DEFAULTS.maxChars),
    ask: !argv.includes('--no-ask'),
  });
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ sessions: res.sessions, projects: res.projects, chars: res.text.length }, null, 2) + '\n');
  } else {
    process.stdout.write(res.text + '\n');
  }
}
