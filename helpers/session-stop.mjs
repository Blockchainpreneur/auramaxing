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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
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
        env: { ...process.env, PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}` },
      });
      child.unref();
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
