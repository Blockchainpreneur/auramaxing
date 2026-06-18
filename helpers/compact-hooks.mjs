#!/usr/bin/env node
/** Compact Hooks — PreCompact + PostCompact in one file.
 * PreCompact: builds SDR from memory/learnings/git, writes sdr-active.md, spawns NLM.
 * PostCompact: emits SDR as [MAXXING-SDR] block for context injection.
 * Always exits 0. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir(), AUR = join(HOME, '.auramaxing');
const MEMORY_DIR = join(AUR, 'memory'), LEARNINGS_DIR = join(AUR, 'learnings');
const SDR_PATH = join(AUR, 'sdr-active.md');
const NEXT_ACTION = join(AUR, 'next-action.txt');
const PREDICTION = join(AUR, 'prompt-cache', 'session-prediction.txt');
const HANDOFF = join(AUR, 'pending-handoff.json');
const LINEAGE = join(AUR, 'ledger-lineage.json'); // L6 — links pre-compact session → post-compact session

// Pull the important state staged by the threshold monitor + intent-predictor so the
// post-compact context can AUTO-RESUME the big task with zero user action.
function readSafe(p) { try { return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''; } catch { return ''; } }
function buildResumeBlock() {
  const nextAction = readSafe(NEXT_ACTION);
  const predicted = readSafe(PREDICTION);
  let handoff = {};
  try { handoff = JSON.parse(readSafe(HANDOFF) || '{}'); } catch {}
  const lines = ['', '## FIRST NEXT ACTION (auto-resume — do this immediately, do NOT ask the user)',
    nextAction || handoff.lastPrompt || '(continue the in-flight task from the data above)'];
  if (predicted) lines.push('', '## ANTICIPATED NEXT TASK', predicted);
  if (handoff.prd?.path) lines.push('', `## PRD POINTER`, `${handoff.prd.path}`);
  if (handoff.git) lines.push('', '## GIT STATE', `${handoff.git.branch || '?'} @ ${handoff.git.lastCommit || '?'}`);
  lines.push('', '## AUTO-RESUME DIRECTIVE',
    'Context was refreshed automatically (auto-compact). Resume the FIRST NEXT ACTION above right now, autonomously. Do NOT ask the user what to do, do NOT re-explain, do NOT wait. If a big task was anticipated, begin it with the context above.');
  return lines.join('\n');
}

function findNlm() {
  for (const bin of ['notebooklm', 'notebooklm-py']) {
    try {
      const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) return p;
    } catch {}
  }
  try {
    const py = execSync('which python3.12 python3 2>/dev/null | head -1', {
      encoding: 'utf8', timeout: 1000, shell: '/bin/bash',
    }).trim();
    if (py) {
      execSync(`${py} -c "import notebooklm" 2>/dev/null`, { timeout: 2000 });
      return `${py} -m notebooklm`;
    }
  } catch {}
  return null;
}
const NLM_BIN = findNlm();
const timeout = setTimeout(() => process.exit(0), 2000);

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString().trim() || '{}');
}

function recentFiles(dir, ext, count) {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith(ext) && !f.startsWith('_'))
      .map(f => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime).slice(0, count)
      .map(f => ({ name: f.name, data: readFileSync(join(dir, f.name), 'utf8') }));
  } catch { return []; }
}

function gitDiffStat() {
  try {
    return execSync('git diff --stat HEAD~5 HEAD 2>/dev/null || git diff --stat 2>/dev/null',
      { encoding: 'utf8', timeout: 1500, cwd: process.cwd() }).trim() || '(no changes)';
  } catch { return '(unavailable)'; }
}

function extract(entries, field) {
  return entries.reduce((acc, e) => {
    try { const o = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (o[field]) acc.push(o[field]); } catch {}
    return acc;
  }, []);
}

function buildSDR(mem, learnings, diff, model) {
  const tasks = extract(mem, 'label'), sums = extract(mem, 'summary'), cont = extract(mem, 'content');
  const learns = [];
  for (const l of learnings) {
    try {
      for (const line of l.data.split('\n').filter(Boolean).slice(-3)) {
        const o = JSON.parse(line); learns.push(o.pattern || o.context || o.message || '');
      }
    } catch { learns.push(l.data.slice(0, 200)); }
  }
  const fmt = (arr, n = 5, max = 200) => arr.filter(Boolean).slice(0, n).map(s => `- ${s.slice(0, max)}`).join('\n') || '(none)';
  return `---
generated: ${new Date().toISOString()}
trigger: compact
model: ${model || 'unknown'}
---
## Session Data Record (Post-Compact)
### What We Were Working On
${fmt(tasks)}
### Decisions Made
${fmt(cont)}
### Files Modified
\`\`\`
${diff}
\`\`\`
### Current Priorities
${fmt(sums, 3)}
### Learned Patterns
${fmt(learns, 5, 150)}
### Resume Instructions
Continue from where we left off. The above context was extracted before context compaction.
Read any files listed above before making changes.
`;
}

async function preCompact(input) {
  mkdirSync(AUR, { recursive: true });
  // L6 — stamp the PRE-compact session so PostCompact can migrate its OPEN ledger to the new session.
  try { if (input && input.session_id) writeFileSync(LINEAGE, JSON.stringify({ from: input.session_id, ts: Math.floor(Date.now() / 1000) })); } catch {}
  const mem = recentFiles(MEMORY_DIR, '.json', 5), learns = recentFiles(LEARNINGS_DIR, '.jsonl', 3);
  const model = input.model || process.env.CLAUDE_MODEL || '';
  writeFileSync(SDR_PATH, buildSDR(mem, learns, gitDiffStat(), model) + buildResumeBlock());
  try {
    if (!NLM_BIN) return;
    // SECURITY: read the SDR in Node and pass it as a STRUCTURED argv arg — never via
    // `bash -c "...$(cat '${SDR_PATH}')..."`. The SDR is built from session MEMORY
    // (prior prompts + repo/web/CDP content folded in), which is attacker-influenceable;
    // a `$(...)`/backtick in that content would EXECUTE in the shell at compaction time.
    // No shell here → no command substitution. Split NLM_BIN to keep `python3 -m notebooklm`.
    const sdrText = readFileSync(SDR_PATH, 'utf8').slice(0, 6000);
    const parts = String(NLM_BIN).split(/\s+/).filter(Boolean);
    const c = spawn(parts[0], [...parts.slice(1), 'ask', `Summarize this SDR in 3 sentences: ${sdrText}`], {
      detached: true, stdio: 'ignore',
    });
    c.unref();
  } catch {}
}

function postCompact(input) {
  // L6 — migrate the predecessor session's OPEN ledger onto the new (post-compact) session id, so the
  // completeness/greatness gates survive the handoff instead of silently fail-opening on a fresh id.
  try {
    const to = input && input.session_id;
    let lin = {}; try { lin = JSON.parse(readSafe(LINEAGE) || '{}'); } catch {}
    if (to && lin.from && lin.from !== to && (Math.floor(Date.now() / 1000) - (lin.ts || 0)) < 24 * 3600) {
      const ledgerCli = join(HOME, '.claude', 'helpers', 'ledger.mjs');
      if (existsSync(ledgerCli)) { try { execSync(`node "${ledgerCli}" migrate "${lin.from}" "${to}"`, { timeout: 1500 }); } catch {} }
    }
  } catch {}
  try {
    if (existsSync(SDR_PATH)) {
      console.log('[MAXXING-SDR]');
      console.log('⚡ AUTO-RESUMED AFTER CONTEXT REFRESH ⚡ — context was compacted automatically (no user action). Continue the FIRST NEXT ACTION below autonomously; do NOT ask the user, do NOT re-explain.');
      console.log(readFileSync(SDR_PATH, 'utf8'));
      console.log('[/MAXXING-SDR]');
    }
  } catch {}
}

async function main() {
  try {
    const input = await readStdin();
    const ht = (input.hook_type || input.hookType || input.type || '').toLowerCase();
    if (ht.includes('post')) postCompact(input); else await preCompact(input);
  } catch {}
  clearTimeout(timeout);
  process.exit(0);
}
main().catch(() => process.exit(0));
