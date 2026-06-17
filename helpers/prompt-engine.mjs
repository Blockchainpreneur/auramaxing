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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, openSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { findPython, findNlm, findNlmArgs, pythonEnv } from "./find-bin.mjs";

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const LEARNINGS_DIR = join(HOME, '.auramaxing', 'learnings');
const NLM_CACHE = join(HOME, '.auramaxing', 'nlm-cache');
const NLM_BIN = findNlm();
if (!NLM_BIN) { process.stderr.write('[nlm] NotebookLM CLI not installed. Skipping.\n'); }
const NLM_BRIDGE = join(HOME, 'auramaxing', 'helpers', 'notebooklm-bridge.mjs');
const NB_ID_FILE = join(HOME, '.auramaxing', 'nlm-notebook-id');
const PYTHON_BIN = findPython();
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
  // Priority 1: LightRAG semantic search (replaces keyword matching).
  // Skipped under AURA_PE_FAST (eval/test mode) — this Python subprocess is the slow,
  // non-deterministic part; the structuring/gate logic below does not depend on it.
  if (!process.env.AURA_PE_FAST) try {
    const result = execFileSync(PYTHON_BIN, [
      LIGHTRAG_CLI, 'query',
      '--workspace', LIGHTRAG_WORKSPACE,
      '--query', prompt.slice(0, 300),
      '--top-k', '3',
    ], {
      encoding: 'utf8',
      timeout: 1800,  // must fit the 3s UserPromptSubmit budget (was 6000 → outer execSync killed it → semantic memory never fired). Finding #1.
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
        // Structured bin+args — spawn() does not shell-split "python3 -m notebooklm". Finding #3.
        const { bin: nlmBin, args: nlmBase = [] } = findNlmArgs() || {};
        if (nlmBin) {
          // Write the child's stdout STRAIGHT to the cache file via a redirected fd.
          // The parent hits process.exit(0) within ms, so an in-parent 'close' handler
          // never fires — the detached child must own the write itself.
          const cacheFd = openSync(cacheFile, 'w');
          const child = spawn(nlmBin, [...nlmBase, 'ask', prompt.slice(0, 200)], {
            detached: true,
            stdio: ['ignore', cacheFd, 'ignore'],
            env: { ...process.env, PATH: pythonEnv().PATH },
            timeout: 25000,
          });
          child.unref();
        }
      } catch {}
    }

    // If we have cached result, inject it
    if (nlmResult) {
      memoryContext += `\n[NotebookLM]: ${nlmResult.slice(0, 500)}`;
    }
  }
} catch {}

// Deep recall via NLM when LightRAG returned nothing (cold start / failure / disabled). Finding #2.
// NON-BLOCKING: serve a cached deep-recall answer instantly; otherwise populate it in the
// background so the NEXT prompt benefits. A synchronous NLM call here would blow the 3s hook
// budget and silently kill all routing (the Finding #4 failure mode) — so we never run one.
if (lightragResults.length === 0) {
  try {
    const drCache = join(NLM_CACHE, 'deep-recall.txt');
    const NB_ID = join(HOME, '.auramaxing', 'nlm-notebook-id');
    if (existsSync(drCache) && (Date.now() - statSync(drCache).mtimeMs) < 3600000) {
      const cached = readFileSync(drCache, 'utf8').trim();
      if (cached.length > 30) memoryContext += `\n[NLM deep recall]: ${cached.slice(0, 300)}`;
    } else if (NLM_BIN && existsSync(NB_ID)) {
      const { bin: drBin, args: drBase = [] } = findNlmArgs() || {};
      if (drBin) {
        const q = `Based on all stored session knowledge and progress, what is relevant context for this task: ${prompt.slice(0, 200)}`;
        const child = spawn(drBin, [...drBase, 'ask', q], {
          detached: true, stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...process.env, PATH: pythonEnv().PATH }, timeout: 25000,
        });
        let out = '';
        child.stdout.on('data', d => { out += d.toString(); });
        child.on('close', () => {
          const answer = out.split('Answer:').pop()?.trim() || out.trim();
          if (answer && answer.length > 30 && !answer.includes('Error:')) {
            try { writeFileSync(drCache, answer); } catch {}
          }
        });
        child.unref();
      }
    }
  } catch {}
}

