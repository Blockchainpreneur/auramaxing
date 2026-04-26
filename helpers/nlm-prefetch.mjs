#!/usr/bin/env node
/**
 * AURAMAXING NLM Prefetch — predicted next-turn warmup
 *
 * Fired at the end of a UserPromptSubmit (by nlm-live-recall.mjs) as a detached
 * background process. While Claude is streaming the response and the user is
 * reading it, we have 30-120s of idle time to pre-populate the NLM cache with
 * answers we'll probably need on the NEXT turn.
 *
 * Predictions:
 *   1. Semantic continuation: "Follow-up context likely needed after: {prompt}"
 *   2. Intent-match: if intent-predictor is available, use its label to build targeted query
 *   3. Related-decisions: "What prior decisions apply to: {prompt}"
 *
 * Each prediction writes its own cache entry keyed by predicted-query hash.
 * On the next turn, nlm-live-recall's Tier-0 lookup catches them instantly.
 *
 * Usage: node nlm-prefetch.mjs "<current prompt>" "<cwd>"
 * Always exits 0 fast. Children are detached and unref'd.
 */
import { spawn, execFile } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';

const HOME = homedir();
const CACHE_DIR = join(HOME, '.auramaxing', 'nlm-cache');
const PREFETCH_TTL_FLAG = join(HOME, '.auramaxing', '.prefetch-rate-limit');
const NLM_BIN = findNlm();
const prompt = (process.argv[2] || '').trim();
const cwd = process.argv[3] || process.cwd();

mkdirSync(CACHE_DIR, { recursive: true });

if (!NLM_BIN || !prompt || prompt.length < 20) process.exit(0);

// Rate-limit: at most 1 prefetch per 10s to avoid hammering NLM
try {
  if (existsSync(PREFETCH_TTL_FLAG)) {
    const age = Date.now() - statSync(PREFETCH_TTL_FLAG).mtimeMs;
    if (age < 10000) process.exit(0);
  }
  writeFileSync(PREFETCH_TTL_FLAG, String(Date.now()));
} catch {}

function hashKey(query) {
  const norm = `${cwd}||${query.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function qualityFilter(a) {
  if (!a) return null;
  const s = a.trim();
  if (s.length < 30) return null;
  if (/^(none|i don't know|no relevant|no data|no information)/i.test(s)) return null;
  if (s.includes('[NLM error')) return null;
  return s.slice(0, 500);
}

function spawnAsk(query) {
  const hash = hashKey(query);
  const cacheFile = join(CACHE_DIR, `live-${hash}.txt`);
  // Skip if we already have fresh cache
  try {
    if (existsSync(cacheFile)) {
      const age = Date.now() - statSync(cacheFile).mtimeMs;
      if (age < 3600000) return;
    }
  } catch {}

  // Detached: let it run 60s+ if needed while we exit immediately
  const child = execFile(NLM_BIN, ['ask', query], {
    encoding: 'utf8',
    timeout: 90000,
    env: { ...process.env, PATH: pythonEnv().PATH },
  }, (err, stdout) => {
    if (err) return;
    const answer = (stdout || '').split('Answer:').pop()?.trim() || stdout?.trim();
    const filtered = qualityFilter(answer);
    if (filtered) {
      try { writeFileSync(cacheFile, filtered); } catch {}
    }
  });
  child.unref();
}

// Derive predicted queries
const queries = [];

// Q1: generic follow-up
queries.push(`Follow-up context likely needed after: ${prompt.slice(0, 150)}. Include related decisions, open questions, and patterns. <= 4 bullets.`);

// Q2: intent-based if we can infer
const intentMap = [
  { test: /\b(bug|fix|error|broken|fails?)\b/i,                  q: 'Related bugs, fixes, and root causes' },
  { test: /\b(deploy|ship|release|canary)\b/i,                  q: 'Deploy checklists, rollback plans, and past incidents' },
  { test: /\b(test|qa|spec|e2e)\b/i,                            q: 'Related test patterns, coverage gaps, and flaky tests' },
  { test: /\b(design|ui|ux|component)\b/i,                      q: 'Related design decisions, component patterns, and accessibility notes' },
  { test: /\b(security|auth|token|secret|leak)\b/i,             q: 'Security decisions, auth patterns, and known threats' },
  { test: /\b(perf|performance|slow|latency|optimize)\b/i,      q: 'Performance baselines, bottlenecks, and tuning decisions' },
];
for (const { test, q } of intentMap) {
  if (test.test(prompt)) {
    queries.push(`${q} relevant to: ${prompt.slice(0, 120)}. <= 4 bullets.`);
    break;
  }
}

// Q3: decisions-focused
queries.push(`What prior decisions apply when working on: ${prompt.slice(0, 150)}? <= 3 bullets.`);

// Limit to 3 prefetches max, stagger to avoid server contention
queries.slice(0, 3).forEach((q, i) => {
  setTimeout(() => spawnAsk(q), i * 400);
});

// Give spawns time to kick off, then exit parent.
setTimeout(() => process.exit(0), 200);
