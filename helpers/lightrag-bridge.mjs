#!/usr/bin/env node
/**
 * AURAMAXING LightRAG Bridge — Node.js ↔ Python vector search
 *
 * Wraps lightrag-cli.py with caching and timeout handling.
 * All operations are non-blocking with graceful fallbacks.
 *
 * Usage (as module):
 *   import { queryMemory, ingestEntries, getStatus } from './lightrag-bridge.mjs';
 *
 * Usage (CLI):
 *   node lightrag-bridge.mjs query "search text"
 *   node lightrag-bridge.mjs ingest <json-file>
 *   node lightrag-bridge.mjs status
 */
import { execFileSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const HOME = homedir();
const PYTHON_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
const CLI_SCRIPT = join(HOME, 'auramaxing', 'scripts', 'lightrag-cli.py');
const WORKSPACE = join(HOME, '.auramaxing', 'lightrag-workspace');
const CACHE_DIR = join(HOME, '.auramaxing', 'lightrag-cache');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const QUERY_TIMEOUT = 5000; // 5s max for queries (allows sentence-transformers cold start ~3s)
const INGEST_TIMEOUT = 30000; // 30s for ingestion

mkdirSync(CACHE_DIR, { recursive: true });

// ── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(text) {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 16);
}

function cacheGet(key) {
  const file = join(CACHE_DIR, `${key}.json`);
  try {
    if (!existsSync(file)) return null;
    const age = Date.now() - statSync(file).mtimeMs;
    if (age > CACHE_TTL) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch { return null; }
}

function cacheSet(key, data) {
  try {
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {}
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Semantic search over memory index.
 * Returns top-k results as array of { text, type, ts, score }.
 * Returns empty array on any failure.
 */
export function queryMemory(prompt, topK = 3) {
  if (!prompt || prompt.length < 3) return [];

  // Check cache
  const key = cacheKey(prompt);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const result = execFileSync(PYTHON_BIN, [
      CLI_SCRIPT, 'query',
      '--workspace', WORKSPACE,
      '--query', prompt.slice(0, 300),
      '--top-k', String(topK),
    ], {
      encoding: 'utf8',
      timeout: QUERY_TIMEOUT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim();

    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      cacheSet(key, parsed);
      return parsed;
    }
  } catch {}

  return [];
}

/**
 * Ingest entries into the vector index.
 * Accepts array of memory/learning objects.
 * Runs in background (non-blocking) by default.
 */
export function ingestEntries(entries, background = true) {
  if (!entries || entries.length === 0) return;

  const inputData = JSON.stringify(entries);

  if (background) {
    try {
      const child = spawn(PYTHON_BIN, [
        CLI_SCRIPT, 'ingest',
        '--workspace', WORKSPACE,
      ], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      child.stdin.write(inputData);
      child.stdin.end();
      child.unref();
    } catch {}
    return;
  }

  // Synchronous mode
  try {
    const result = execFileSync(PYTHON_BIN, [
      CLI_SCRIPT, 'ingest',
      '--workspace', WORKSPACE,
    ], {
      input: inputData,
      encoding: 'utf8',
      timeout: INGEST_TIMEOUT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    return JSON.parse(result.trim());
  } catch {}
  return null;
}

/**
 * Ingest all memory and learning files into the index.
 * Reads from ~/.auramaxing/memory/ and ~/.auramaxing/learnings/.
 */
export function ingestAllMemory() {
  const memoryDir = join(HOME, '.auramaxing', 'memory');
  const learningsDir = join(HOME, '.auramaxing', 'learnings');
  const entries = [];

  // Collect memory entries
  try {
    if (existsSync(memoryDir)) {
      const files = readdirSync(memoryDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(memoryDir, f), 'utf8'));
          data.source = 'memory';
          entries.push(data);
        } catch {}
      }
    }
  } catch {}

  // Collect learnings
  try {
    if (existsSync(learningsDir)) {
      const files = readdirSync(learningsDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(learningsDir, f), 'utf8'));
          if (Array.isArray(data)) {
            data.forEach(d => { d.source = 'learning'; entries.push(d); });
          } else {
            data.source = 'learning';
            entries.push(data);
          }
        } catch {}
      }
    }
  } catch {}

  if (entries.length > 0) {
    return ingestEntries(entries, false);
  }
  return { ingested: 0, total: 0 };
}

/**
 * Ingest learnings from all known projects into the global index.
 * Scans ~/.gstack/projects/{project}/learnings.jsonl for cross-project knowledge.
 */
export function ingestCrossProject() {
  const gstackDir = join(HOME, '.gstack', 'projects');
  const entries = [];

  try {
    if (existsSync(gstackDir)) {
      const projects = readdirSync(gstackDir);
      for (const proj of projects) {
        const learningsFile = join(gstackDir, proj, 'learnings.jsonl');
        if (existsSync(learningsFile)) {
          try {
            const lines = readFileSync(learningsFile, 'utf8').trim().split('\n');
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                entry.source = `gstack:${proj}`;
                entry.content = entry.content || entry.insight || entry.key || '';
                entries.push(entry);
              } catch {}
            }
          } catch {}
        }
      }
    }
  } catch {}

  // Also scan for Claude auto-memory files across projects
  const claudeProjectsDir = join(HOME, '.claude', 'projects');
  try {
    if (existsSync(claudeProjectsDir)) {
      const projects = readdirSync(claudeProjectsDir);
      for (const proj of projects) {
        const memDir = join(claudeProjectsDir, proj, 'memory');
        if (existsSync(memDir)) {
          try {
            const files = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
            for (const f of files) {
              try {
                const content = readFileSync(join(memDir, f), 'utf8');
                entries.push({
                  source: `claude-memory:${proj}`,
                  content: content.slice(0, 500),
                  type: 'cross-project',
                  ts: new Date().toISOString(),
                });
              } catch {}
            }
          } catch {}
        }
      }
    }
  } catch {}

  if (entries.length > 0) {
    return ingestEntries(entries, false);
  }
  return { ingested: 0, total: 0 };
}

/**
 * Get index status.
 */
export function getStatus() {
  try {
    const result = execFileSync(PYTHON_BIN, [
      CLI_SCRIPT, 'status',
      '--workspace', WORKSPACE,
    ], {
      encoding: 'utf8',
      timeout: 2000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim();
    return JSON.parse(result);
  } catch {}
  return { documents: 0, embedding_dim: 0, index_exists: false };
}

// ── CLI mode ─────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('lightrag-bridge.mjs')) {
  const cmd = process.argv[2] || 'status';
  const arg = process.argv.slice(3).join(' ');

  switch (cmd) {
    case 'query': {
      const results = queryMemory(arg || 'test', 3);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'ingest': {
      if (arg && existsSync(arg)) {
        const data = JSON.parse(readFileSync(arg, 'utf8'));
        const result = ingestEntries(Array.isArray(data) ? data : [data], false);
        console.log(JSON.stringify(result));
      } else {
        const result = ingestAllMemory();
        console.log(JSON.stringify(result));
      }
      break;
    }
    case 'ingest-all': {
      const result = ingestAllMemory();
      console.log(JSON.stringify(result));
      break;
    }
    case 'ingest-cross': {
      const result = ingestCrossProject();
      console.log(JSON.stringify(result));
      break;
    }
    case 'status':
    default: {
      console.log(JSON.stringify(getStatus(), null, 2));
      break;
    }
  }
}
