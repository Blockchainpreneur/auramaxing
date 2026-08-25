#!/usr/bin/env node
/**
 * council-brief — builds the project-context brief + the "next steps" demand
 * that gets sent to ChatGPT when 2+ Claude Code terminals are working.
 *
 * Kept OUT of the UserPromptSubmit hook path on purpose: git/fs probing runs in
 * the detached background process, so the hook itself stays ~50ms.
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const AURA = join(HOME, '.auramaxing');
const MAX_BRIEF = 9000;

function sh(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return fallback; }
}

function clip(s, n) {
  if (!s) return '';
  s = String(s).trim();
  return s.length > n ? s.slice(0, n) + ' …[cortado]' : s;
}

/** First existing steering doc in the project, lightly trimmed. */
function steeringDoc(cwd) {
  const names = ['PRD.md', 'STATUS.md', 'SPEC.md', 'PLAN.md', 'CLAUDE.md', 'ROADMAP.md', 'README.md'];
  for (const n of names) {
    const p = join(cwd, n);
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        const body = readFileSync(p, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*$/.test(l))
          .slice(0, 45)
          .join('\n');
        return { name: n, body: clip(body, 1400) };
      }
    } catch {}
  }
  return null;
}

function openLedgerItems(sessionId) {
  const paths = [];
  if (sessionId) paths.push(join(AURA, 'ledger', `${sessionId}.json`));
  paths.push(join(AURA, 'ledger.json'));
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, 'utf8'));
      const open = (j.items || []).filter((i) => !i.done);
      if (open.length) return open.map((i) => `#${i.id} ${clip(i.desc, 180)}`);
    } catch {}
  }
  return [];
}

function readIf(p, n) {
  try { return existsSync(p) ? clip(readFileSync(p, 'utf8'), n) : ''; } catch { return ''; }
}

/** Recently touched source files — what the fleet is actually moving right now. */
function recentFiles(cwd) {
  const out = sh(`git status --porcelain 2>/dev/null | head -18`, cwd);
  if (out) return out;
  return sh(`find . -maxdepth 3 -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.py' \\) -newermt '-2 hours' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -12`, cwd);
}

