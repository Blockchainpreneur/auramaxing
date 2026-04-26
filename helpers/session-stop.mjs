#!/usr/bin/env node
/**
 * SessionStop — save session memory + learnings + daemon summary
 *
 * 1. Reads turn events and current task to build session summary
 * 2. Saves key decisions/context to ~/.auramaxing/memory/
 * 3. Saves learned patterns to ~/.auramaxing/learnings/
 * 4. Sends summary to daemon
 *
 * Always exits 0.
 */
import { request } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const LEARNINGS_DIR = join(HOME, '.auramaxing', 'learnings');
const EVENTS_FILE = join(HOME, '.auramaxing', 'turn-events.jsonl');
const TASK_FILE = join(HOME, '.auramaxing', 'current-task.json');
const DECISIONS_FILE = join(HOME, '.auramaxing', 'decisions.md');

mkdirSync(MEMORY_DIR, { recursive: true });
mkdirSync(LEARNINGS_DIR, { recursive: true });

try {
  const cwd = process.cwd();
  const ts = new Date().toISOString();
  const dateKey = ts.slice(0, 10);
  const timeKey = ts.slice(11, 19).replace(/:/g, '');

  // ── Collect session data ──────────────────────────────────────
  let taskId = 'unknown';
  let taskLabel = 'Session';
  try {
    if (existsSync(TASK_FILE)) {
      const t = JSON.parse(readFileSync(TASK_FILE, 'utf8'));
      taskId = t.id || taskId;
      taskLabel = t.label || taskLabel;
    }
  } catch {}

  let toolCount = 0;
  let filesChanged = [];
  try {
    if (existsSync(EVENTS_FILE)) {
      const raw = readFileSync(EVENTS_FILE, 'utf8').trim();
      if (raw) {
        const events = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        toolCount = events.length;
        filesChanged = [...new Set(events.filter(e => e.file).map(e => e.file))].slice(0, 10);
      }
    }
  } catch {}

  // ── Save session memory ───────────────────────────────────────
  const memoryEntry = {
    ts,
    cwd,
    type: 'session',
    task: taskId,
    label: taskLabel,
    tools: toolCount,
    files: filesChanged,
    summary: `${taskLabel} — ${toolCount} tool calls, ${filesChanged.length} files changed`,
    content: `Worked on: ${taskLabel} (${taskId}) in ${cwd}. ${toolCount} tools used.${filesChanged.length > 0 ? ' Files: ' + filesChanged.join(', ') : ''}`,
  };

  const memFile = join(MEMORY_DIR, `${dateKey}-${timeKey}.json`);
  writeFileSync(memFile, JSON.stringify(memoryEntry, null, 2));

  // ── Save decisions if they exist ──────────────────────────────
  try {
    if (existsSync(DECISIONS_FILE)) {
      const decisions = readFileSync(DECISIONS_FILE, 'utf8').trim();
      if (decisions.length > 10) {
        const decisionEntry = {
          ts,
          type: 'decisions',
          content: decisions.slice(0, 2000),
          cwd,
        };
        writeFileSync(join(MEMORY_DIR, `${dateKey}-${timeKey}-decisions.json`), JSON.stringify(decisionEntry, null, 2));
      }
    }
  } catch {}

  // ── Prune old memory (separate limits by type) ────────────
  try {
    const allFiles = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
    const sessionFiles = allFiles.filter(f => !f.includes('-prompt') && !f.includes('-decisions'));
    const promptFiles = allFiles.filter(f => f.includes('-prompt'));
    const decisionFiles = allFiles.filter(f => f.includes('-decisions'));

    const prune = (files, limit) => {
      if (files.length > limit) {
        for (const f of files.slice(0, files.length - limit)) {
          try { unlinkSync(join(MEMORY_DIR, f)); } catch {}
        }
      }
    };

    prune(sessionFiles, 50);   // keep last 50 session summaries
    prune(promptFiles, 30);    // keep last 30 prompts
    prune(decisionFiles, 10);  // keep last 10 decision logs
  } catch {}

  // ── CLEANUP: Kill MCP child processes from this session ────────
  // [#9] Single fork: get all children with pid+command in one call
  try {
    const claudePid = process.ppid;
    const raw = execSync(
      `ps -o pid=,command= -p $(pgrep -P ${claudePid} | tr '\\n' ',') 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();

    if (raw) {
      for (const line of raw.split('\n').filter(Boolean)) {
        const match = line.trim().match(/^(\d+)\s+(.+)/);
        if (!match) continue;
        const [, childPid, cmd] = match;
        const pid = parseInt(childPid);
        if (pid === process.pid) continue;
        if (/mcp|shadcn|supabase|context7|magicui|caffeinate/.test(cmd)) {
          try { execSync(`pkill -P ${pid} 2>/dev/null`, { timeout: 1000 }); } catch {}
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
      }
    }
  } catch {}

  // ── AUTO: Pre-computation pipeline (background) ──────────────
  // Replaces NLM-only compress with full pipeline:
  // 1. Ingest memory into vector index
  // 2. NLM compress memory → session-briefing.txt
  // 3. NLM synthesize learnings → learnings-synthesis.txt
  // 4. NLM anti-laziness directives → anti-laziness-{type}.txt
  // 5. Compress ENRICHMENTS → enrichments-compressed.json
  try {
    const pipelineScript = join(HOME, 'auramaxing', 'helpers', 'precompute-pipeline.mjs');
    if (existsSync(pipelineScript)) {
      const child = spawn('node', [pipelineScript], {
        detached: true, stdio: 'ignore',
        env: { ...process.env, PATH: process.env.PATH },
      });
      child.unref();
    }
  } catch {}

  // ── Periodic disk hygiene (gated to once per 24h) ──────────────
  // Prunes: stale turn-events, old nlm-cache entries, Chrome profile bloat.
  try {
    const HYGIENE_FLAG = join(HOME, '.auramaxing', '.last-hygiene');
    const now = Date.now();
    let lastRun = 0;
    try { lastRun = parseInt(readFileSync(HYGIENE_FLAG, 'utf8'), 10); } catch {}

    if (now - lastRun > 24 * 3600 * 1000) {
      writeFileSync(HYGIENE_FLAG, String(now));

      // 1. Delete orphan turn-events (> 7 days old)
      try {
        const aurDir = join(HOME, '.auramaxing');
        for (const f of readdirSync(aurDir)) {
          if (f.startsWith('turn-events-') && f.endsWith('.jsonl')) {
            const fp = join(aurDir, f);
            const age = now - (statSync(fp).mtimeMs || 0);
            if (age > 7 * 24 * 3600 * 1000) { try { unlinkSync(fp); } catch {} }
          }
        }
      } catch {}

      // 2. Delete nlm-cache entries > 7 days old
      try {
        const cacheDir = join(HOME, '.auramaxing', 'nlm-cache');
        if (existsSync(cacheDir)) {
          for (const f of readdirSync(cacheDir)) {
            const fp = join(cacheDir, f);
            const age = now - (statSync(fp).mtimeMs || 0);
            if (age > 7 * 24 * 3600 * 1000) { try { unlinkSync(fp); } catch {} }
          }
        }
      } catch {}

      // 3. Chrome profile cache prune (fire-and-forget shell)
      try {
        const profile = join(HOME, '.auramaxing', 'chrome-cdp-profile', 'Default');
        if (existsSync(profile)) {
          const pruneCmd = `for d in "Cache" "Code Cache" "Service Worker/CacheStorage"; do [ -d "${profile}/$d" ] && rm -rf "${profile}/$d"/* 2>/dev/null; done`;
          const child = spawn('/bin/bash', ['-c', pruneCmd], { detached: true, stdio: 'ignore' });
          child.unref();
        }
      } catch {}
    }
  } catch {}

  // ── Send to daemon ────────────────────────────────────────────
  const payload = JSON.stringify({
    cwd,
    summary: memoryEntry.summary,
    task: taskId,
    label: taskLabel,
    files: filesChanged,
    tools: toolCount,
  });

  const req = request({
    hostname: 'localhost', port: 57821, path: '/session/end', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();

} catch {}

setTimeout(() => process.exit(0), 500);
