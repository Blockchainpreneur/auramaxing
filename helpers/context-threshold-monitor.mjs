#!/usr/bin/env node
/**
 * Context Threshold Monitor — AURAMAXING auto-clear staging (45% system)
 *
 * The ACTUAL clear is native auto-compact, forced early via settings.json
 * `autoCompactWindow: 450000` (~45% of Fable's 1M window). This monitor fires
 * BEFORE that (35% hard / 28% soft) so the handoff bundle is always staged
 * before compaction, and PreCompact/PostCompact (compact-hooks.mjs) carry it
 * across. Manual /clear or /compact is NEVER required or suggested.
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
// Fire-once flag for the 40% handoff. Defaults to a ppid path, but main() re-keys it to the real
// session_id when available (audit 2026-06-17): ppid is NOT a stable session identity — the hook's
// parent process can differ or recur across a session's invocations, so a ppid key could double-fire
// or miss the handoff. session_id is the correct per-session key; ppid stays as the fallback.
let FLAG_PATH = `/tmp/auramaxing-handoff-${process.ppid}.flag`;
const THRESHOLD_USED_PCT = Number(process.env.AURA_CTX_THRESHOLD_PCT || 55);
const SOFT_THRESHOLD_PCT = Number(process.env.AURA_CTX_SOFT_THRESHOLD_PCT || 45);

// Model→window map for human-readable token counts in advisories.
// Calibration itself is runtime-driven (statusline reads
// context_window.used_percentage which Claude Code computes against
// the active model's actual window), so this map is informational only.
// Source: https://platform.claude.com/docs/en/docs/about-claude/models
const MODEL_WINDOWS = {
  'claude-fable-5': 1_000_000,
  'claude-mythos-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
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

// Fresh agent-written checkpoint doc → the handoff points at a real resume plan, not just prose.
function findCheckpointDoc(cwd) {
  const cands = [
    join(cwd, 'docs', 'REFACTOR-CHECKPOINT.md'), join(cwd, 'docs', 'CHECKPOINT.md'),
    join(cwd, 'CHECKPOINT.md'), join(AUR, 'checkpoint.md'),
  ];
  let best = null, bestM = 0;
  for (const p of cands) { try { if (existsSync(p)) { const m = statSync(p).mtimeMs; if (m > bestM) { bestM = m; best = p; } } } catch {} }
  return best && (Date.now() - bestM < 6 * 3600 * 1000) ? best : null; // fresh-only (6h)
}

// Returns one of: 'queued' | 'no-cli' | 'no-notebook' | 'auth-expired' | 'spawn-failed'
function delegateToNLM(handoff) {
  const NLM_BIN = findNlm();
  if (!NLM_BIN) return { status: 'no-cli', detail: 'NotebookLM CLI not found' };
  if (!existsSync(NB_ID_FILE)) return { status: 'no-notebook', detail: 'No notebook ID configured' };

  // Pre-flight auth check — fast (~2s timeout). If auth is dead, don't lie about queueing.
  try {
    const authOut = execSync(`${NLM_BIN} list 2>&1 | head -3`, {
      encoding: 'utf8', timeout: 4000, shell: '/bin/bash',
    });
    if (/Authentication expired|Redirected to|Run.*notebooklm login/i.test(authOut)) {
      return { status: 'auth-expired', detail: 'Run: notebooklm login' };
    }
  } catch { /* if check itself fails, optimistically continue — better than blocking */ }

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
    return { status: 'queued', detail: tmpFile };
  } catch (e) { return { status: 'spawn-failed', detail: (e.message || '').slice(0, 80) }; }
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

  // Re-key the fire-once flag to the SESSION (sanitized) when we have it; ppid is only a fallback.
  if (input.session_id) FLAG_PATH = `/tmp/auramaxing-handoff-${String(input.session_id).replace(/[^\w.-]/g, '')}.flag`;

  // Context % detection — UserPromptSubmit does NOT receive context_window in stdin,
  // so statusline.sh persists the % to ~/.auramaxing/last-ctx.json on every update.
  const cw = input.context_window;
  let usedPct = null;
  if (cw) {
    if (typeof cw.used_percentage === 'number') usedPct = cw.used_percentage;
    else if (typeof cw.remaining_percentage === 'number') usedPct = 100 - cw.remaining_percentage;
  }
  // OPTION 2 — statusline-agnostic: read % from multiple sources, wide TTL, never miss on stale data.
  if (usedPct === null) {
    const sources = [
      join(AUR, 'last-ctx.json'),                        // statusline writer (primary)
      join(AUR, 'prompt-cache', 'last-ctx.json'),        // alt location
    ];
    let best = null, bestAge = Infinity;
    for (const f of sources) {
      try {
        if (!existsSync(f)) continue;
        const age = Date.now() - statSync(f).mtimeMs;
        if (age < 600000 && age < bestAge) {             // 600s TTL (was 120s) — survives slow turns
          const data = JSON.parse(readFileSync(f, 'utf8'));
          const p = typeof data.pct === 'number' ? data.pct
                  : typeof data.used_percentage === 'number' ? data.used_percentage : null;
          if (p !== null) { best = p; bestAge = age; }
        }
      } catch {}
    }
    usedPct = best;
  }
  // If % is STILL unknown, don't silently bail — fall through with a conservative estimate so the
  // defensive Stop-hook handoff (defensive-handoff.mjs) is the real safety net, but advisory still fires.
  if (usedPct === null) {
    // unknown context → emit a soft advisory once, then exit (don't trigger a full handoff on a guess)
    if (!existsSync(FLAG_PATH)) {
      process.stdout.write(`[CONTEXT-ADVISORY]\nℹ️ Context % unavailable (statusline stale) — no action needed: native auto-compact (autoCompactWindow) clears automatically and the defensive checkpoint runs on session end. Never ask the user to /clear.\n[/CONTEXT-ADVISORY]\n`);
    }
    process.exit(0);
  }

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
      `ℹ️ Context at ${Math.round(usedPct)}% (${fmtTokenSummary(usedPct, detectedModel)}) — approaching the ${THRESHOLD_USED_PCT}% staging point (native auto-clear fires ~45%).`,
      'Start checkpointing durable state (commit progress, update next-action.txt) — the clear is automatic, never manual.',
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

  const checkpointDoc = findCheckpointDoc(cwd);
  let nextAction = null;
  try { const na = join(AUR, 'next-action.txt'); if (existsSync(na)) nextAction = readFileSync(na, 'utf8').trim(); } catch {}
  const handoff = {
    timestamp: new Date().toISOString(),
    contextUsedPct: Math.round(usedPct),
    model, cwd,
    lastPrompt: lastPrompt.slice(0, 2000),
    prd: findPRD(cwd),
    git: gitState(cwd),
    checkpointDoc,          // pointer to the agent's resume plan
    nextAction,             // one-line first-next-action (from next-action.txt)
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

  const nlmResult = delegateToNLM(handoff);

  const prdNote = handoff.prd ? `PRD detected at \`${handoff.prd.path}\` — snapshotted.` : 'No PRD file detected (PRD.md, SPEC.md, etc.).';
  let nlmNote;
  switch (nlmResult.status) {
    case 'queued':        nlmNote = 'Handoff delegated to NotebookLM (queued).'; break;
    case 'auth-expired':  nlmNote = '⚠️ NotebookLM auth EXPIRED — handoff saved LOCALLY ONLY. Run `notebooklm login` to restore cross-session NLM continuity.'; break;
    case 'no-cli':        nlmNote = '⚠️ NotebookLM CLI not installed — local-only handoff.'; break;
    case 'no-notebook':   nlmNote = '⚠️ No NLM notebook configured (~/.auramaxing/nlm-notebook-id missing) — local-only handoff.'; break;
    case 'spawn-failed':  nlmNote = `⚠️ NLM upload spawn failed: ${nlmResult.detail} — local-only handoff.`; break;
    default:              nlmNote = `⚠️ NLM status unknown: ${nlmResult.status}`;
  }

  process.stdout.write([
    '[CONTEXT-AUTO-REFRESH]',
    `Context at ${handoff.contextUsedPct}% (${fmtTokenSummary(handoff.contextUsedPct, detectedModel)}) — AURAMAXING ${THRESHOLD_USED_PCT}% STAGING POINT reached. Native auto-clear (auto-compact @ autoCompactWindow ≈45%) will fire automatically soon; everything below is staged so that clear loses NOTHING and auto-resumes.`, '',
    `✅ Handoff bundle staged → ~/.auramaxing/pending-handoff.json`,
    `✅ SDR staged → ~/.auramaxing/sdr-active.md`,
    `✅ ${prdNote}`,
    `✅ ${nlmNote}`, '',
    'SILENT AUTO-CHECKPOINT — do these now WITHOUT interrupting the user or asking anything, then keep working:',
    `  1. CHECKPOINT in-flight work: commit/stash dirty files${handoff.git?.dirtyFiles?.length ? ` (${handoff.git.dirtyFiles.length} uncommitted)` : ''}, or note exactly where they stand.`,
    `  2. WRITE/REFRESH a checkpoint doc with a self-contained resume plan + explicit "FIRST NEXT ACTION"${checkpointDoc ? ` (found ${checkpointDoc} — refresh it)` : ' (none found — create docs/CHECKPOINT.md)'}.`,
    '  3. UPDATE persistent memory (~/.claude/projects/.../memory/) with this session\'s decisions/learnings.',
    '  4. BACKFILL the next action: write your one-line first-next-action to ~/.auramaxing/next-action.txt.',
    'THE CLEAR IS AUTOMATIC — settings.json `autoCompactWindow: 450000` forces native auto-compact at ~45% of the window (Fable 1M). NEVER tell the user to /clear or /compact. Your only job is the 4 checkpoint steps above, done SILENTLY and NOW, so that when the automatic compaction fires (any moment after this directive) the staged bundle + PreCompact SDR carry 100% of the needed context across, and PostCompact AUTO-RESUMES the task. Finish the current sub-task and keep working normally.',
    'The handoff preserves: last prompt, PRD, git state, edited files, checkpoint-doc pointer, next-action, anticipated next task, recent decisions.',
    '[/CONTEXT-AUTO-REFRESH]',
  ].join('\n') + '\n');

  process.exit(0);
}

main().catch(() => process.exit(0));