/**
 * The brief leaves the machine, so nothing secret may ride along in a diff line,
 * a .env excerpt or a steering doc. Patterns mirror helpers/pii-redactor.mjs.
 */
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-«REDACTED»'],
  [/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, 'gh«REDACTED»'],
  [/\bAKIA[0-9A-Z]{12,}/g, 'AKIA«REDACTED»'],  // {12,}: also catches truncated/pasted key ids
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox«REDACTED»'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, 'jwt«REDACTED»'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '«PRIVATE KEY REDACTED»'],
  [/\b(hooks\.slack\.com\/services)\/[A-Za-z0-9\/]+/g, '$1/«REDACTED»'],
  [/((?:API|SECRET|PRIVATE|ACCESS|AUTH|SERVICE_ROLE|ANON)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PWD)\s*[:=]\s*)['"]?[A-Za-z0-9_\-./+]{12,}/gi, '$1«REDACTED»'],
  [/\b[A-Za-z0-9._%+-]+:[^\s/@]{6,}@(?=[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, 'user:«REDACTED»@'],
];
export function scrubSecrets(text) {
  let out = String(text || '');
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function buildBrief(req) {
  const { cwd, prompt, sessionId, peers = [] } = req;
  const project = basename(cwd || HOME) || 'proyecto';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const isRepo = sh('git rev-parse --is-inside-work-tree', cwd) === 'true';
  const branch = isRepo ? sh('git rev-parse --abbrev-ref HEAD', cwd, '?') : '';
  const commits = isRepo ? sh('git log --oneline -6', cwd) : '';
  const dirty = isRepo ? clip(recentFiles(cwd), 900) : '';
  const diffstat = isRepo ? clip(sh('git diff --stat | tail -6', cwd), 400) : '';
  const doc = steeringDoc(cwd);
  const ledger = openLedgerItems(sessionId);
  const nextAction = readIf(join(AURA, 'next-action.txt'), 400);

  const peerLines = peers.length
    ? peers.map((p) => `- [${p.project}] ${p.state}: "${clip(p.prompt, 160)}"`).join('\n')
    : '- (sin datos de otras terminales)';

  const parts = [];
  parts.push(`# CONTEXTO REAL DE MI PROYECTO — enviado automáticamente desde Claude Code (AURAMAXING)`);
  parts.push(`Proyecto: **${project}**  ·  Ruta: \`${cwd}\`  ·  ${now}  ·  Terminales Claude trabajando en paralelo AHORA: **${peers.length + 1}**`);
  parts.push(`\n## 1. Lo que acabo de pedirle a la terminal (tarea viva)\n${clip(prompt, 1600) || '(sin prompt)'}`);
  if (branch) {
    parts.push(`\n## 2. Estado del repo\nRama: \`${branch}\`\nÚltimos commits:\n\`\`\`\n${clip(commits, 600)}\n\`\`\``);
    if (dirty) parts.push(`Cambios sin commitear / archivos calientes:\n\`\`\`\n${dirty}\n\`\`\``);
    if (diffstat) parts.push(`Diff stat:\n\`\`\`\n${diffstat}\n\`\`\``);
  }
  if (ledger.length) parts.push(`\n## 3. Trabajo abierto (ledger AURAMAXING)\n${ledger.map((l) => `- ${l}`).join('\n')}`);
  if (nextAction) parts.push(`\n## 4. Siguiente acción declarada del sistema\n${nextAction}`);
  parts.push(`\n## 5. Las otras terminales Claude que corren en paralelo\n${peerLines}`);
  if (doc) parts.push(`\n## 6. Documento rector del proyecto (${doc.name}, extracto)\n\`\`\`\n${doc.body}\n\`\`\``);

  parts.push(`
# LO QUE NECESITO DE TI — RESPONDE EXACTAMENTE ASÍ

Eres mi socio técnico-estratégico y ya tienes arriba el contexto real. No resumas el contexto, no lo elogies.

Dame los **3 próximos pasos concretos de máximo apalancamiento** para (a) ESCALAR y (b) PERFECCIONAR exactamente este trabajo.

REGLAS DURAS (si las rompes, la respuesta no me sirve):
1. **CERO generalidades.** Prohibido: "mejora la UX", "añade tests", "optimiza el rendimiento", "documenta", "monitorea", "considera escalar", "haz benchmarks". Si un consejo le sirve a cualquier otro proyecto, bórralo y sustitúyelo por uno que SOLO tenga sentido en ESTE repo, con ESTE estado.
2. Cada paso debe nombrar el **archivo, comando, endpoint, parámetro o métrica exactos** de mi contexto. Si no puedes nombrarlos, el paso no existe.
3. Cada paso lleva estas 6 líneas, en este orden:
   - **ACCIÓN:** qué hago, literal (ruta/comando/valor concreto).
   - **LÓGICA:** la cadena causal completa de por qué esto es lo óptimo AHORA (premisa → consecuencia → resultado). Sin adjetivos, sin apelar a "buenas prácticas".
   - **DESCARTADO:** la alternativa más tentadora que rechazas y el número/razón por la que pierde.
   - **ACEPTACIÓN:** el criterio medible y binario que prueba que quedó bien (test que pasa, número que sube/baja, output esperado).
   - **RIESGO:** el modo de fallo #1 y su mitigación exacta.
   - **APALANCAMIENTO:** impacto (1-10) × ejecutabilidad-autónoma (1-10) ÷ esfuerzo (1-10) = score, con los tres números.
4. Ordénalos por ese score, de mayor a menor.
5. No me hagas preguntas. Si te falta un dato, escribe "SUPUESTO: …" y sigue.
6. Cierra con una sola línea: **"SI SOLO PUEDO HACER UNA COSA HOY: …"**.
7. Cuando entre en modo voz contigo, arranca dándome esos 3 pasos en voz alta, en orden, sin repetir el contexto.`);

  let brief = scrubSecrets(parts.join('\n'));
  if (brief.length > MAX_BRIEF) brief = brief.slice(0, MAX_BRIEF) + '\n…[contexto truncado]';
  return brief;
}

export default buildBrief;
