#!/usr/bin/env node
/**
 * Context Threshold Monitor — AURAMAXING 40% auto-handoff
 *
 * Canonical source (synced to ~/.claude/helpers/ by session-start.mjs).
 * See that copy for full documentation.
 */
import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { findNlm } from './find-bin.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const MEMORY_DIR = join(AUR, 'memory');
const LEARNINGS_DIR = join(AUR, 'learnings');
const HANDOFF_PATH = join(AUR, 'pending-handoff.json');
const SDR_PATH = join(AUR, 'sdr-active.md');
const NB_ID_FILE = join(AUR, 'nlm-notebook-id');
const FLAG_PATH = `/tmp/auramaxing-handoff-${process.ppid}.flag`;
const THRESHOLD_USED_PCT = Number(process.env.AURA_CTX_THRESHOLD_PCT || 35);
const SOFT_THRESHOLD_PCT = Number(process.env.AURA_CTX_SOFT_THRESHOLD_PCT || 28);

// Model→window map for human-readable token counts in advisories.
// Calibration itself is runtime-driven (statusline reads
// context_window.used_percentage which Claude Code computes against
// the active model's actual window), so this map is informational only.
// Source: https://platform.claude.com/docs/en/docs/about-claude/models
const MODEL_WINDOWS = {
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-5-20251101': 200_000,
  'claude-opus-4-1-20250805': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-haiku-4-5': 200_000,
};
function fmtTokenSummary(pct, model) {
  const win = MODEL_WINDOWS[model] || 200_000;
  const used = Math.round((pct / 100) * win);
  const remain = win - used;
  const k = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
  return `~${k(used)} of ${k(win)} used · ${k(remain)} remaining`;
}

mkdirSync(AUR, { recursive: true });

function findPRD(cwd) {
  const candidates = [
    'PRD.md', 'prd.md', 'PRD.txt',
    'docs/PRD.md', 'docs/prd.md',
    'SPEC.md', 'spec.md', 'docs/SPEC.md',
    'PRODUCT.md', 'REQUIREMENTS.md',
    '.auramaxing/PRD.md',
  ];
  for (const c of candidates) {
    const p = join(cwd, c);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        if (content.trim().length > 50) return { path: p, content };
      } catch {}
    }
  }
  return null;
}

