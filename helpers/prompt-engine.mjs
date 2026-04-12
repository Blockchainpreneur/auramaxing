#!/usr/bin/env node
/**
 * AURAMAXING Prompt Engine — FULLY AUTOMATED
 *
 * Runs on every prompt via Aura. Three auto-actions:
 * 1. Retrieves relevant memory via LightRAG semantic search
 * 2. Auto-calls NotebookLM for research/synthesis prompts (background, cached)
 * 3. Structures prompt with dynamic anti-laziness + quality gates
 *
 * All non-blocking. Max 3s total. Cached results are instant.
 */
import { execSync, execFileSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const LEARNINGS_DIR = join(HOME, '.auramaxing', 'learnings');
const NLM_CACHE = join(HOME, '.auramaxing', 'nlm-cache');
const NLM_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
const NLM_BRIDGE = join(HOME, 'auramaxing', 'helpers', 'notebooklm-bridge.mjs');
const NB_ID_FILE = join(HOME, '.auramaxing', 'nlm-notebook-id');
const PYTHON_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
const LIGHTRAG_CLI = join(HOME, 'auramaxing', 'scripts', 'lightrag-cli.py');
const LIGHTRAG_WORKSPACE = join(HOME, '.auramaxing', 'lightrag-workspace');
const PROMPT_CACHE = join(HOME, '.auramaxing', 'prompt-cache');

mkdirSync(MEMORY_DIR, { recursive: true });
mkdirSync(LEARNINGS_DIR, { recursive: true });
mkdirSync(NLM_CACHE, { recursive: true });

// ── Read prompt ─────────────────────────────────────────────────
let prompt = '';
try {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString().trim();
    if (raw) {
      try { const p = JSON.parse(raw); prompt = p.prompt || p.user_prompt || raw; }
      catch { prompt = raw; }
    }
  }
} catch {}
if (!prompt) prompt = process.argv[2] || '';
if (!prompt || prompt.length < 5) process.exit(0);

const promptLower = prompt.toLowerCase();

