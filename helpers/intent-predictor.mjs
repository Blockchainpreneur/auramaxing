#!/usr/bin/env node
/**
 * AURAMAXING Session Intent Predictor
 *
 * Analyzes recent sessions and predicts what the user will work on next.
 * Uses NLM for smart prediction when available, falls back to pattern analysis.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const CACHE_DIR = join(HOME, '.auramaxing', 'prompt-cache');
const NLM_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
const NB_ID_FILE = join(HOME, '.auramaxing', 'nlm-notebook-id');

mkdirSync(CACHE_DIR, { recursive: true });

// ── Collect recent session entries (last 10) ──────────────────────────────────

const sessions = [];
const prompts = [];

try {
  if (existsSync(MEMORY_DIR)) {
    const allFiles = readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .sort();

    for (const f of allFiles) {
      try {
        const data = JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8'));
        if (data.type === 'session') {
          sessions.push(data);
        } else if (data.type === 'prompt') {
          prompts.push(data);
        }
      } catch {}
    }
  }
} catch {}

const recentSessions = sessions.slice(-10);
const recentPrompts = prompts.slice(-5);

// ── Extract patterns ──────────────────────────────────────────────────────────

// 1. Task type frequency
const taskFreq = {};
for (const s of recentSessions) {
  const t = s.task || 'unknown';
  taskFreq[t] = (taskFreq[t] || 0) + 1;
}
const sortedTasks = Object.entries(taskFreq).sort((a, b) => b[1] - a[1]);
const mostCommonTask = sortedTasks[0]?.[0] || 'unknown';
const mostCommonCount = sortedTasks[0]?.[1] || 0;

// 2. Most recent session info
const lastSession = recentSessions[recentSessions.length - 1];
const lastTask = lastSession?.task || 'unknown';
const lastLabel = lastSession?.label || 'unknown task';
const lastCwd = lastSession?.cwd || '';
const lastFiles = lastSession?.files || [];

// 3. Most recent project (extract from cwd)
const lastProject = lastCwd ? lastCwd.split('/').pop() : 'unknown';

// 4. Detect sequential patterns (what typically follows what)
const transitions = {};
for (let i = 0; i < recentSessions.length - 1; i++) {
  const from = recentSessions[i].task || 'unknown';
  const to = recentSessions[i + 1].task || 'unknown';
  const key = `${from}->${to}`;
  transitions[key] = (transitions[key] || 0) + 1;
}

// Find most likely next task based on transitions from last task
let predictedFromPattern = null;
let patternConfidence = 0;
const relevantTransitions = Object.entries(transitions)
  .filter(([k]) => k.startsWith(`${lastTask}->`))
  .sort((a, b) => b[1] - a[1]);

if (relevantTransitions.length > 0) {
  const [transition, count] = relevantTransitions[0];
  predictedFromPattern = transition.split('->')[1];
  patternConfidence = count / recentSessions.length;
}

// 5. Recently touched files (unique, last 3 sessions)
const recentFiles = [];
for (const s of recentSessions.slice(-3)) {
  for (const f of (s.files || [])) {
    if (!recentFiles.includes(f)) recentFiles.push(f);
  }
}

// 6. Last prompt content
const lastPrompt = recentPrompts[recentPrompts.length - 1]?.content || '';

// ── Generate prediction ───────────────────────────────────────────────────────

let prediction = '';

// Try NLM first if available
let nlmUsed = false;
try {
  if (existsSync(NB_ID_FILE)) {
    const nbId = readFileSync(NB_ID_FILE, 'utf8').trim().slice(0, 8);
    execSync(`${NLM_BIN} use ${nbId}`, { timeout: 5000, stdio: 'ignore' });

    const context = [
      `Last 10 sessions task types: ${sortedTasks.map(([t, c]) => `${t}(${c})`).join(', ')}`,
      `Last session: "${lastLabel}" in project "${lastProject}"`,
      lastFiles.length > 0 ? `Recent files: ${lastFiles.slice(0, 5).join(', ')}` : '',
      lastPrompt ? `Last prompt: "${lastPrompt.slice(0, 100)}"` : '',
      predictedFromPattern ? `Pattern detected: after ${lastTask}, user usually does ${predictedFromPattern}` : '',
    ].filter(Boolean).join('. ');

    const result = execSync(
      `${NLM_BIN} ask "Based on this user's recent coding sessions, predict in 1-2 sentences what they will work on next. Be specific. Context: ${context.replace(/"/g, '\\"').slice(0, 800)}"`,
      { encoding: 'utf8', timeout: 30000 }
    ).trim();

    const answer = result.split('Answer:').pop()?.trim() || result;
    if (answer && answer.length > 15) {
      prediction = answer.slice(0, 200);
      nlmUsed = true;
    }
  }
} catch {}

// Fallback: pattern-based prediction
if (!prediction) {
  const parts = [];

  if (predictedFromPattern && patternConfidence > 0.2) {
    parts.push(`Based on your recent pattern, you'll likely work on ${predictedFromPattern.replace(/-/g, ' ')}`);
  } else if (mostCommonTask !== 'unknown') {
    parts.push(`Based on your recent pattern, you'll likely work on ${mostCommonTask.replace(/-/g, ' ')}`);
  }

  if (lastLabel && lastLabel !== 'unknown task') {
    parts.push(`Last session: ${lastLabel} (${lastProject})`);
  } else if (lastTask !== 'unknown') {
    parts.push(`Last session: ${lastTask.replace(/-/g, ' ')} in ${lastProject}`);
  }

  if (recentFiles.length > 0) {
    const shortFiles = recentFiles.slice(0, 2).map(f => f.split('/').pop());
    parts.push(`Recently touched: ${shortFiles.join(', ')}`);
  }

  prediction = parts.join('. ') + '.';
}

// ── Save prediction ───────────────────────────────────────────────────────────

if (prediction && prediction.length > 5) {
  writeFileSync(join(CACHE_DIR, 'session-prediction.txt'), prediction);
  process.stderr.write(`[intent-predictor] Prediction saved (${nlmUsed ? 'NLM' : 'pattern'}, ${prediction.length} chars)\n`);
} else {
  process.stderr.write('[intent-predictor] Not enough data to generate prediction\n');
}
