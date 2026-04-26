#!/usr/bin/env node
/**
 * SessionStart — AURAMAXING welcome + update check + memory load
 *
 * 1. Shows welcome panel
 * 2. Checks for updates (blocking, like gstack)
 * 3. Loads session memory from ~/.auramaxing/memory/
 * 4. Outputs memory context to stdout so Claude reads it
 *
 * Always exits 0. Non-blocking on failure.
 */
import { execSync, spawn as spawnProc } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, copyFileSync, unlinkSync } from 'fs';

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const LEARNINGS_DIR = join(HOME, '.auramaxing', 'learnings');

/** Find Python 3 binary — works on macOS (Framework, Homebrew, pyenv) and Linux */
function findPython() {
  for (const bin of ['python3', 'python3.12', 'python']) {
    try {
      const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) return p;
    } catch {}
  }
  return 'python3'; // fallback — let PATH resolve it
}

try {
  const C = '\x1b[36m', Y = '\x1b[33m', B = '\x1b[1m', R = '\x1b[0m', D = '\x1b[2m';

  // ── Update check ──────────────────────────────────────────────
  let upgradeAvail = false;
  let localVer = '', remoteVer = '';
  try {
    const checkScript = join(HOME, 'auramaxing', 'scripts', 'update-check.sh');
    const result = execSync(`bash "${checkScript}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result.startsWith('UPGRADE_AVAILABLE')) {
      const parts = result.split(' ');
      localVer = parts[1] || '?';
      remoteVer = parts[2] || '?';
      upgradeAvail = true;
    }
  } catch (_) {}

  // ── Auto-sync helpers from ~/auramaxing to ~/.claude ───────────
  // Prevents the dual-file divergence problem forever
  try {
    const srcDir = join(HOME, 'auramaxing', 'helpers');
    const dstDir = join(HOME, '.claude', 'helpers');
    if (existsSync(srcDir) && existsSync(dstDir)) {
      const helpers = readdirSync(srcDir).filter(f => f.endsWith('.mjs'));
      for (const f of helpers) {
        const src = join(srcDir, f);
        const dst = join(dstDir, f);
        if (existsSync(dst)) {
          const srcStat = statSync(src);
          const dstStat = statSync(dst);
          if (srcStat.size !== dstStat.size || srcStat.mtimeMs > dstStat.mtimeMs) {
            copyFileSync(src, dst);
          }
        }
      }
    }
  } catch {}

  // ── Cleanup orphan event files from crashed sessions ──────────
  try {
    const eventFiles = readdirSync(join(HOME, '.auramaxing')).filter(f => f.startsWith('turn-events-') && f.endsWith('.jsonl'));
    for (const f of eventFiles) {
      const pid = parseInt(f.replace('turn-events-', '').replace('.jsonl', ''));
      if (pid && !isNaN(pid)) {
        try { process.kill(pid, 0); } catch { // process dead — orphan file
          try { unlinkSync(join(HOME, '.auramaxing', f)); } catch {}
        }
      }
    }
  } catch {}

  // ── NLM setup (BACKGROUND — never blocks session start) ────────
  // Auth refresh + notebook creation run in a detached script.
  // Session starts instantly. NLM is ready by the time the user types.
  // Logs to ~/.auramaxing/nlm-setup.log for debugging.
  try {
    const nlmSetup = join(HOME, 'auramaxing', 'helpers', 'nlm-session-setup.mjs');
    const projectName = process.cwd().split('/').pop();
    if (existsSync(nlmSetup)) {
      // Use execSync with shell backgrounding — the only pattern that reliably
      // survives process.exit(0) in Node.js
      const logFile = join(HOME, '.auramaxing', 'nlm-setup-stderr.log');
      try {
        execSync(
          `node "${nlmSetup}" "${projectName}" >> "${logFile}" 2>&1 &`,
          { shell: '/bin/bash', timeout: 2000, stdio: 'ignore' }
        );
      } catch {}
    }
  } catch {}

  // ── Pre-warm LightRAG model (background, non-blocking) ─────
  try {
    const lrCli = join(HOME, 'auramaxing', 'scripts', 'lightrag-cli.py');
    const pyBin = findPython();
    if (existsSync(lrCli) && pyBin) {
      const child = spawnProc(pyBin, [lrCli, 'status', '--workspace', join(HOME, '.auramaxing', 'lightrag-workspace')], {
        detached: true, stdio: 'ignore',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      child.unref();
    }
  } catch {}

  // ── Load memory ───────────────────────────────────────────────
  mkdirSync(MEMORY_DIR, { recursive: true });
  mkdirSync(LEARNINGS_DIR, { recursive: true });

  let memoryItems = [];
  let learningItems = [];

  // ── Fast-path: pre-computed briefing from pipeline (most token-efficient)
  const PROMPT_CACHE = join(HOME, '.auramaxing', 'prompt-cache');
  const briefingFile = join(PROMPT_CACHE, 'session-briefing.txt');
  const summaryFile = join(MEMORY_DIR, '_compressed-summary.json');
  let compressedBrief = '';

  // Priority 1: Pre-computed session briefing (from precompute-pipeline)
  try {
    if (existsSync(briefingFile)) {
      const age = Date.now() - statSync(briefingFile).mtimeMs;
      if (age < 86400000) { // 24hr TTL
        compressedBrief = readFileSync(briefingFile, 'utf8').trim();
      }
    }
  } catch {}

  // Priority 2: Legacy compressed summary from NLM
  try {
    if (!compressedBrief && existsSync(summaryFile)) {
      const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
      if (summary.content) compressedBrief = summary.content;
    }
  } catch {}

  // Priority 3: Raw entries (only if no compressed version exists)
  try {
    if (!compressedBrief && existsSync(MEMORY_DIR)) {
      const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().slice(-5);
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8'));
          memoryItems.push(data);
        } catch {}
      }
    }
  } catch {}

  // ── Learnings: prefer synthesized version ───────────────────────
  let synthesizedLearnings = '';
  const synthFile = join(PROMPT_CACHE, 'learnings-synthesis.txt');
  try {
    if (existsSync(synthFile)) {
      const age = Date.now() - statSync(synthFile).mtimeMs;
      if (age < 86400000) { // 24hr TTL
        synthesizedLearnings = readFileSync(synthFile, 'utf8').trim();
      }
    }
  } catch {}

  // Fallback: load raw learnings only if no synthesis
  try {
    if (!synthesizedLearnings && existsSync(LEARNINGS_DIR)) {
      const files = readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.json')).sort().slice(-10);
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(LEARNINGS_DIR, f), 'utf8'));
          learningItems.push(data);
        } catch {}
      }
    }
  } catch {}

  // ── Welcome panel ─────────────────────────────────────────────
  const memCount = memoryItems.length;
  const learnCount = learningItems.length;
  const lines = [
    `${C}╭─ ⚡ AURAMAXING ──────────────────────────────────────────╮${R}`,
    `${C}│${R}  Aura autopilot is active. Just say what you want.    ${C}│${R}`,
    `${C}│${R}                                                         ${C}│${R}`,
    `${C}│  🧭 Aura${R}        routes + enriches every request        ${C}│${R}`,
    `${C}│  🧠 Memory${R}        ${memCount} memories, ${learnCount} learnings loaded        ${C}│${R}`,
    `${C}│  🔒 Safety${R}        PII redactor + code quality gate       ${C}│${R}`,
    `${C}│  ⚡ CLI-first${R}     codex, gws, firecrawl, playwright     ${C}│${R}`,
    `${C}╰─────────────────────────────────────────────────────────╯${R}`,
  ];
  process.stderr.write(lines.join('\n') + '\n');

  // ── Upgrade banner ────────────────────────────────────────────
  if (upgradeAvail) {
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    process.stderr.write([
      '', `${Y}${B}  ┌─ AURAMAXING UPDATE AVAILABLE ${'─'.repeat(22)}┐${R}`,
      `${Y}  │${R}  You: ${C}${pad(localVer, 40)}${Y}│${R}`,
      `${Y}  │${R}  New: ${C}${B}${pad(remoteVer, 40)}${Y}│${R}`,
      `${Y}  │${R}  ${B}cd ~/auramaxing && git pull && bash install.sh${R}  ${Y}│${R}`,
      `${Y}${B}  └${'─'.repeat(50)}┘${R}`, '',
    ].join('\n') + '\n');
  }

  // ── 40% Auto-Handoff Restore ──────────────────────────────────
  // If previous session hit the 40% threshold and wrote a handoff, inject it.
  // This makes /clear truly seamless — the new session knows the last prompt,
  // the PRD snapshot, and git state from the prior session.
  let pendingHandoff = null;
  try {
    const handoffPath = join(HOME, '.auramaxing', 'pending-handoff.json');
    if (existsSync(handoffPath)) {
      const age = Date.now() - statSync(handoffPath).mtimeMs;
      if (age < 24 * 3600 * 1000) { // only restore if < 24h old
        pendingHandoff = JSON.parse(readFileSync(handoffPath, 'utf8'));
      } else {
        // Stale — rename to archive
        try { unlinkSync(handoffPath); } catch {}
      }
    }
  } catch {}

  // ── Output memory to stdout (Claude reads this) ───────────────
  if (pendingHandoff || compressedBrief || synthesizedLearnings || memoryItems.length > 0 || learningItems.length > 0) {
    const memoryBlock = [];
    memoryBlock.push('[AURAMAXING MEMORY]');

    // Priority 0: Pending handoff from prior 40%-triggered session
    if (pendingHandoff) {
      memoryBlock.push('⚡ RESUMED FROM 40% AUTO-HANDOFF ⚡');
      memoryBlock.push(`Prior session hit ${pendingHandoff.contextUsedPct}% context on ${pendingHandoff.timestamp?.slice(0,16)}.`);
      if (pendingHandoff.lastPrompt) {
        memoryBlock.push('Last user prompt before handoff:');
        memoryBlock.push(`"${pendingHandoff.lastPrompt.slice(0, 400)}"`);
      }
      if (pendingHandoff.prd?.path) {
        memoryBlock.push(`PRD snapshot preserved: ${pendingHandoff.prd.path}`);
      }
      if (pendingHandoff.git) {
        memoryBlock.push(`Git: ${pendingHandoff.git.branch} @ ${pendingHandoff.git.lastCommit} (${pendingHandoff.git.dirtyFiles?.length || 0} dirty files)`);
      }
      memoryBlock.push('Full handoff: ~/.auramaxing/pending-handoff.json + NotebookLM.');
      memoryBlock.push('Resume the work directly — do not ask user to re-explain.');
      memoryBlock.push('---');

      // Clear the handoff now that it's been consumed
      try { unlinkSync(join(HOME, '.auramaxing', 'pending-handoff.json')); } catch {}
      // Also clear the debounce flag from prior session
      try {
        const flagDir = '/tmp';
        readdirSync(flagDir).filter(f => f.startsWith('auramaxing-handoff-')).forEach(f => {
          try { unlinkSync(join(flagDir, f)); } catch {}
        });
      } catch {}
    }

    // Prefer pre-computed briefing (saves ~70% tokens vs raw entries)
    if (compressedBrief) {
      memoryBlock.push('Session briefing:');
      memoryBlock.push(compressedBrief.slice(0, 400));
    } else if (memoryItems.length > 0) {
      memoryBlock.push('Recent session context:');
      for (const m of memoryItems.slice(-3)) {
        memoryBlock.push(`- [${m.ts?.slice(0,10) || '?'}] ${m.content || m.summary || ''}`.slice(0, 150));
      }
    }

    // Prefer synthesized learnings (5 rules vs 10 raw entries)
    if (synthesizedLearnings) {
      memoryBlock.push('Learned patterns (synthesized):');
      memoryBlock.push(synthesizedLearnings.slice(0, 300));
    } else if (learningItems.length > 0) {
      memoryBlock.push('Learned patterns:');
      for (const l of learningItems.slice(-5)) {
        memoryBlock.push(`- ${l.pattern || l.key || '?'}: ${l.strategy || l.insight || l.result || '?'} (confidence: ${l.confidence || '?'})`);
      }
    }

    // Load session prediction if available
    let prediction = '';
    try {
      const predFile = join(PROMPT_CACHE, 'session-prediction.txt');
      if (existsSync(predFile)) {
        const age = Date.now() - statSync(predFile).mtimeMs;
        if (age < 86400000) {
          prediction = readFileSync(predFile, 'utf8').trim();
        }
      }
    } catch {}

    // Add prediction to memory block
    if (prediction) {
      memoryBlock.push('Predicted next task:');
      memoryBlock.push(prediction.slice(0, 200));
    }

    memoryBlock.push('[/AURAMAXING MEMORY]');
    process.stdout.write(memoryBlock.join('\n') + '\n');
  }

} catch (_) {}

process.exit(0);
