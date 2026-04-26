#!/usr/bin/env node
/**
 * AURAMAXING NotebookLM Bridge — CLI integration
 *
 * Uses notebooklm CLI (Python 3.12) to offload reasoning from Claude.
 * Saves tokens by having NotebookLM do research, synthesis, and structuring.
 *
 * Usage:
 *   node notebooklm-bridge.mjs ask "question"          — ask NotebookLM
 *   node notebooklm-bridge.mjs structure "prompt"       — structure a prompt
 *   node notebooklm-bridge.mjs add-source <file>        — add a source document
 *   node notebooklm-bridge.mjs compress-memory          — compress session memory
 *   node notebooklm-bridge.mjs brief                    — session briefing
 *   node notebooklm-bridge.mjs store-knowledge          — store structured knowledge as NLM source (JSON via stdin)
 *   node notebooklm-bridge.mjs query-knowledge "q"      — query all stored session knowledge
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { findPython, findNlm, pythonEnv } from "./find-bin.mjs";

const HOME = homedir();
const NLM_BIN = findNlm();
if (!NLM_BIN) { process.stderr.write('[nlm] NotebookLM CLI not installed. Skipping.\n'); }
const CACHE_DIR = join(HOME, '.auramaxing', 'nlm-cache');
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const NB_ID_FILE = join(HOME, '.auramaxing', 'nlm-notebook-id');

mkdirSync(CACHE_DIR, { recursive: true });

const command = process.argv[2] || 'help';
const input = process.argv.slice(3).join(' ') || '';

function nlm(cmd) {
  try {
    return execSync(`${NLM_BIN} ${cmd}`, { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    return `[NLM error: ${e.message?.slice(0, 80)}]`;
  }
}

function ensureNotebook() {
  if (!existsSync(NB_ID_FILE)) {
    console.error('No NotebookLM notebook configured. Run: node notebooklm-bridge.mjs setup');
    process.exit(1);
  }
  const id = readFileSync(NB_ID_FILE, 'utf8').trim();
  nlm(`use ${id.slice(0, 8)}`);
  return id;
}

switch (command) {
  case 'ask': {
    ensureNotebook();
    // Check cache first
    const cacheKey = createHash('sha256').update(input.toLowerCase().trim()).digest('hex').slice(0, 16);
    const cacheFile = join(CACHE_DIR, `${cacheKey}.txt`);
    if (existsSync(cacheFile)) {
      const age = Date.now() - statSync(cacheFile).mtimeMs;
      if (age < 3600000) { // 1hr cache
        console.log(readFileSync(cacheFile, 'utf8'));
        break;
      }
    }
    const result = nlm(`ask "${input.replace(/"/g, '\\"')}"`);
    // Extract just the answer
    const answer = result.split('Answer:').pop()?.trim() || result;
    writeFileSync(cacheFile, answer);
    console.log(answer);
    break;
  }

  case 'structure': {
    ensureNotebook();
    const structuredPrompt = nlm(`ask "Structure this prompt for maximum precision. Add requirements a senior engineer would expect. Prevent lazy responses. The prompt is: ${input.replace(/"/g, '\\"')}"`);
    const answer = structuredPrompt.split('Answer:').pop()?.trim() || structuredPrompt;
    console.log(answer);
    break;
  }

  case 'add-source': {
    ensureNotebook();
    if (!existsSync(input)) { console.error('File not found:', input); break; }
    const result = nlm(`source add-text "${input.replace(/"/g, '\\"')}"`);
    console.log(result);
    break;
  }

  case 'compress-memory': {
    ensureNotebook();
    if (!existsSync(MEMORY_DIR)) { console.log('No memory.'); break; }
    const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
    const entries = files.map(f => { try { return JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8')); } catch { return null; } }).filter(Boolean);
    const raw = entries.map(e => `[${e.ts?.slice(0,10)}] ${e.type}: ${e.content || e.summary || ''}`).join('\n');

    const compressed = nlm(`ask "Compress these session logs into a 3-sentence briefing. Include: project, key decisions, current status, next actions: ${raw.slice(0, 2000).replace(/"/g, '\\"')}"`);
    const answer = compressed.split('Answer:').pop()?.trim() || compressed;

    writeFileSync(join(MEMORY_DIR, '_compressed-summary.json'), JSON.stringify({
      ts: new Date().toISOString(), type: 'compressed-summary',
      content: answer, entriesCompressed: entries.length,
    }, null, 2));
    console.log(answer);
    break;
  }

  case 'brief': {
    const summaryFile = join(MEMORY_DIR, '_compressed-summary.json');
    if (existsSync(summaryFile)) {
      console.log(JSON.parse(readFileSync(summaryFile, 'utf8')).content);
    } else {
      console.log('No briefing yet. Run: node notebooklm-bridge.mjs compress-memory');
    }
    break;
  }

  case 'setup': {
    console.log('Creating AURAMAXING Autopilot notebook...');
    const result = nlm('create "AURAMAXING Autopilot Memory"');
    const idMatch = result.match(/([a-f0-9-]{36})/);
    if (idMatch) {
      writeFileSync(NB_ID_FILE, idMatch[1]);
      console.log('Notebook created:', idMatch[1]);
    } else {
      console.log(result);
    }
    break;
  }

  case 'synthesize': {
    ensureNotebook();
    // Synthesize a specific type of content: learnings, briefing, anti-laziness
    const synthType = input || 'briefing';
    let sourceData = '';
    if (synthType === 'learnings') {
      const learnFiles = existsSync(join(HOME, '.auramaxing', 'learnings'))
        ? readdirSync(join(HOME, '.auramaxing', 'learnings')).filter(f => f.endsWith('.json'))
        : [];
      for (const f of learnFiles) {
        try {
          const data = JSON.parse(readFileSync(join(HOME, '.auramaxing', 'learnings', f), 'utf8'));
          if (Array.isArray(data)) {
            data.filter(d => d.type === 'success').forEach(d => {
              sourceData += `${d.tool}: ${d.strategy} (confidence: ${d.confidence})\n`;
            });
          } else if (data.type === 'success') {
            sourceData += `${data.tool}: ${data.strategy} (confidence: ${data.confidence})\n`;
          }
        } catch {}
      }
      if (sourceData.length > 10) {
        const result = nlm(`Synthesize these tool learnings into exactly 5 concise rules. Each rule should be actionable. Format: numbered list. Learnings:\n${sourceData.slice(0, 1500)}`);
        console.log(result);
      } else {
        console.log('Not enough learnings to synthesize');
      }
    } else {
      // Default: briefing synthesis
      const result = nlm(`ask "Summarize the current project state in 3 sentences"`);
      console.log(result);
    }
    break;
  }

  case 'store-knowledge': {
    ensureNotebook();
    // Parse structured knowledge from stdin or argv input
    let knowledge;
    let rawInput = input;
    // If no argv input, try reading from stdin
    if (!rawInput) {
      try {
        rawInput = readFileSync('/dev/stdin', 'utf8');
      } catch {}
    }
    try {
      knowledge = JSON.parse(rawInput);
    } catch {
      console.error('Invalid JSON input for store-knowledge');
      break;
    }

    const date = new Date().toISOString().slice(0, 10);
    const doc = [
      `# AURAMAXING Session Knowledge - ${date}`,
      '',
      '## Decisions Made',
      ...(knowledge.decisions || []).map(d => `- ${d}`),
      '',
      '## Patterns That Worked',
      ...(knowledge.patterns || []).map(p => `- ${p}`),
      '',
      '## Failures To Avoid',
      ...(knowledge.failures || []).map(f => `- ${f}`),
      '',
      '## Next Steps',
      ...(knowledge.nextSteps || []).map(n => `- ${n}`),
    ].join('\n');

    // Write to temp file, then add as NLM source
    const tmpFile = join(HOME, '.auramaxing', 'nlm-cache', `knowledge-${date}.md`);
    writeFileSync(tmpFile, doc);
    try {
      const result = nlm(`source add "${tmpFile}" --title "AURAMAXING Session - ${date}"`);
      console.log(result || 'Knowledge stored');
    } catch (e) {
      console.error(`[NLM store error: ${e.message?.slice(0, 80)}]`);
      console.log('Knowledge saved locally to ' + tmpFile);
    }
    break;
  }

  case 'query-knowledge': {
    ensureNotebook();
    const answer = nlm(`ask "Based on all stored session knowledge, answer: ${input.replace(/"/g, '\\"')}"`);
    console.log(answer);
    break;
  }

  case 'help': default:
    console.log(`NotebookLM Bridge — AURAMAXING
Commands:
  ask "question"         Ask NotebookLM (cached 1hr)
  structure "prompt"     Structure prompt for precision
  synthesize <type>      Synthesize learnings|briefing via NLM
  add-source <file>      Add document to notebook
  compress-memory        Compress session memory via NLM
  brief                  Show session briefing
  store-knowledge        Store structured session knowledge as NLM source (JSON via stdin)
  query-knowledge "q"    Query all stored session knowledge
  setup                  Create autopilot notebook`);
}

process.exit(0);
