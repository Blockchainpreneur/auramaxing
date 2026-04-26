#!/usr/bin/env node
/**
 * AURAMAXING NLM Live-Recall — UserPromptSubmit hook
 *
 * Injects retrieval from NotebookLM into the current turn with strict latency budget.
 *
 * Three tiers:
 *   Tier 0  cache (~5-50ms): content-hash lookup in ~/.auramaxing/nlm-cache/live-*.txt
 *   Tier 1  speculative-prefetched cache: populated by nlm-prefetch.mjs from *previous* turn
 *   Tier 2  in-turn ask (900ms hard cap): kill switch + detached child still populates cache for next turn
 *
 * Runs as a UserPromptSubmit hook AFTER prompt-engine.mjs (registered in settings.json).
 * Reads JSON from stdin: { prompt, cwd, user_prompt, ... }
 * Emits:   [AURAMAXING NLM-RECALL] ...bullets... [/AURAMAXING NLM-RECALL]
 *
 * At the END fires a fire-and-forget `nlm-prefetch.mjs` for turn N+1 speculative cache.
 * Always exits 0.
 */
import { spawn, execFile } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, basename } from 'path';
import { homedir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const CACHE_DIR = join(AUR, 'nlm-cache');
const NLM_BIN = findNlm();
const IN_TURN_BUDGET_MS = Number(process.env.AURA_NLM_LIVE_BUDGET_MS || 900);
const CACHE_TTL_MS = 24 * 3600 * 1000;
const PREFETCH = join(HOME, 'auramaxing', 'helpers', 'nlm-prefetch.mjs');

mkdirSync(CACHE_DIR, { recursive: true });

async function readInput() {
  if (process.stdin.isTTY) return { prompt: process.argv[2] || '' };
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString().trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { prompt: raw }; }
}

function hashKey(cwd, prompt) {
  const norm = `${cwd}||${prompt.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function fuzzyKey(cwd, prompt) {
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3).sort().join('-');
  return createHash('sha256').update(`${cwd}||${words}`).digest('hex').slice(0, 16);
}

function readCache(hash) {
  const file = join(CACHE_DIR, `live-${hash}.txt`);
  if (!existsSync(file)) return null;
  try {
    const age = Date.now() - statSync(file).mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    const content = readFileSync(file, 'utf8').trim();
    return content.length >= 20 && !/^NONE$/i.test(content) ? content : null;
  } catch { return null; }
}

function writeCache(hash, content) {
  if (!content || content.length < 20 || /^NONE$/i.test(content)) return;
  try { writeFileSync(join(CACHE_DIR, `live-${hash}.txt`), content); } catch {}
}

function skippable(prompt) {
  if (!prompt || prompt.length < 20) return true;
  if (/^\s*\//.test(prompt)) return true;          // slash commands
  if (/^\s*(hi|hey|hello|yes|no|ok)\b/i.test(prompt)) return true;
  return false;
}

function qualityFilter(answer) {
  if (!answer) return null;
  const a = answer.trim();
  if (a.length < 30) return null;
  if (/^(none|i don't know|no relevant|no data|no information)/i.test(a)) return null;
  if (a.includes('[NLM error')) return null;
  // Take first 400 chars and trim to a sentence boundary
  const capped = a.slice(0, Number(process.env.AURA_NLM_MAX_ANSWER_CHARS || 320));
  const lastPunct = Math.max(capped.lastIndexOf('.'), capped.lastIndexOf('\n'));
  return lastPunct > 80 ? capped.slice(0, lastPunct + 1) : capped;
}

function liveAskPromise(prompt) {
  if (!NLM_BIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    const q = `Relevant past decisions, PRD sections, and file patterns for: ${prompt.slice(0, 180)}. Answer <= 3 short bullets. If nothing relevant, answer NONE.`;
    const ac = new AbortController();
    const child = execFile(NLM_BIN, ['ask', q], {
      timeout: IN_TURN_BUDGET_MS + 2000, // allow child to keep running past our budget
      encoding: 'utf8',
      env: { ...process.env, PATH: pythonEnv().PATH },
      signal: ac.signal,
    }, (err, stdout) => {
      if (err) return resolve(null);
      const answer = (stdout || '').split('Answer:').pop()?.trim() || stdout?.trim();
      resolve(qualityFilter(answer));
    });
    // We don't kill the child on budget timeout — let it finish so the cache gets populated.
    // The race below just stops awaiting it.
    child.unref?.();
  });
}

async function main() {
  const input = await readInput();
  const prompt = (input.prompt || input.user_prompt || input.message || '').trim();
  const cwd = input.cwd || process.cwd();

  if (skippable(prompt)) process.exit(0);

  const h = hashKey(cwd, prompt);
  const fh = fuzzyKey(cwd, prompt);

  // Tier 0: exact hash
  let answer = readCache(h);
  let source = answer ? 'cache-exact' : null;

  // Tier 1: fuzzy hash (first 3 long words)
  if (!answer) {
    answer = readCache(fh);
    if (answer) source = 'cache-fuzzy';
  }

  // Tier 2: speculative in-turn ask with budget
  if (!answer && NLM_BIN) {
    const askP = liveAskPromise(prompt);
    // Background: whenever it resolves, cache it for next turn
    askP.then(a => { if (a) { writeCache(h, a); writeCache(fh, a); } });
    const timer = new Promise(r => setTimeout(() => r(null), IN_TURN_BUDGET_MS));
    answer = await Promise.race([askP, timer]);
    if (answer) { source = 'speculative'; writeCache(h, answer); writeCache(fh, answer); }
  }

  // Emit
  if (answer) {
    const lines = answer
      .split(/\n+/)
      .map(l => l.replace(/^\s*[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    const out = [
      '[AURAMAXING NLM-RECALL]',
      `via=${source}`,
      ...lines.slice(0, Number(process.env.AURA_NLM_MAX_BULLETS || 3))
             .map(l => `- ${l.slice(0, Number(process.env.AURA_NLM_MAX_BULLET_CHARS || 180))}`),
      '[/AURAMAXING NLM-RECALL]',
    ].join('\n');
    process.stdout.write(out + '\n');
  }

  // Fire-and-forget: prefetch turn N+1 predicted query
  try {
    if (existsSync(PREFETCH)) {
      const child = spawn('node', [PREFETCH, prompt, cwd], {
        detached: true, stdio: 'ignore',
        env: { ...process.env, PATH: pythonEnv().PATH },
      });
      child.unref();
    }
  } catch {}

  process.exit(0);
}

main().catch(() => process.exit(0));
