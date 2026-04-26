#!/usr/bin/env node
/**
 * AURAMAXING Session Flush — Stop hook orchestrator
 *
 * Runs at session end. Drains:
 *   1. diff-buffer-{ppid}.jsonl  -> nlm-writer.bufferWrite(type=diff|prd)
 *   2. nlm-write-buffer.jsonl    -> NLM CLI via nlm-writer.flush()
 *   3. stamp-check weekly synthesis; fires detached if cadence elapsed
 *
 * All writes are buffered locally and drained in background. Never blocks
 * session-stop itself beyond ~1s. Fully independent of the canonical
 * session-stop.mjs pipeline — safe to run in parallel.
 *
 * Reads optional JSON from stdin: { cwd, ... }. Always exits 0.
 */
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { bufferWrite, flush } from './nlm-writer.mjs';
import { ensureAll, readMap } from './notebook-router.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const LOG = join(AUR, 'aura-session-flush.log');
const WEEKLY_STAMP = join(AUR, '.last-weekly-synth');
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

mkdirSync(AUR, { recursive: true });

function log(...parts) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${parts.join(' ')}\n`); } catch {}
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch { return {}; }
}

function drainDiffBuffers(projectHint) {
  // Drain ALL diff-buffer-*.jsonl (across any PID — some may be orphaned)
  let drained = 0;
  try {
    for (const f of readdirSync(AUR)) {
      if (!f.startsWith('diff-buffer-') || !f.endsWith('.jsonl')) continue;
      const path = join(AUR, f);
      let content = '';
      try { content = readFileSync(path, 'utf8'); } catch { continue; }
      const entries = content.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (entries.length === 0) { try { unlinkSync(path); } catch {} ; continue; }

      // Group diffs by project+day for compaction
      const grouped = {};
      for (const e of entries) {
        const key = `${e.project || projectHint}::${e.ts.slice(0, 10)}::${e.prd ? 'prd' : 'diff'}`;
        (grouped[key] ||= []).push(e);
      }
      for (const [key, group] of Object.entries(grouped)) {
        const [project, date, kind] = key.split('::');
        const title = kind === 'prd'
          ? `PRD edits ${date} — ${project}`
          : `Code diffs ${date} — ${project}`;
        const body = group.map(e =>
          `## ${e.file}\nTool: ${e.tool} | bytes: ${e.bytes?.old}->${e.bytes?.new}\n\n\`\`\`diff\n${e.diff}\n\`\`\``
        ).join('\n\n');
        bufferWrite(kind === 'prd' ? 'prd' : 'diff', body, { project, title });
        drained += group.length;
      }
      try { unlinkSync(path); } catch {}
    }
  } catch (e) { log('drainDiffBuffers error:', e.message); }
  return drained;
}

function maybeTriggerWeekly() {
  try {
    let age = Infinity;
    if (existsSync(WEEKLY_STAMP)) {
      const { statSync } = require('fs');
      age = Date.now() - statSync(WEEKLY_STAMP).mtimeMs;
    }
    if (age < SEVEN_DAYS_MS) return false;
    const script = join(HOME, 'auramaxing', 'helpers', 'nlm-weekly-synth.mjs');
    if (!existsSync(script)) return false;
    const child = spawn('node', [script], { detached: true, stdio: 'ignore' });
    child.unref();
    log('Weekly synthesis triggered (background)');
    return true;
  } catch (e) { log('weekly trigger failed:', e.message); return false; }
}

async function main() {
  const input = await readInput();
  const cwd = input.cwd || process.cwd();
  const project = basename(cwd);

  log(`Session flush starting for project=${project}`);

  // 1. Ensure notebook topology exists (lazy — first-run safety)
  try { ensureAll({ project }); } catch (e) { log('ensureAll failed:', e.message); }

  // 2. Drain diff buffers into write buffer
  const drainedDiffs = drainDiffBuffers(project);
  log(`Drained ${drainedDiffs} diff entries`);

  // 3. Flush write buffer to NLM (background detached — don't block session-stop)
  try {
    const flushScript = join(HOME, 'auramaxing', 'helpers', 'nlm-writer.mjs');
    const child = spawn('node', [flushScript, 'flush'], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, PATH: process.env.PATH },
    });
    child.unref();
    log('Flush dispatched in background');
  } catch (e) { log('flush dispatch failed:', e.message); }

  // 4. Weekly synthesis
  maybeTriggerWeekly();

  log('Session flush done');
}

main().catch(e => { log('fatal:', e.message); }).finally(() => setTimeout(() => process.exit(0), 100));
