#!/usr/bin/env node
/**
 * AURAMAXING NLM Writer — content-type routed writes with buffered flush
 *
 * Write pipeline:
 *   classify(text, ctx) -> type ('decision' | 'learning' | 'prd' | 'diff' | 'session' | 'research' | 'pattern')
 *   routeWrite(type, payload) -> { notebook, method: 'note' | 'source' | 'source-research' }
 *   bufferWrite(...) appends to ~/.auramaxing/nlm-write-buffer.jsonl
 *   flush(reason) drains buffer -> NLM CLI; failures go to .retry.jsonl (max 3 attempts then dead-letter)
 *
 * CLI:
 *   node nlm-writer.mjs buffer <type> [--title "..."] [--project "..."]  # reads payload from stdin
 *   node nlm-writer.mjs flush [--limit N]
 *   node nlm-writer.mjs classify           # reads text from stdin, prints type
 *   node nlm-writer.mjs stats              # buffer + retry + dead-letter counts
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, statSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { homedir, tmpdir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';
import { notebookFor, ensureAll } from './notebook-router.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const BUFFER = join(AUR, 'nlm-write-buffer.jsonl');
const RETRY = join(AUR, 'nlm-write-buffer.retry.jsonl');
const DEAD = join(AUR, 'nlm-write-buffer.dead-letter.jsonl');
const NLM_BIN = findNlm();

mkdirSync(AUR, { recursive: true });

function projectFromCwd(cwd) {
  return basename(cwd || process.cwd()) || 'unknown';
}

export function classifyContent(text, ctx = {}) {
  if (!text) return 'session';
  const t = text.trim();
  const source = ctx.source;

  if (source === 'git-diff' || source === 'file-diff') return 'diff';
  if (source === 'prd-edit' || ctx.filePath && /PRD\.md|product-requirements|prd\/.*\.md/i.test(ctx.filePath)) return 'prd';
  if (source === 'research' || /^\s*research:/i.test(t)) return 'research';

  if (/^\s*(decided|chose|picked|going with|we'll use|decision:)/i.test(t)) return 'decision';
  if (/^\s*(learned|works|avoid|don't|dont|pattern:|lesson:|takeaway)/i.test(t)) return 'learning';
  if (/^\s*(pattern|convention|rule):/i.test(t)) return 'pattern';

  return 'session';
}

export function routeWrite(type) {
  const nbTypes = {
    decision: { method: 'note',            notebookType: 'decision' },
    learning: { method: 'note',            notebookType: 'learning' },
    pattern:  { method: 'note',            notebookType: 'pattern'  },
    prd:      { method: 'source',          notebookType: 'prd'      },
    diff:     { method: 'source',          notebookType: 'diff'     },
    session:  { method: 'source',          notebookType: 'session'  },
    research: { method: 'source-research', notebookType: 'research' },
    briefing: { method: 'source',          notebookType: 'briefing' },
  };
  return nbTypes[type] || nbTypes.session;
}

export function bufferWrite(type, payload, ctx = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    project: ctx.project || projectFromCwd(ctx.cwd),
    title: ctx.title,
    payload,
    attempts: 0,
  };
  try { appendFileSync(BUFFER, JSON.stringify(entry) + '\n'); } catch {}
  return entry;
}

function nlm(args, { timeout = 30000 } = {}) {
  if (!NLM_BIN) throw new Error('NLM CLI not available');
  return execSync(`${NLM_BIN} ${args}`, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, PATH: pythonEnv().PATH },
  }).trim();
}

function writeEntry(entry) {
  const { method, notebookType } = routeWrite(entry.type);
  const notebookId = notebookFor(notebookType, entry.project);
  if (!notebookId) throw new Error(`No notebook for type=${entry.type} project=${entry.project}`);
  const nbShort = notebookId.slice(0, 8);

  // Switch context first
  nlm(`use ${nbShort}`, { timeout: 10000 });

  if (method === 'note') {
    // `notebooklm note create` takes a title + content. We serialize payload to markdown.
    const content = typeof entry.payload === 'string'
      ? entry.payload
      : JSON.stringify(entry.payload, null, 2);
    const title = entry.title || `${entry.type}-${entry.ts.slice(0, 19)}`;
    const tmpFile = join(tmpdir(), `aura-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
    writeFileSync(tmpFile, content);
    try {
      // note create subcommand varies; try both positional forms gracefully
      try {
        nlm(`note create --title "${title.replace(/"/g, '\\"')}" --file "${tmpFile}"`, { timeout: 20000 });
      } catch {
        // Some versions: `notebooklm note create "title" < file`
        execSync(`${NLM_BIN} note create "${title.replace(/"/g, '\\"')}" < "${tmpFile}"`, {
          encoding: 'utf8', timeout: 20000, shell: '/bin/bash',
          env: { ...process.env, PATH: pythonEnv().PATH },
        });
      }
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
    return { ok: true };
  }

  if (method === 'source' || method === 'source-research') {
    const content = typeof entry.payload === 'string'
      ? entry.payload
      : JSON.stringify(entry.payload, null, 2);
    const date = entry.ts.slice(0, 10);
    const title = entry.title || `${entry.type} ${date} — ${entry.project}`;
    const tmpFile = join(tmpdir(), `aura-src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
    writeFileSync(tmpFile, `# ${title}\n\n${content}`);
    try {
      if (method === 'source-research') {
        // source add-research expects a query/URL, fall back to add if payload is not a URL
        if (typeof entry.payload === 'string' && /^https?:\/\//.test(entry.payload.trim())) {
          nlm(`source add-research "${entry.payload.trim()}" --title "${title.replace(/"/g, '\\"')}"`, { timeout: 45000 });
        } else {
          nlm(`source add "${tmpFile}" --title "${title.replace(/"/g, '\\"')}"`, { timeout: 45000 });
        }
      } else {
        nlm(`source add "${tmpFile}" --title "${title.replace(/"/g, '\\"')}"`, { timeout: 45000 });
      }
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
    return { ok: true };
  }

  throw new Error(`Unknown method: ${method}`);
}

export async function flush({ limit = Infinity } = {}) {
  if (!existsSync(BUFFER)) return { written: 0, failed: 0, deadLettered: 0 };
  if (!NLM_BIN) return { written: 0, failed: 0, deadLettered: 0, skipped: true };

  // Snapshot buffer
  const raw = readFileSync(BUFFER, 'utf8');
  try { writeFileSync(BUFFER, ''); } catch {}
  const lines = raw.split('\n').filter(Boolean);

  // Append any existing retry entries to the queue
  let retryLines = [];
  try {
    if (existsSync(RETRY)) {
      retryLines = readFileSync(RETRY, 'utf8').split('\n').filter(Boolean);
      writeFileSync(RETRY, '');
    }
  } catch {}

  const queue = [...lines, ...retryLines].map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  let written = 0, failed = 0, deadLettered = 0;
  for (const entry of queue.slice(0, limit)) {
    try {
      writeEntry(entry);
      written++;
    } catch (e) {
      entry.attempts = (entry.attempts || 0) + 1;
      entry.lastError = String(e.message || e).slice(0, 200);
      if (entry.attempts >= 3) {
        try { appendFileSync(DEAD, JSON.stringify(entry) + '\n'); } catch {}
        deadLettered++;
      } else {
        try { appendFileSync(RETRY, JSON.stringify(entry) + '\n'); } catch {}
        failed++;
      }
    }
  }
  return { written, failed, deadLettered };
}

// ── CLI ─────────────────────────────────────────────────────────
async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.error('Usage: nlm-writer.mjs <buffer|flush|classify|stats>');
    process.exit(2);
  }

  if (cmd === 'classify') {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const text = Buffer.concat(chunks).toString();
    console.log(classifyContent(text));
    return;
  }

  if (cmd === 'buffer') {
    const type = process.argv[3];
    if (!type) { console.error('type required'); process.exit(2); }
    const args = process.argv.slice(4);
    const title = args.includes('--title') ? args[args.indexOf('--title') + 1] : undefined;
    const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : undefined;
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = Buffer.concat(chunks).toString();
    const entry = bufferWrite(type, payload, { title, project });
    console.log(JSON.stringify(entry));
    return;
  }

  if (cmd === 'flush') {
    const args = process.argv.slice(3);
    const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
    // Ensure notebooks exist before flushing (cheap if already done)
    try { ensureAll({ project: projectFromCwd(process.cwd()) }); } catch {}
    const res = await flush({ limit });
    console.log(JSON.stringify(res));
    return;
  }

  if (cmd === 'stats') {
    const count = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
    console.log(JSON.stringify({
      buffer: count(BUFFER),
      retry: count(RETRY),
      deadLetter: count(DEAD),
    }, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error('nlm-writer error:', e.message); process.exit(1); });
}