// ── 1. AUTO: Memory retrieval via LightRAG semantic search ──────
let memoryContext = '';
let lightragResults = [];
try {
  // Priority 1: LightRAG semantic search (replaces keyword matching)
  try {
    const result = execFileSync(PYTHON_BIN, [
      LIGHTRAG_CLI, 'query',
      '--workspace', LIGHTRAG_WORKSPACE,
      '--query', prompt.slice(0, 300),
      '--top-k', '3',
    ], {
      encoding: 'utf8',
      timeout: 6000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim();
    lightragResults = JSON.parse(result);
  } catch {}

  if (lightragResults.length > 0) {
    memoryContext = lightragResults
      .map(r => `[${r.ts?.slice(0, 10) || 'memory'}] ${r.text?.slice(0, 120) || ''}`)
      .join('\n');
  } else {
    // Fallback: compressed summary + keyword matching (legacy behavior)
    const summaryFile = join(MEMORY_DIR, '_compressed-summary.json');
    if (existsSync(summaryFile)) {
      try {
        const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
        if (summary.content) memoryContext = '[Session briefing]: ' + summary.content.slice(0, 300);
      } catch {}
    }

    const words = promptLower.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      const memFiles = existsSync(MEMORY_DIR)
        ? readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().slice(-10)
        : [];
      const relevant = [];
      for (const f of memFiles) {
        try {
          const data = JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8'));
          const content = JSON.stringify(data).toLowerCase();
          const matches = words.filter(w => content.includes(w)).length;
          if (matches >= 2) relevant.push({ ...data, relevance: matches });
        } catch {}
      }
      relevant.sort((a, b) => b.relevance - a.relevance);
      if (relevant.length > 0) {
        memoryContext += '\n' + relevant.slice(0, 2)
          .map(m => `[${m.ts?.slice(0, 10) || '?'}] ${m.content || m.summary || ''}`)
          .join('\n');
      }
    }
  }

  // Check synthesized learnings first, fall back to raw
  const synthFile = join(PROMPT_CACHE, 'learnings-synthesis.txt');
  let learningSynth = '';
  try {
    if (existsSync(synthFile)) {
      const age = Date.now() - statSync(synthFile).mtimeMs;
      if (age < 86400000) learningSynth = readFileSync(synthFile, 'utf8').trim();
    }
  } catch {}

  if (learningSynth) {
    memoryContext += `\n[Learned strategies]: ${learningSynth.slice(0, 200)}`;
  } else {
    const learnFiles = existsSync(LEARNINGS_DIR) ? readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.json')) : [];
    for (const f of learnFiles) {
      try {
        const data = JSON.parse(readFileSync(join(LEARNINGS_DIR, f), 'utf8'));
        if (data.type === 'success' && data.strategy) {
          if (promptLower.includes(data.task) || promptLower.includes(data.tool)) {
            memoryContext += `\n[Learned]: ${data.strategy} (confidence: ${data.confidence}/10)`;
          }
        }
      } catch {}
    }
  }
} catch {}

// ── 2. AUTO: NotebookLM delegation ──────────────────────────────
// Research/synthesis/analysis prompts auto-call NLM in background
// Results cached for 1hr. Cached results injected immediately.
let nlmResult = '';
try {
  const isResearch = /\b(research|find out|search for|compare|analyze|what is|how does|competitive|market|trends|best practices)\b/i.test(prompt);
  const isDocAnalysis = /\b(summarize|analyze this|review this|what does this say|read this)\b/i.test(prompt);
  const isSynthesis = /\b(explain|why|how to|what are the|give me|list the|describe)\b/i.test(prompt);

  if (isResearch || isDocAnalysis || isSynthesis) {
    const cacheKey = prompt.replace(/[^a-z0-9]/gi, '-').slice(0, 50);
    const cacheFile = join(NLM_CACHE, `${cacheKey}.txt`);

    // Check cache (1hr TTL)
    if (existsSync(cacheFile)) {
      const age = Date.now() - statSync(cacheFile).mtimeMs;
      if (age < 3600000) {
        nlmResult = readFileSync(cacheFile, 'utf8').trim();
      }
    }

    // If no cache hit, spawn NLM in background (non-blocking)
    if (!nlmResult && existsSync(NB_ID_FILE)) {
      const nbId = readFileSync(NB_ID_FILE, 'utf8').trim().slice(0, 8);
      // Fire and forget — result will be cached for next time
      try {
        const child = spawn(NLM_BIN, ['ask', prompt.slice(0, 200)], {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...process.env, PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}` },
          timeout: 25000,
        });
        // Capture output and cache it
        let output = '';
        child.stdout.on('data', d => { output += d.toString(); });
        child.on('close', () => {
          const answer = output.split('Answer:').pop()?.trim() || output.trim();
          if (answer.length > 20) {
            try { writeFileSync(cacheFile, answer); } catch {}
          }
        });
        child.unref();
      } catch {}
    }

    // If we have cached result, inject it
    if (nlmResult) {
      memoryContext += `\n[NotebookLM]: ${nlmResult.slice(0, 500)}`;
    }
  }
} catch {}

// Deep recall via NLM when LightRAG results are weak
if (lightragResults.length === 0 || (lightragResults.length > 0 && lightragResults[0].score < 0.4)) {
  try {
    const NLM_BIN_PATH = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
    const NB_ID = join(HOME, '.auramaxing', 'nlm-notebook-id');
    if (existsSync(NB_ID)) {
      const deepResult = execSync(
        `${NLM_BIN_PATH} ask "Based on all stored session knowledge and progress, what is relevant context for this task: ${prompt.slice(0, 200).replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      const answer = deepResult.split('Answer:').pop()?.trim() || deepResult;
      if (answer && answer.length > 30 && !answer.includes('Error:')) {
        memoryContext += `\n[NLM deep recall]: ${answer.slice(0, 300)}`;
      }
    }
  } catch {}
}

// ── 3. AUTO: Prompt structuring with dynamic anti-laziness ──────
let structuredPrompt = prompt;
try {
  // Static patterns as fallback
  const staticPatterns = [
    { test: /^(fix|update|change|modify)\s/i, type: 'bug-fix', add: 'Read the code first. Show root cause before patching. Write regression test.' },
    { test: /^(build|create|make|add)\s/i, type: 'new-feature', add: 'Include: input validation, error states, loading states, edge cases, tests.' },
    { test: /^(check|review|look at)\s/i, type: 'code-review', add: 'Read every file involved. List findings with file:line references.' },
    { test: /^(deploy|ship|push)\s/i, type: 'deploy-ship', add: 'Pre-deploy: tests, diff review, secrets check. Post-deploy: canary.' },
    { test: /^(test|qa|verify)\s/i, type: 'e2e-testing', add: 'Test: happy path, error paths, edge cases, mobile. Show evidence.' },
    { test: /^(research|find|search)\s/i, type: 'research', add: 'Multiple sources. Verify claims. Note conflicts. Cite sources.' },
    { test: /^(design|ui|ux)\s/i, type: 'design', add: 'Mobile-first. Dark mode. Loading/empty/error states. WCAG 2.1.' },
  ];

  for (const p of staticPatterns) {
    if (p.test.test(prompt)) {
      // Try dynamic anti-laziness from pre-computed cache
      let antiLazy = '';
      try {
        const cacheFile = join(PROMPT_CACHE, `anti-laziness-${p.type}.txt`);
        if (existsSync(cacheFile)) {
          const age = Date.now() - statSync(cacheFile).mtimeMs;
          if (age < 86400000) { // 24hr TTL
            antiLazy = readFileSync(cacheFile, 'utf8').trim();
          }
        }
      } catch {}

      structuredPrompt += `\n[anti-laziness]: ${antiLazy || p.add}`;
      break;
    }
  }

  if (memoryContext) structuredPrompt += `\n[past context]:\n${memoryContext}`;
  structuredPrompt += '\n[quality]: Do the COMPLETE thing. Verify claims. Show evidence.';

  // ── MANDATORY: gstack planning enforcement on every prompt ──
  // Forces structured thinking: analyze → plan → execute → verify
  const planningGate = [
    '[PLANNING GATE]: Before executing, you MUST:',
    '1. State what you understand the task to be (1 sentence)',
    '2. Identify what files/systems are involved',
    '3. Describe your approach (not "I\'ll look at it" — the ACTUAL steps)',
    '4. Execute with evidence at each step',
    '5. Verify the result works before reporting done',
    'Skip this gate ONLY for pure questions with no action needed.',
  ].join('\n');
  structuredPrompt += `\n${planningGate}`;
} catch {}

// ── 4. AUTO: Save prompt to memory + ingest to vector index ─────
try {
  const ts = new Date().toISOString();
  const promptEntry = { ts, type: 'prompt', content: prompt.slice(0, 300), cwd: process.cwd() };
  writeFileSync(
    join(MEMORY_DIR, `${ts.slice(0, 10)}-${ts.slice(11, 19).replace(/:/g, '')}-prompt.json`),
    JSON.stringify(promptEntry)
  );

  // Background ingest into vector index (non-blocking)
  try {
    const child = spawn(PYTHON_BIN, [
      LIGHTRAG_CLI, 'ingest', '--workspace', LIGHTRAG_WORKSPACE,
    ], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    child.stdin.write(JSON.stringify([promptEntry]));
    child.stdin.end();
    child.unref();
  } catch {}
} catch {}

// ── Output ──────────────────────────────────────────────────────
if (structuredPrompt !== prompt) {
  // Output only the enrichment (anti-laziness + context + quality), not the original prompt
  const enrichment = structuredPrompt.slice(prompt.length);
  if (enrichment.trim()) {
    process.stdout.write(`[AURAMAXING PROMPT-ENGINE]\n${enrichment.trim()}\n[/AURAMAXING PROMPT-ENGINE]\n`);
  }
}

process.exit(0);
