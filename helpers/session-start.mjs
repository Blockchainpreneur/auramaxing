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

// Box drawing that actually lines up: pad the PLAIN text to a fixed inner width
// first, then colorize. Colorizing first makes ANSI escapes count as characters
// and the right border goes ragged; wide glyphs (⚠, emoji) do the same, so the
// box body stays plain ASCII.
const BOX_W = 56;
const boxTop = (title, Y, B, R) => `${Y}${B}  ┌─ ${title} ${'─'.repeat(Math.max(0, BOX_W - title.length - 3))}┐${R}`;
const boxRow = (text, Y, R, hi = '') => {
  const plain = `  ${text}`;
  const pad = ' '.repeat(Math.max(0, BOX_W - plain.length));
  return `${Y}  │${R}${hi ? plain.replace(text, `${hi}${text}\u001b[0m`) : plain}${pad}${Y}│${R}`;
};
const boxBot = (Y, B, R) => `${Y}${B}  └${'─'.repeat(BOX_W)}┘${R}`;

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
    // --write-state populates update-state.json so update-gate.mjs can block prompts
    const result = execSync(`bash "${checkScript}" --write-state 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
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

  // ── Upgrade banner (REQUIRED — prompts blocked until updated) ────
  if (upgradeAvail) {
    process.stderr.write(['',
      boxTop('AURAMAXING UPDATE REQUIRED', Y, B, R),
      boxRow(`Current   ${localVer}`, Y, R),
      boxRow(`Required  ${remoteVer}`, Y, R),
      boxRow('', Y, R),
      boxRow('Prompts are BLOCKED until you update.', Y, R, B),
      boxRow('Run:  bash ~/auramaxing/scripts/update.sh', Y, R),
      boxRow('', Y, R),
      boxRow('Heads-up: continued use of AURAMAXING will', Y, R),
      boxRow('become USD $1,499 per user / year.', Y, R, B),
      boxRow('Not charged yet - advance notice only.', Y, R),
      boxRow('', Y, R),
      boxRow('Override once: AURA_UPDATE_GATE_OFF=1 claude', Y, R),
      boxBot(Y, B, R), ''].join('\n') + '\n');
  }

  // ── Pricing notice — reaches EVERY user, not only outdated ones ──
  // The update window only fires when a machine is behind, so anyone already on
  // the latest version would never be told about the price. Shown on the first
  // 3 sessions, then it stays quiet (delete the counter to show it again).
  // Secuencia: PRIMERO la actualización, DESPUÉS el precio. Si hay un update
  // pendiente, este aviso calla — lo emite update-gate en cuanto la versión
  // coincide, para que nadie vea el precio antes de estar al día.
  try {
    const pendingFile = join(HOME, '.auramaxing', 'update-pending.json');
    const noticeFile = join(HOME, '.auramaxing', 'pricing-notice-seen');
    const freeUntilFile = join(HOME, '.auramaxing', 'free-until');
    let seen = 0;
    try { seen = parseInt(readFileSync(noticeFile, 'utf8').trim(), 10) || 0; } catch {}
    if (!existsSync(pendingFile) && seen < 3) {
      writeFileSync(noticeFile, String(seen + 1));
      let until;
      try { until = Number(readFileSync(freeUntilFile, 'utf8').trim()); } catch {}
      if (!Number.isFinite(until) || until <= 0) {
        until = Date.now() + 24 * 60 * 60 * 1000;
        try { writeFileSync(freeUntilFile, String(until)); } catch {}
      }
      const ends = new Date(until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      // Misma regla que update-gate: si la ventana ya cerró, anunciar "LAST 24
      // HOURS" con una fecha pasada sería falso.
      const expired = until <= Date.now();
      process.stderr.write(['',
        boxTop('AURAMAXING · FINAL FREE WINDOW', Y, B, R),
        ...(expired ? [
          boxRow('THE FREE WINDOW FOR AURAMAXING', Y, R, B),
          boxRow('HAS CLOSED.', Y, R, B),
          boxRow('', Y, R),
          boxRow('CONTINUED USE COSTS', Y, R),
          boxRow('USD $1,499 PER USER / YEAR.', Y, R, B),
          boxRow('', Y, R),
          boxRow(`FREE ACCESS ENDED: ${ends}`, Y, R),
        ] : [
          boxRow('THIS IS THE LAST 24 HOURS OF', Y, R, B),
          boxRow('AURAMAXING FOR FREE.', Y, R, B),
          boxRow('', Y, R),
          boxRow('AFTER THAT, CONTINUED USE COSTS', Y, R),
          boxRow('USD $1,499 PER USER / YEAR.', Y, R, B),
          boxRow('', Y, R),
          boxRow(`FREE ACCESS ENDS: ${ends}`, Y, R),
        ]),
        boxBot(Y, B, R), ''].join('\n') + '\n');
    }
  } catch {}

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
      memoryBlock.push('⚡ RESUMED FROM AUTO-HANDOFF ⚡');
      // FIRST NEXT ACTION + RESUME PLAN come first — they're the resume contract.
      let na = pendingHandoff.nextAction;
      try { const naf = join(HOME, '.auramaxing', 'next-action.txt'); if (!na && existsSync(naf)) { na = readFileSync(naf, 'utf8').trim(); unlinkSync(naf); } } catch {}
      if (na) memoryBlock.push(`▶ FIRST NEXT ACTION: ${na}`);
      if (pendingHandoff.checkpointDoc) memoryBlock.push(`▶ RESUME PLAN: read ${pendingHandoff.checkpointDoc} FIRST (self-contained; start at its FIRST NEXT ACTION).`);
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
      memoryBlock.push('Resume the work directly — do not ask user to re-explain. If a RESUME PLAN doc is named, read it first.');
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
      // Robust render: flatten array-form learning files, richer field fallbacks (tool as key,
      // error as value), SKIP entries with no real content, cap length, show confidence only when
      // present — kills the "?: ? (confidence: ?)" self-poisoning the 10x audit found.
      const lines = [];
      for (const l of learningItems.flat().filter(Boolean).slice(-5)) {
        const key = l.pattern || l.key || l.tool;
        const raw = l.strategy || l.insight || l.result || l.error;
        if (!key || !raw) continue;
        const val = String(typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/\s+/g, ' ').slice(0, 100);
        lines.push(`- ${key}: ${val}${l.confidence ? ` (confidence: ${l.confidence})` : ''}`);
      }
      if (lines.length) { memoryBlock.push('Learned patterns:'); lines.forEach(x => memoryBlock.push(x)); }
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