function readRecentEntries(dir, ext, count) {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith(ext) && !f.startsWith('_'))
      .map(f => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, count)
      .map(f => {
        try { return { name: f.name, content: readFileSync(f.path, 'utf8').slice(0, 800) }; }
        catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

function gitState(cwd) {
  try {
    const status = execSync('git status --porcelain 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1500 }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    const lastCommit = execSync('git log -1 --oneline 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    return { branch, lastCommit, dirtyFiles: status.split('\n').filter(Boolean).slice(0, 20) };
  } catch { return null; }
}

function delegateToNLM(handoff) {
  const NLM_BIN = findNlm();
  if (!NLM_BIN) return false;
  if (!existsSync(NB_ID_FILE)) return false;

  const nbId = readFileSync(NB_ID_FILE, 'utf8').trim().slice(0, 8);
  const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmpFile = join(AUR, 'nlm-cache', `handoff-${date}.md`);
  mkdirSync(join(AUR, 'nlm-cache'), { recursive: true });

  const doc = [
    `# AURAMAXING Session Handoff — ${date}`, '',
    `**Context used:** ${handoff.contextUsedPct}%`,
    `**Model:** ${handoff.model}`,
    `**CWD:** ${handoff.cwd}`,
    `**Git:** ${handoff.git?.branch || '?'} @ ${handoff.git?.lastCommit || '?'}`, '',
    '## Last User Prompt', handoff.lastPrompt || '(none captured)', '',
    '## Current Task', handoff.currentTask || '(continue from last prompt)', '',
    '## PRD Snapshot',
    handoff.prd ? `Source: \`${handoff.prd.path}\`\n\n${handoff.prd.content.slice(0, 3000)}` : '(no PRD detected)', '',
    '## Recent Decisions', handoff.recentDecisions || '(none)', '',
    '## Files Modified',
    (handoff.git?.dirtyFiles || []).map(f => `- ${f}`).join('\n') || '(clean)', '',
    '## Resume Instructions',
    'On next session, read this handoff in full, then continue the task from "Last User Prompt".',
  ].join('\n');

  writeFileSync(tmpFile, doc);

  const cmd = `${NLM_BIN} use ${nbId} >/dev/null 2>&1 && ${NLM_BIN} source add "${tmpFile}" --title "Handoff ${date}" >/dev/null 2>&1`;
  try {
    const child = spawn('/bin/bash', ['-c', cmd], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch { return false; }
}

async function main() {
  let input = {};
  try {
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString().trim();
      if (raw) input = JSON.parse(raw);
    }
  } catch { process.exit(0); }

  // Context % detection — UserPromptSubmit does NOT receive context_window in stdin,
  // so statusline.sh persists the % to ~/.auramaxing/last-ctx.json on every update.
  const cw = input.context_window;
  let usedPct = null;
  if (cw) {
    if (typeof cw.used_percentage === 'number') usedPct = cw.used_percentage;
    else if (typeof cw.remaining_percentage === 'number') usedPct = 100 - cw.remaining_percentage;
  }
  if (usedPct === null) {
    try {
      const ctxFile = join(AUR, 'last-ctx.json');
      if (existsSync(ctxFile)) {
        const age = Date.now() - statSync(ctxFile).mtimeMs;
        if (age < 120000) {
          const data = JSON.parse(readFileSync(ctxFile, 'utf8'));
          if (typeof data.pct === 'number') usedPct = data.pct;
        }
      }
    } catch {}
  }
  if (usedPct === null) process.exit(0);

  // Detect model for token-aware messaging (informational; calibration is runtime-driven)
  let detectedModel = (cw && cw.model) || input.model;
  if (!detectedModel) {
    try {
      const ctxFile = join(AUR, 'last-ctx.json');
      if (existsSync(ctxFile)) {
        const data = JSON.parse(readFileSync(ctxFile, 'utf8'));
        detectedModel = data.model;
      }
    } catch {}
  }

  // Soft threshold (28%): emit advisory only, do not trigger handoff
  if (usedPct >= SOFT_THRESHOLD_PCT && usedPct < THRESHOLD_USED_PCT) {
    process.stdout.write([
      '[CONTEXT-ADVISORY]',
      `ℹ️ Context at ${Math.round(usedPct)}% (${fmtTokenSummary(usedPct, detectedModel)}) — approaching ${THRESHOLD_USED_PCT}% auto-handoff ceiling.`,
      'Wrap current sub-task or run /compact proactively to preserve headroom.',
      '[/CONTEXT-ADVISORY]',
    ].join('\n') + '\n');
    process.exit(0);
  }
  if (usedPct < THRESHOLD_USED_PCT) process.exit(0);

  if (existsSync(FLAG_PATH)) process.exit(0);
  writeFileSync(FLAG_PATH, new Date().toISOString());

  const model = cw.model || input.model || 'unknown';
  const cwd = input.cwd || process.cwd();
  const lastPrompt = input.prompt || input.user_prompt || input.message || '';

  const handoff = {
    timestamp: new Date().toISOString(),
    contextUsedPct: Math.round(usedPct),
    model, cwd,
    lastPrompt: lastPrompt.slice(0, 2000),
    prd: findPRD(cwd),
    git: gitState(cwd),
    recentDecisions: readRecentEntries(MEMORY_DIR, '.json', 3)
      .map(e => `- ${e.name}: ${(e.content || '').slice(0, 200)}`).join('\n'),
    recentLearnings: readRecentEntries(LEARNINGS_DIR, '.json', 3)
      .map(e => `- ${e.name}: ${(e.content || '').slice(0, 200)}`).join('\n'),
  };

  writeFileSync(HANDOFF_PATH, JSON.stringify(handoff, null, 2));

  writeFileSync(SDR_PATH, [
    `---`, `generated: ${handoff.timestamp}`,
    `context_used: ${handoff.contextUsedPct}%`, `model: ${handoff.model}`,
    `cwd: ${handoff.cwd}`, `---`, '',
    `## Last User Prompt`, handoff.lastPrompt || '(none)', '',
    `## PRD Snapshot`,
    handoff.prd ? `Source: ${handoff.prd.path}\n\n${handoff.prd.content.slice(0, 2000)}` : '(no PRD detected)', '',
    `## Git State`,
    handoff.git ? `${handoff.git.branch} @ ${handoff.git.lastCommit}\n${(handoff.git.dirtyFiles || []).map(f => `- ${f}`).join('\n')}` : '(no git)', '',
    `## Recent Decisions`, handoff.recentDecisions || '(none)',
  ].join('\n'));

  const nlmQueued = delegateToNLM(handoff);

  const prdNote = handoff.prd ? `PRD detected at \`${handoff.prd.path}\` — snapshotted.` : 'No PRD file detected (PRD.md, SPEC.md, etc.).';
  const nlmNote = nlmQueued ? 'Handoff delegated to NotebookLM (queued).' : 'NotebookLM unavailable — local-only handoff.';

  process.stdout.write([
    '[CONTEXT-AUTO-REFRESH]',
    `⚠️ Context at ${handoff.contextUsedPct}% (${fmtTokenSummary(handoff.contextUsedPct, detectedModel)}) — AURAMAXING ${THRESHOLD_USED_PCT}% threshold triggered.`, '',
    `✅ Saved handoff bundle → ~/.auramaxing/pending-handoff.json`,
    `✅ Saved SDR → ~/.auramaxing/sdr-active.md`,
    `✅ ${prdNote}`,
    `✅ ${nlmNote}`, '',
    'ACTION REQUIRED — choose one:',
    '  A) /clear  (RECOMMENDED) — fully wipe context; next session will auto-restore from handoff + NLM',
    '  B) /compact            — summarize in-place; keeps current session alive', '',
    'The handoff preserves: last prompt, PRD snapshot, git state, recent decisions.',
    'Next session\'s SessionStart hook will detect the handoff and inject the briefing automatically.',
    '[/CONTEXT-AUTO-REFRESH]',
  ].join('\n') + '\n');

  process.exit(0);
}

main().catch(() => process.exit(0));
