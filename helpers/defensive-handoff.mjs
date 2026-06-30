#!/usr/bin/env node
/**
 * AURAMAXING Defensive Handoff (Stop hook) — the fail-safe layer.
 *
 * Problem it solves: the context-threshold-monitor only samples context % BETWEEN turns,
 * so a single huge turn can jump 40%→70% and a /clear loses progress before any handoff fires.
 *
 * This runs on EVERY session Stop and ALWAYS refreshes ~/.auramaxing/pending-handoff.json with
 * the essentials (last prompt, git, cwd, checkpoint-doc pointer, next-action, recent memory) —
 * so after ANY /clear, session-start.mjs restores state. Non-blocking, best-effort, never throws.
 *
 * It does NOT clobber a richer threshold-triggered handoff written <10 min ago (that one has the
 * real last-prompt); otherwise it writes/refreshes. Idempotent + safe.
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, basename } from 'path';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const HANDOFF = join(AUR, 'pending-handoff.json');
const MEMORY_DIR = join(HOME, '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), 'memory');

function gitState(cwd) {
  try {
    const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1500 }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    const lastCommit = execSync('git log -1 --oneline 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    return { branch, lastCommit, dirtyFiles: status ? status.split('\n').filter(Boolean).slice(0, 20) : [] };
  } catch { return null; }
}

function findCheckpointDoc(cwd) {
  const cands = [
    join(cwd, 'docs', 'REFACTOR-CHECKPOINT.md'), join(cwd, 'docs', 'CHECKPOINT.md'),
    join(cwd, 'CHECKPOINT.md'), join(AUR, 'checkpoint.md'),
  ];
  let best = null, bestM = 0;
  for (const p of cands) { try { if (existsSync(p)) { const m = statSync(p).mtimeMs; if (m > bestM) { bestM = m; best = p; } } } catch {} }
  return best && (Date.now() - bestM < 24 * 3600 * 1000) ? best : null;
}

function readNextAction() {
  try { const na = join(AUR, 'next-action.txt'); if (existsSync(na)) return readFileSync(na, 'utf8').trim(); } catch {}
  return null;
}

function recentMemory() {
  try {
    const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => ({ f, m: statSync(join(MEMORY_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 3);
    return files.map(x => `- ${x.f.replace('.md', '')}`).join('\n');
  } catch { return ''; }
}

async function main() {
  try {
    mkdirSync(AUR, { recursive: true });

    // Don't clobber a fresh, richer threshold-handoff (written <10 min ago WITH a real lastPrompt).
    if (existsSync(HANDOFF)) {
      try {
        const cur = JSON.parse(readFileSync(HANDOFF, 'utf8'));
        const age = Date.now() - statSync(HANDOFF).mtimeMs;
        if (age < 600000 && cur.lastPrompt) return; // a real handoff already exists; keep it
      } catch {}
    }

    // Capture last prompt from Stop-hook stdin if present (best-effort).
    let lastPrompt = '';
    try {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const raw = Buffer.concat(chunks).toString();
      if (raw) { try { const p = JSON.parse(raw); lastPrompt = p.prompt || p.user_prompt || p.last_message || ''; } catch {} }
    } catch {}

    const cwd = process.cwd();
    const handoff = {
      timestamp: new Date().toISOString(),
      source: 'defensive-stop',          // marks this as the safety-net handoff
      contextUsedPct: null,
      cwd,
      lastPrompt: lastPrompt.slice(0, 2000),
      git: gitState(cwd),
      checkpointDoc: findCheckpointDoc(cwd),
      nextAction: readNextAction(),
      recentDecisions: recentMemory(),
    };
    writeFileSync(HANDOFF, JSON.stringify(handoff, null, 2));
  } catch { /* never throw — non-blocking */ }
  process.exit(0);
}
main().catch(() => process.exit(0));
