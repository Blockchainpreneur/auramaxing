#!/usr/bin/env node
/**
 * Memory Enrichment Hook — v2
 * Runs on UserPromptSubmit and SessionStart — surfaces relevant past context.
 *
 * Improvements v2:
 * - mtime-based file cache: skips re-parsing if files unchanged
 * - TF-IDF inspired scoring: weights rare keywords higher
 * - Shows which keywords matched for better context
 * - Faster keyword extraction with compiled stopwords Set
 * Non-blocking: exits 0 always.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { findPython } from './find-bin.mjs';

const cwd           = process.cwd();
const DATA_DIR      = join(cwd, '.claude-flow', 'data');
const STORE_PATH    = join(DATA_DIR, 'auto-memory-store.json');
const PATTERNS_PATH = join(DATA_DIR, 'learned-patterns.json');
const CACHE_DIR     = join(homedir(), '.auramaxing', 'enrich-cache');
const CACHE_FILE    = join(CACHE_DIR, 'enrich-cache.json');

// Ensure dirs exist
try {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) writeFileSync(STORE_PATH, '[]');
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
} catch {}

// Stopwords — fast Set lookup
const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','can','had','her','was','one','our',
  'out','day','get','has','him','his','how','its','let','may','now','old','see','two',
  'use','way','who','did','do','go','in','is','it','no','of','on','or','so','to','up',
  'we','be','by','he','me','my','an','as','at','if','la','el','en','un','una','que',
  'los','las','con','por','del','esto','este','eso','ese','para','como','bien','todo',
]);

// Load JSON file with mtime-based cache (avoids re-parsing unchanged files)
function loadCached(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const mtime = statSync(filePath).mtimeMs;
    let cache = {};
    if (existsSync(CACHE_FILE)) {
      try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch {}
    }
    // Cache hit: file unchanged
    if (cache[filePath]?.mtime === mtime && Array.isArray(cache[filePath]?.data)) {
      return cache[filePath].data;
    }
    // Cache miss: read and update cache
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    cache[filePath] = { mtime, data };
    try { writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
    return Array.isArray(data) ? data : Object.values(data);
  } catch { return []; }
}

async function main() {
  const mode = process.argv[2] || '';

  // ── Session restore mode ─────────────────────────────────────────────────────
  if (mode === 'session-start') {
    try {
      const project  = basename(cwd);
      const patterns = loadCached(PATTERNS_PATH);
      const recent   = patterns.filter(p => p.project === project || !p.project).slice(0, 5);
      if (recent.length > 0) {
        console.log(`\n[AutoMemory] Project: ${project} — Last ${recent.length} tool events restored:`);
        recent.forEach((p, i) => console.log(`  ${i + 1}. ${p.pattern}`));
      }
    } catch {}
    process.exit(0);
  }

  // ── Prompt enrichment mode (LightRAG semantic search with TF-IDF fallback)
  try {
    let promptText = '';
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString().trim();
      if (raw) {
        try {
          const payload = JSON.parse(raw);
          promptText = payload.prompt || payload.user_prompt || '';
        } catch { promptText = raw; }
      }
    }
    if (!promptText || promptText.length < 5) process.exit(0);

    // Priority 1: LightRAG semantic search
    let found = false;
    try {
      const { execFileSync } = await import('child_process');
      const { homedir: getHome } = await import('os');
      const PYTHON_BIN = findPython();
      const LIGHTRAG_CLI = join(getHome(), 'auramaxing', 'scripts', 'lightrag-cli.py');
      const WORKSPACE = join(getHome(), '.auramaxing', 'lightrag-workspace');

      const result = execFileSync(PYTHON_BIN, [
        LIGHTRAG_CLI, 'query',
        '--workspace', WORKSPACE,
        '--query', promptText.slice(0, 300),
        '--top-k', String(Number(process.env.AURA_LIGHTRAG_TOP_K || 3)),
      ], {
        encoding: 'utf8',
        timeout: 2000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      }).trim();

      const results = JSON.parse(result);
      if (results.length > 0) {
        console.log(`\n[Memory] ${results.length} relevant pattern(s) via semantic search:`);
        results.forEach((r, i) => {
          console.log(`  ${i + 1}. ${(r.text || '').slice(0, Number(process.env.AURA_ENRICH_SNIPPET_CHARS || 100))} (score: ${r.score})`);
        });
        found = true;
      }
    } catch { /* LightRAG unavailable, fall back to TF-IDF */ }

    // Priority 2: TF-IDF keyword fallback
    if (!found) {
      const seen = new Set();
      const keywords = promptText.toLowerCase()
        .split(/[\s\-_.,;:!?()[\]{}"'`/\\]+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !seen.has(w) && seen.add(w))
        .slice(0, Number(process.env.AURA_ENRICH_MAX_KEYWORDS || 8));

      if (keywords.length > 0) {
        const allPatterns = loadCached(PATTERNS_PATH);
        const storeData = loadCached(STORE_PATH);
        const totalDocs = allPatterns.length + storeData.length + 1;
        const docFreq = {};
        for (const kw of keywords) {
          let df = 0;
          for (const p of allPatterns) {
            if (((p.pattern || '') + ' ' + (p.context || '')).toLowerCase().includes(kw)) df++;
          }
          for (const e of storeData) {
            if (((e.content || '') + ' ' + (e.value || '')).toLowerCase().includes(kw)) df++;
          }
          docFreq[kw] = df;
        }

        const matches = [];
        for (const p of allPatterns) {
          if (!p.pattern) continue;
          const content = ((p.pattern) + ' ' + (p.context || '')).toLowerCase();
          const matched = keywords.filter(k => content.includes(k));
          if (matched.length === 0) continue;
          const score = matched.reduce((s, kw) => s + Math.log((totalDocs + 1) / ((docFreq[kw] || 0) + 1)), 0);
          matches.push({ score, summary: p.pattern.slice(0, 120), matched: matched.slice(0, 3) });
        }
        for (const entry of storeData) {
          const content = ((entry.content || '') + ' ' + (entry.value || '') + ' ' + (entry.summary || '')).toLowerCase();
          const matched = keywords.filter(k => content.includes(k));
          if (matched.length === 0) continue;
          const score = matched.reduce((s, kw) => s + Math.log((totalDocs + 1) / ((docFreq[kw] || 0) + 1)), 0);
          const summary = (entry.content || entry.value || '').slice(0, 120);
          if (summary) matches.push({ score, summary, matched: matched.slice(0, 3) });
        }

        matches.sort((a, b) => b.score - a.score);
        const top = matches.slice(0, Number(process.env.AURA_ENRICH_MAX_MATCHES || 3)).filter(m => m.summary);
        if (top.length > 0) {
          console.log(`\n[Memory] ${top.length} relevant pattern(s) from past sessions:`);
          top.forEach((m, i) => {
            const tags = m.matched.length ? ` (${m.matched.join(', ')})` : '';
            console.log(`  ${i + 1}. ${m.summary}${tags}`);
          });
        }
      }
    }
  } catch { /* never block */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
