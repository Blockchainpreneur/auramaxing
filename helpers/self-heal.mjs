#!/usr/bin/env node
/**
 * AURAMXING Self-Healing Engine
 *
 * When a tool/approach fails, this module:
 * 1. Logs the failure
 * 2. Checks ~/.auramxing/learnings/ for a known working strategy
 * 3. Suggests up to 3 alternative approaches
 * 4. When a strategy succeeds, logs it as a learning for next time
 *
 * Usage (from other hooks):
 *   import { recordFailure, recordSuccess, getBestStrategy } from './self-heal.mjs';
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LEARNINGS_DIR = join(homedir(), '.auramxing', 'learnings');
mkdirSync(LEARNINGS_DIR, { recursive: true });

/**
 * Record a failure — stores what failed and why
 */
export function recordFailure(context) {
  const { task, tool, error, attempt = 1 } = context;
  const ts = new Date().toISOString();
  const key = `${task}-${tool}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 50);

  const entry = {
    ts, key, task, tool, error: String(error).slice(0, 200),
    attempt, type: 'failure',
  };

  const file = join(LEARNINGS_DIR, `${key}-failure.json`);
  let existing = [];
  try { existing = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(existing)) existing = [existing]; } catch {}
  existing.push(entry);
  writeFileSync(file, JSON.stringify(existing.slice(-10), null, 2));

  return entry;
}

/**
 * Record a success — stores what worked so it's used first next time
 */
export function recordSuccess(context) {
  const { task, tool, strategy, duration = 0 } = context;
  const ts = new Date().toISOString();
  const key = `${task}-${tool}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 50);

  const entry = {
    ts, key, task, tool, strategy, duration,
    type: 'success', confidence: 8,
  };

  const file = join(LEARNINGS_DIR, `${key}-success.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2));

  return entry;
}

/**
 * Get the best strategy for a task+tool combination
 * Returns the last successful strategy if one exists, null otherwise
 */
export function getBestStrategy(task, tool) {
  const key = `${task}-${tool}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 50);
  const successFile = join(LEARNINGS_DIR, `${key}-success.json`);

  try {
    if (existsSync(successFile)) {
      const data = JSON.parse(readFileSync(successFile, 'utf8'));
      return {
        strategy: data.strategy,
        confidence: data.confidence || 5,
        lastUsed: data.ts,
      };
    }
  } catch {}

  return null;
}

/**
 * Get alternative strategies for a task type
 * Returns ordered list of strategies to try
 */
export function getAlternatives(task) {
  const strategies = {
    'form-fill': [
      { name: 'playwright-fill', desc: 'Use Playwright .fill() with real keystrokes' },
      { name: 'evaluate-setter', desc: 'Use page.evaluate with native value setter' },
      { name: 'keyboard-type', desc: 'Click field + keyboard.type() character by character' },
    ],
    'browser-nav': [
      { name: 'cdp-direct', desc: 'Connect via CDP to existing Chrome' },
      { name: 'applescript', desc: 'Use osascript to open tabs in user Chrome' },
      { name: 'playwright-launch', desc: 'Launch new Playwright browser' },
    ],
    'api-call': [
      { name: 'cli-tool', desc: 'Use the CLI tool directly via Bash' },
      { name: 'curl', desc: 'Raw curl/fetch request' },
      { name: 'mcp', desc: 'Use MCP server as last resort' },
    ],
    'web-scrape': [
      { name: 'firecrawl-cli', desc: 'Use firecrawl CLI for structured extraction' },
      { name: 'playwright-eval', desc: 'Use Playwright to evaluate JS on page' },
      { name: 'curl-parse', desc: 'curl + parse HTML manually' },
    ],
  };

  return strategies[task] || [
    { name: 'direct', desc: 'Try the direct approach first' },
    { name: 'alternative', desc: 'Try an alternative tool' },
    { name: 'manual', desc: 'Fall back to manual steps' },
  ];
}

/**
 * Get synthesized learnings from pre-computed cache.
 * Returns a compact string with 5 rules, or null if unavailable.
 */
export function getSynthesizedLearnings() {
  const synthPath = join(homedir(), '.auramxing', 'prompt-cache', 'learnings-synthesis.txt');
  try {
    if (existsSync(synthPath)) {
      const age = Date.now() - statSync(synthPath).mtimeMs;
      if (age < 86400000) { // 24hr TTL
        return readFileSync(synthPath, 'utf8').trim();
      }
    }
  } catch {}
  return null; // caller falls back to getAllLearnings()
}

/**
 * Get all learnings summary
 */
export function getAllLearnings() {
  try {
    const files = readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.json'));
    const learnings = [];
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(LEARNINGS_DIR, f), 'utf8'));
        if (Array.isArray(data)) {
          learnings.push(...data);
        } else {
          learnings.push(data);
        }
      } catch {}
    }
    return learnings;
  } catch { return []; }
}

// If run directly, show all learnings
if (process.argv[1]?.endsWith('self-heal.mjs') && !process.argv[2]) {
  const learnings = getAllLearnings();
  const successes = learnings.filter(l => l.type === 'success');
  const failures = learnings.filter(l => l.type === 'failure');
  console.log(`Learnings: ${successes.length} successes, ${failures.length} failures`);
  for (const s of successes) {
    console.log(`  ✓ ${s.key}: ${s.strategy} (confidence: ${s.confidence})`);
  }
}
