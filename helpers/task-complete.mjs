#!/usr/bin/env node
/**
 * Task Complete — AURAMAXING 2.0
 * Stop hook. Reads the turn's accumulated tool events and renders
 * a completion state machine diagram showing what was done.
 *
 * Fires on every Claude response that used at least one tool.
 * Silent on pure text responses (no tools used = no diagram).
 *
 * Gap 1 fix: closes the routing → execution → done feedback loop.
 * Gap 2 fix: writes a structured session summary to daemon.
 *
 * Always exits 0. Non-blocking.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { request } from 'http';

const HOME         = homedir();
const DIR          = join(HOME, '.auramaxing');
const SESSION_PID  = process.ppid || process.pid;
const EVENTS_FILE  = join(DIR, `turn-events-${SESSION_PID}.jsonl`);
const TASK_FILE    = join(DIR, 'current-task.json');
const DECISIONS    = join(DIR, 'decisions.md');

// Human-readable action labels (gap: non-technical visibility)
const ACTION_LABELS = {
  Edit:      'edited code',
  Write:     'wrote files',
  MultiEdit: 'edited code',
  Read:      'read files',
  Grep:      'searched code',
  Glob:      'searched files',
  Bash:      'ran commands',
  WebSearch: 'searched online',
  WebFetch:  'fetched pages',
  Task:      'ran agents',
  Agent:     'spawned agents',
};

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

try {
  if (!existsSync(EVENTS_FILE)) process.exit(0);

  const raw = readFileSync(EVENTS_FILE, 'utf8').trim();
  if (!raw) process.exit(0);   // No tools used this turn — stay silent

  const events = raw.split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  if (!events.length) process.exit(0);

  // ── Aggregate ────────────────────────────────────────────────────────────
  const toolCounts = {};
  const filesChanged = new Set();
  const cmds = [];

  for (const e of events) {
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1;
    if (e.file && WRITE_TOOLS.has(e.tool)) {
      filesChanged.add(e.file.split('/').slice(-2).join('/'));
    }
    if (e.cmd) cmds.push(e.cmd);
  }

  // Collapse into human action groups
  const actionGroups = {};
  for (const [tool, count] of Object.entries(toolCounts)) {
    const label = ACTION_LABELS[tool] || tool.toLowerCase();
    actionGroups[label] = (actionGroups[label] || 0) + count;
  }
  const actionStr = Object.entries(actionGroups)
    .sort((a, b) => b[1] - a[1])
    .map(([lbl, n]) => n > 1 ? `${lbl}(×${n})` : lbl)
    .join(' · ');

  // Task type from router
  let taskId    = 'response';
  let taskLabel = 'Done';
  if (existsSync(TASK_FILE)) {
    try {
      const t = JSON.parse(readFileSync(TASK_FILE, 'utf8'));
      taskId    = t.id    || taskId;
      taskLabel = t.label || taskLabel;
    } catch {}
  }

  // ── Render completion diagram ─────────────────────────────────────────────
  const C  = '\x1b[32m';   // green
  const R  = '\x1b[0m';
  const D  = '\x1b[2m';
  const W  = 40;
  const IW = W - 4;

  const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const fit = (s, w) => s + ' '.repeat(Math.max(0, w - [...vis(s)].length));

  const boxTop = (tag) => {
    const t = `[ ${tag} ]`;
    return `${C}┌─${t}${'─'.repeat(Math.max(0, W - 2 - t.length))}┐${R}`;
  };
  const boxBot = () => `${C}└${'─'.repeat(W - 2)}┘${R}`;
  const boxRow = (content) => `${C}│${R}  ${fit(content, IW)}${C}│${R}`;

  const out = [''];
  out.push(boxTop('DONE'));
  out.push(boxRow(`task     ${C}${taskLabel}${R}  ${D}(${taskId})${R}`));

  if (filesChanged.size) {
    const fileStr = [...filesChanged].slice(0, 3).join('  ·  ');
    out.push(boxRow(`files    ${D}${fileStr}${R}`));
  }

  out.push(boxRow(`actions  ${D}${actionStr || 'none'}${R}`));
  out.push(boxRow(`result   ${C}✓ complete${R}`));
  out.push(boxBot());
  out.push('');

  // Colored version → stderr (terminal only — not shown in Claude Code chat)
  process.stderr.write(out.join('\n') + '\n');

  // ── Clear turn events for next response ──────────────────────────────────
  writeFileSync(EVENTS_FILE, '');

  // ── Gap 2: structured summary to daemon (not just a timestamp) ────────────
  const summary = {
    cwd:     process.cwd(),
    task:    taskId,
    label:   taskLabel,
    files:   [...filesChanged],
    actions: actionGroups,
    cmds:    cmds.slice(0, 5),
    ts:      new Date().toISOString(),
  };
  const payload = JSON.stringify(summary);
  const req = request({
    hostname: 'localhost', port: 57821, path: '/session/end', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();

} catch {}

setTimeout(() => process.exit(0), 300);