// ── 3. AUTO: Prompt structuring with dynamic anti-laziness ──────
let structuredPrompt = prompt;
try {
  // Static patterns as fallback
  const staticPatterns = [
    { test: /^(fix|update|change|modify)\s/i, type: 'bug-fix', add: 'Read the full code path first. Find and STATE the root cause with file:line BEFORE touching anything — no symptom patch, no guess. Write a regression test that fails before / passes after; RUN it and paste the output.' },
    { test: /^(build|create|make|add)\s/i, type: 'new-feature', add: 'Build COMPLETE: input validation, error/empty/loading states, edge cases, accessibility, tests. No placeholders/TODOs. RUN it (build + tests) and show it working before claiming done.' },
    { test: /^(check|review|look at)\s/i, type: 'code-review', add: 'Read EVERY file involved fully. List findings with file:line + a concrete fix each. Verify every claim against the code — no hand-waving.' },
    { test: /^(deploy|ship|push)\s/i, type: 'deploy-ship', add: 'Pre-deploy: RUN tests + diff review + /cso secrets check (paste results). Post-deploy: /canary. Have a rollback plan.' },
    { test: /^(test|qa|verify)\s/i, type: 'e2e-testing', add: 'Test happy path + error paths + edge cases + mobile. RUN the suite and paste real output — never assert "passes" without the run.' },
    { test: /^(research|find|search)\s/i, type: 'research', add: 'Multiple independent sources. Verify each claim; adversarially check the surprising ones. Note conflicts. Cite every source. No unsourced assertions.' },
    { test: /\b(design|redesign|ui|ux|dashboard|landing page|interface|dark mode|responsive|css|layout|frontend|front-end|figma|tailwind|shadcn)\b/i, type: 'design', add: 'Invoke front-10x. Cinematic anchor, always-on tournament, start from ~/auramaxing/design-kit/. Screenshot + vision-QA loop. Mobile-first, dark mode, all states, WCAG 2.1.' },
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
      structuredPrompt += '\n[autonomous mandate]: You do it all — never depend on the user. Deep think → investigate → plan via gstack → execute → full audit → test + review. If changes are needed, restart this chain. Do NOT stop until the result is truly exceptional, immersive, and smooth. Do NOT stop until absolute greatness. No partial deliveries. No "good enough." No asking the user to verify what you can verify yourself.';
      break;
    }
  }

  if (memoryContext) structuredPrompt += `\n[past context]:\n${memoryContext}`;
  structuredPrompt += '\n[quality]: Do the COMPLETE thing. Verify claims. Show evidence.';
  // Principles distilled from auditing Anthropic's published Claude system prompt (2026-06-14):
  // the few transferable rules AURAMAXING under-enforced. Concise on purpose.
  structuredPrompt += '\n[skill-first]: When a phase maps to a gstack/AURAMAXING skill, READ that skill\'s SKILL.md (and the files it references) BEFORE composing the action — skills encode environment constraints, contracts, and tool quirks that are NOT in training data. Never invoke a skill blind or guess its inputs/outputs/preconditions.';
  structuredPrompt += '\n[substance-first]: Lead with the result + evidence. Address the user as an expert peer — no flattery, no filler, no hedging, no narrating what you are about to do. Do NOT ask for clarification when intent is clear. Ceremony (boxes/headers/banners) NEVER substitutes for substance; calibrate verbosity to the task, not to appearances.';
  structuredPrompt += '\n[no-confabulation]: NEVER invent a file:line, API/method signature, command output, citation, metric, or test result — verify it against the real source/run, or omit it and say so. State uncertainty explicitly; confidence must scale to what you have ACTUALLY verified THIS turn (an unverified claim is treated as FALSE).';
  // ── MANDATORY: Phased Excellence Loop — forced on every actionable prompt ──
  // gstack route → phases → per-phase opening steps → per-phase verify loop → final verify loop.
  const phasedLoop = [
    '[PHASED EXCELLENCE LOOP — MANDATORY, NON-NEGOTIABLE]: Operate extended. Do NOT shortcut, do NOT stop early, do NOT hand work back to the user. gstack is IMPLICIT in EVERY task — always route through it.',
    '0. ROUTE through gstack. Decompose the task into explicit PHASES; track them with TaskCreate. ALL phases live inside THIS task. Auto-INJECT supporting sub-tasks for each phase: (i) tool/repo/skill SEARCH, (ii) investigation/research, (iii) reference EXAMPLES — and complete them before EXECUTE.',
    'For EVERY phase, run the SAME opening sequence — no phase skips a step:',
    '  a. AUDIT — inspect the current real state of what this phase touches.',
    '  b. INVESTIGATE — read every relevant file completely; verify APIs/behaviors via context7/deepwiki + Grep/Explore/WebSearch; gather real reference EXAMPLES / proven implementations; never guess.',
    '  c. PLAN (ultrathink) — run INVESTIGATE + PLAN under EXTENDED THINKING (ultrathink): reason through 2-3 candidate approaches and pick the best WITH explicit reasons; state the full phase approach. CLARITY GATE: do NOT write a single line of code until the strategy is airtight and you can explain WHY it is correct.',
    '  d. SELECT THE BEST — actively SEARCH and COMPARE candidate tools, repos and skills (ToolSearch + ~/auramaxing/docs/CAPABILITIES.md registry + WebSearch for best-in-class); pick the BEST fit, not merely an available one; install FREE skills/MCP on a capability gap. gstack skills are always in scope.',
    '  e. EXECUTE — build the COMPLETE thing: states, errors, edge cases, tests. ROOT-CAUSE fixes only — never a symptom patch, never a vague/temporary workaround. No placeholders, no partials.',
    'After EACH phase: TEST + VERIFY + REVIEW WITH EVIDENCE — actually RUN the tests/build/typecheck/lint (or /qa + /review + /cso) and QUOTE the output; state the root cause with file:line; add a regression test. Then ADVERSARIALLY VERIFY: a separate skeptic pass tries to BREAK the result (self-rating is too generous); default to "not done" if uncertain. SCORE 0–100 HONESTLY against that evidence.',
    '  → If < 100/100: fix and LOOP back into this phase. Do NOT advance until this phase is 100/100 WITH evidence.',
    'After ALL phases: run the SAME full evidence-backed TEST + VERIFY + REVIEW across the ENTIRE deliverable; SCORE 0–100.',
    '  → LOOP until 100/100. NEVER stop until absolute greatness at the highest standard, PROVEN by evidence.',
    'BANNED: "should work", "I think", "probably", "this should fix it", declaring done without running it, leaving a TODO/placeholder, a fix you have not re-run. A claim without evidence is treated as FALSE.',
    'No "good enough". No partial delivery. No asking the user to verify what you can verify yourself.',
    'Skip this loop ONLY for a pure question with zero actions needed.',
  ].join('\n');
  // Gate: rational-router-apex emits its own phased loop for complexity ≥30 (full ≥50, condensed
  // 30–49). Only emit here when the router won't (<30), to avoid duplicating ~375 tokens/prompt
  // (Finding #5). When run standalone (no router, AURA_COMPLEXITY unset → 0) the loop still fires.
  const _auraComplexity = parseInt(process.env.AURA_COMPLEXITY || '0', 10);
  if (_auraComplexity < 30) structuredPrompt += `\n${phasedLoop}`;
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
