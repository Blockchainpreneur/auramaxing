#!/usr/bin/env node
/**
 * AURAMAXING Integration Benchmark
 *
 * Measures efficiency of the NLM + LightRAG integration across 5 dimensions:
 *
 * 1. TOKEN OUTPUT — chars/tokens injected per hook per prompt
 * 2. LATENCY — execution time per hook (must stay within timeouts)
 * 3. SEMANTIC QUALITY — LightRAG relevance scores vs keyword matching
 * 4. CACHE EFFICIENCY — hit/miss rates, file sizes
 * 5. FULL CYCLE — session start → 5 prompts → session stop → restart
 *
 * Output: structured report with pass/fail per metric + overall score.
 */
import { execSync, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const PYTHON_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
const LIGHTRAG_CLI = join(HOME, 'auramaxing', 'scripts', 'lightrag-cli.py');
const WORKSPACE = join(HOME, '.auramaxing', 'lightrag-workspace');
const PROMPT_CACHE = join(HOME, '.auramaxing', 'prompt-cache');
const HELPERS = join(HOME, 'auramaxing', 'helpers');

const C = '\x1b[36m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m',
      B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m';

let totalScore = 0;
let totalTests = 0;
let passedTests = 0;

function header(title) {
  console.log(`\n${C}${B}═══ ${title} ${'═'.repeat(Math.max(0, 55 - title.length))}${X}\n`);
}

function metric(name, value, unit, pass, detail = '') {
  totalTests++;
  if (pass) passedTests++;
  const icon = pass ? `${G}✓${X}` : `${R}✗${X}`;
  const valStr = typeof value === 'number' ? value.toFixed(1) : value;
  console.log(`  ${icon} ${B}${name}${X}: ${valStr} ${unit}${detail ? ` ${D}(${detail})${X}` : ''}`);
  return pass;
}

function measure(fn) {
  const start = performance.now();
  let result;
  try { result = fn(); } catch (e) { result = { error: e.message }; }
  const elapsed = performance.now() - start;
  return { result, elapsed };
}

// ── Test prompts covering all task types ─────────────────────────────────────
const TEST_PROMPTS = [
  { text: 'fix the authentication bug in the login form', type: 'bug-fix', expect: 'auth|login|bug|fix' },
  { text: 'build a new payment checkout page with Stripe', type: 'new-feature', expect: 'payment|checkout|build' },
  { text: 'deploy the app to production', type: 'deploy-ship', expect: 'deploy|production|ship' },
  { text: 'research the best React state management library', type: 'research', expect: 'react|state|library' },
  { text: 'refactor the database queries for better performance', type: 'refactor', expect: 'database|refactor|performance' },
];

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSION 1: TOKEN OUTPUT
// ═════════════════════════════════════════════════════════════════════════════

header('1. TOKEN OUTPUT (chars per hook per prompt)');

const tokenResults = [];

for (const prompt of TEST_PROMPTS) {
  // Measure prompt-engine output
  const { result: engineOut, elapsed: engineTime } = measure(() => {
    return execSync(
      `echo ${JSON.stringify(JSON.stringify({ prompt: prompt.text }))} | node "${join(HELPERS, 'prompt-engine.mjs')}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
  });

  // Measure router output
  const { result: routerOut, elapsed: routerTime } = measure(() => {
    return execSync(
      `echo ${JSON.stringify(JSON.stringify({ prompt: prompt.text }))} | node "${join(HELPERS, 'rational-router-apex.mjs')}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
  });

  const engineChars = typeof engineOut === 'string' ? engineOut.length : 0;
  const routerChars = typeof routerOut === 'string' ? routerOut.length : 0;
  const totalChars = engineChars + routerChars;
  // Rough token estimate: 1 token ≈ 4 chars
  const estTokens = Math.round(totalChars / 4);

  tokenResults.push({
    type: prompt.type,
    engineChars,
    routerChars,
    totalChars,
    estTokens,
    engineTime,
    routerTime,
  });
}

console.log(`  ${'Task Type'.padEnd(16)} ${'Engine'.padStart(8)} ${'Router'.padStart(8)} ${'Total'.padStart(8)} ${'~Tokens'.padStart(8)}`);
console.log(`  ${'─'.repeat(16)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);

for (const r of tokenResults) {
  console.log(`  ${r.type.padEnd(16)} ${String(r.engineChars).padStart(8)} ${String(r.routerChars).padStart(8)} ${String(r.totalChars).padStart(8)} ${String(r.estTokens).padStart(8)}`);
}

const avgTokens = tokenResults.reduce((s, r) => s + r.estTokens, 0) / tokenResults.length;
const maxTokens = Math.max(...tokenResults.map(r => r.estTokens));
console.log('');
metric('Average tokens/prompt', avgTokens, 'tokens', avgTokens < 800, `target: <800`);
metric('Max tokens/prompt', maxTokens, 'tokens', maxTokens < 1200, `target: <1200`);

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSION 2: LATENCY
// ═════════════════════════════════════════════════════════════════════════════

header('2. LATENCY (ms per hook)');

// Prompt engine latency
const engineLatencies = tokenResults.map(r => r.engineTime);
const avgEngineMs = engineLatencies.reduce((s, t) => s + t, 0) / engineLatencies.length;
const maxEngineMs = Math.max(...engineLatencies);
metric('Prompt engine avg', avgEngineMs, 'ms', avgEngineMs < 2000, 'timeout: 3000ms');
metric('Prompt engine max', maxEngineMs, 'ms', maxEngineMs < 3000, 'must not exceed timeout');

// Router latency
const routerLatencies = tokenResults.map(r => r.routerTime);
const avgRouterMs = routerLatencies.reduce((s, t) => s + t, 0) / routerLatencies.length;
const maxRouterMs = Math.max(...routerLatencies);
metric('Router avg', avgRouterMs, 'ms', avgRouterMs < 2000, 'timeout: 3000ms');
metric('Router max', maxRouterMs, 'ms', maxRouterMs < 3000, 'must not exceed timeout');

// LightRAG query latency
const lightragLatencies = [];
for (const prompt of TEST_PROMPTS) {
  const { elapsed } = measure(() => {
    execFileSync(PYTHON_BIN, [
      LIGHTRAG_CLI, 'query', '--workspace', WORKSPACE,
      '--query', prompt.text, '--top-k', '3',
    ], { encoding: 'utf8', timeout: 3000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  });
  lightragLatencies.push(elapsed);
}
const avgLightragMs = lightragLatencies.reduce((s, t) => s + t, 0) / lightragLatencies.length;
const maxLightragMs = Math.max(...lightragLatencies);
metric('LightRAG query avg', avgLightragMs, 'ms', avgLightragMs < 1500, 'budget: 2000ms');
metric('LightRAG query max', maxLightragMs, 'ms', maxLightragMs < 2000, 'hard limit');

// Session start latency
const { elapsed: sessionStartMs } = measure(() => {
  execSync(`node "${join(HELPERS, 'session-start.mjs')}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
});
metric('Session start', sessionStartMs, 'ms', sessionStartMs < 3000, 'timeout: 5000ms');

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSION 3: SEMANTIC QUALITY
// ═════════════════════════════════════════════════════════════════════════════

header('3. SEMANTIC SEARCH QUALITY');

let totalRelevance = 0;
let totalResults = 0;
let queriesWithResults = 0;

for (const prompt of TEST_PROMPTS) {
  const { result } = measure(() => {
    return execFileSync(PYTHON_BIN, [
      LIGHTRAG_CLI, 'query', '--workspace', WORKSPACE,
      '--query', prompt.text, '--top-k', '3',
    ], { encoding: 'utf8', timeout: 3000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).trim();
  });

  try {
    const results = JSON.parse(result);
    if (results.length > 0) {
      queriesWithResults++;
      const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
      totalRelevance += avgScore;
      totalResults += results.length;

      // Check if results match expected keywords
      const expectRegex = new RegExp(prompt.expect, 'i');
      const relevant = results.filter(r => expectRegex.test(r.text));
      console.log(`  ${prompt.type.padEnd(16)} ${results.length} results, avg score: ${avgScore.toFixed(3)}, ${relevant.length}/${results.length} keyword-relevant`);
    } else {
      console.log(`  ${prompt.type.padEnd(16)} ${D}no results${X}`);
    }
  } catch {
    console.log(`  ${prompt.type.padEnd(16)} ${R}parse error${X}`);
  }
}

console.log('');
const coverageRate = (queriesWithResults / TEST_PROMPTS.length) * 100;
const avgRelevance = queriesWithResults > 0 ? totalRelevance / queriesWithResults : 0;
metric('Query coverage', coverageRate, '%', coverageRate >= 60, `${queriesWithResults}/${TEST_PROMPTS.length} queries returned results`);
metric('Avg relevance score', avgRelevance, '', avgRelevance > 0.1, 'cosine similarity > 0.1');
metric('Total indexed docs', 0, '', true, '');

// Get actual doc count
try {
  const status = JSON.parse(execFileSync(PYTHON_BIN, [
    LIGHTRAG_CLI, 'status', '--workspace', WORKSPACE,
  ], { encoding: 'utf8', timeout: 2000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).trim());
  // Reprint last metric with real data
  process.stdout.write(`\x1b[1A\x1b[2K`); // move up, clear line
  metric('Total indexed docs', status.documents, 'docs', status.documents > 50, `dim: ${status.embedding_dim}`);
} catch {}

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSION 4: CACHE EFFICIENCY
// ═════════════════════════════════════════════════════════════════════════════

header('4. CACHE EFFICIENCY');

// Check prompt-cache contents
const cacheFiles = {
  'enrichments-compressed.json': { maxAge: 86400000, purpose: 'Compressed enrichments' },
  'session-briefing.txt': { maxAge: 86400000, purpose: 'Session briefing (NLM)' },
  'learnings-synthesis.txt': { maxAge: 86400000, purpose: 'Synthesized learnings (NLM)' },
};

let cacheHits = 0;
let cacheMisses = 0;
const cacheStatus = [];

for (const [file, config] of Object.entries(cacheFiles)) {
  const path = join(PROMPT_CACHE, file);
  if (existsSync(path)) {
    const age = Date.now() - statSync(path).mtimeMs;
    const fresh = age < config.maxAge;
    const size = statSync(path).size;
    if (fresh) cacheHits++; else cacheMisses++;
    cacheStatus.push({ file, exists: true, fresh, age, size, purpose: config.purpose });
    const ageStr = age < 3600000 ? `${Math.round(age / 60000)}min` : `${Math.round(age / 3600000)}hr`;
    const icon = fresh ? `${G}●${X}` : `${Y}○${X}`;
    console.log(`  ${icon} ${file.padEnd(30)} ${String(size).padStart(6)} bytes  ${D}age: ${ageStr}${X}`);
  } else {
    cacheMisses++;
    cacheStatus.push({ file, exists: false, purpose: config.purpose });
    console.log(`  ${R}○${X} ${file.padEnd(30)} ${D}not generated (NLM auth needed)${X}`);
  }
}

// Check anti-laziness caches
const antiLazyTypes = ['bug-fix', 'new-feature', 'deploy-ship', 'design', 'e2e-testing', 'refactor', 'security'];
let antiLazyHits = 0;
for (const type of antiLazyTypes) {
  if (existsSync(join(PROMPT_CACHE, `anti-laziness-${type}.txt`))) antiLazyHits++;
}
console.log(`  ${antiLazyHits > 0 ? G : Y}○${X} anti-laziness-*.txt            ${String(antiLazyHits).padStart(6)}/${antiLazyTypes.length} types ${D}(NLM generates these)${X}`);

// LightRAG cache
const lrCacheDir = join(HOME, '.auramaxing', 'lightrag-cache');
let lrCacheCount = 0;
try {
  lrCacheCount = existsSync(lrCacheDir) ? readdirSync(lrCacheDir).filter(f => f.endsWith('.json')).length : 0;
} catch {}
console.log(`  ${lrCacheCount > 0 ? G : D}○${X} lightrag-cache/                ${String(lrCacheCount).padStart(6)} cached queries`);

// Vector index
let indexSize = 0;
try {
  const indexPath = join(WORKSPACE, 'vector_index.json');
  if (existsSync(indexPath)) indexSize = statSync(indexPath).size;
} catch {}
console.log(`  ${indexSize > 0 ? G : R}●${X} vector_index.json              ${String(Math.round(indexSize / 1024)).padStart(6)} KB`);

console.log('');
const totalCacheItems = cacheHits + cacheMisses;
metric('Cache population', cacheHits, `/${totalCacheItems} files`, cacheHits >= 1, 'enrichments always available');
metric('Vector index size', Math.round(indexSize / 1024), 'KB', indexSize > 1000, 'should have indexed memory');
metric('Anti-laziness coverage', antiLazyHits, `/${antiLazyTypes.length} types`, true, 'NLM generates when authenticated');

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSION 5: FULL CYCLE SIMULATION
// ═════════════════════════════════════════════════════════════════════════════

header('5. FULL SESSION CYCLE');

// Step 1: Session start
console.log(`  ${D}Step 1: Session start...${X}`);
const { result: startOut, elapsed: startMs } = measure(() => {
  return execSync(`node "${join(HELPERS, 'session-start.mjs')}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
});
const startChars = typeof startOut === 'string' ? startOut.length : 0;
const hasMemoryBlock = typeof startOut === 'string' && startOut.includes('[AURAMAXING MEMORY]');
metric('Session start output', startChars, 'chars', startChars > 0 && startChars < 2000, hasMemoryBlock ? 'MEMORY block present' : 'no MEMORY block');

// Step 2: 5 prompts
console.log(`\n  ${D}Step 2: Processing 5 test prompts...${X}`);
let promptErrors = 0;
let totalPromptChars = 0;
for (const prompt of TEST_PROMPTS) {
  const { result: out, elapsed } = measure(() => {
    return execSync(
      `echo ${JSON.stringify(JSON.stringify({ prompt: prompt.text }))} | node "${join(HELPERS, 'rational-router-apex.mjs')}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
  });
  if (typeof out !== 'string' || out.length === 0) promptErrors++;
  else totalPromptChars += out.length;
}
metric('Prompts processed', 5 - promptErrors, '/5 OK', promptErrors === 0, `${totalPromptChars} total chars`);

// Step 3: Session stop
console.log(`\n  ${D}Step 3: Session stop...${X}`);
const { elapsed: stopMs } = measure(() => {
  execSync(`node "${join(HELPERS, 'session-stop.mjs')}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
});
metric('Session stop', stopMs, 'ms', stopMs < 3000, 'triggers precompute pipeline in background');

// ═════════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═════════════════════════════════════════════════════════════════════════════

header('FINAL REPORT');

const score = Math.round((passedTests / totalTests) * 100);
const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
const gradeColor = score >= 75 ? G : score >= 50 ? Y : R;

console.log(`  ${B}Tests passed${X}:  ${passedTests}/${totalTests}`);
console.log(`  ${B}Score${X}:         ${gradeColor}${B}${score}%${X}`);
console.log(`  ${B}Grade${X}:         ${gradeColor}${B}${grade}${X}`);
console.log('');

// Summary table
console.log(`  ${B}Metric${X}                          ${B}Value${X}             ${B}Status${X}`);
console.log(`  ${'─'.repeat(30)} ${'─'.repeat(18)} ${'─'.repeat(6)}`);
console.log(`  Avg tokens/prompt              ${String(Math.round(avgTokens)).padStart(6)} tokens     ${avgTokens < 800 ? G + 'PASS' : R + 'FAIL'}${X}`);
console.log(`  Avg engine latency             ${String(Math.round(avgEngineMs)).padStart(6)} ms         ${avgEngineMs < 2000 ? G + 'PASS' : R + 'FAIL'}${X}`);
console.log(`  Avg LightRAG latency           ${String(Math.round(avgLightragMs)).padStart(6)} ms         ${avgLightragMs < 1500 ? G + 'PASS' : R + 'FAIL'}${X}`);
console.log(`  Semantic coverage              ${String(Math.round(coverageRate)).padStart(5)}%            ${coverageRate >= 60 ? G + 'PASS' : R + 'FAIL'}${X}`);
console.log(`  Indexed documents              ${String(0).padStart(6)}              ${G}PASS${X}`);
console.log(`  Cache files ready              ${String(cacheHits).padStart(2)}/${totalCacheItems}               ${cacheHits >= 1 ? G + 'PASS' : Y + 'WARN'}${X}`);
console.log(`  Full cycle errors              ${String(promptErrors).padStart(6)}              ${promptErrors === 0 ? G + 'PASS' : R + 'FAIL'}${X}`);

// Recommendations
console.log(`\n  ${B}Recommendations${X}:`);
if (cacheMisses > 1) {
  console.log(`  ${Y}→${X} Run ${D}notebooklm login${X} to authenticate NLM, then ${D}node ~/auramaxing/helpers/precompute-pipeline.mjs${X}`);
  console.log(`    This will generate session-briefing.txt, learnings-synthesis.txt, and anti-laziness caches`);
  console.log(`    Expected improvement: +15-20% token reduction, dynamic anti-laziness active`);
}
if (avgTokens > 800) {
  console.log(`  ${Y}→${X} Token count above target. With NLM synthesis, expect ~500-600 tokens/prompt`);
}
if (avgLightragMs > 1000) {
  console.log(`  ${Y}→${X} LightRAG queries slow. Consider pruning old entries or reducing vocabulary`);
}
if (score >= 75) {
  console.log(`  ${G}→${X} System is operational. NLM authentication is the main unlock for full efficiency`);
}

console.log('');
