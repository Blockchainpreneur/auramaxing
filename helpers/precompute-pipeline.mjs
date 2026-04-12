#!/usr/bin/env node
/**
 * AURAMAXING Pre-computation Pipeline
 *
 * Runs after SessionStop (background, non-blocking).
 * Generates all cached artifacts for the next session:
 *
 * 0. Verify NLM auth
 * 1. Ingest memory + learnings into vector index (nano-vectordb)
 * 1b. Ingest cross-project learnings (gstack + Claude auto-memory)
 * 2. Extract structured knowledge via NLM → session-briefing.txt
 * 3. NLM synthesize learnings → learnings-synthesis.txt
 * 4. NLM generate anti-laziness → anti-laziness-{type}.txt
 * 5. Generate session intent prediction → session-prediction.txt
 * 6. Compress ENRICHMENTS → enrichments-compressed.json
 * 7. Generate task-specific CLAUDE.md segments → claudemd-{type}.txt
 *
 * Each step is independent and wrapped in try/catch.
 * Partial success is fine — consumers have fallbacks.
 *
 * Total budget: ~60s. All output to prompt-cache/.
 */
import { execSync, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const MEMORY_DIR = join(HOME, '.auramaxing', 'memory');
const LEARNINGS_DIR = join(HOME, '.auramaxing', 'learnings');
const CACHE_DIR = join(HOME, '.auramaxing', 'prompt-cache');
const NLM_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
const NB_ID_FILE = join(HOME, '.auramaxing', 'nlm-notebook-id');
const PYTHON_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
const LIGHTRAG_CLI = join(HOME, 'auramaxing', 'scripts', 'lightrag-cli.py');
const LIGHTRAG_WORKSPACE = join(HOME, '.auramaxing', 'lightrag-workspace');

mkdirSync(CACHE_DIR, { recursive: true });

function log(step, msg) {
  process.stderr.write(`[precompute] ${step}: ${msg}\n`);
}

function nlm(query) {
  try {
    const nbId = readFileSync(NB_ID_FILE, 'utf8').trim().slice(0, 8);
    execSync(`${NLM_BIN} use ${nbId}`, { timeout: 5000, stdio: 'ignore' });
    const result = execSync(
      `${NLM_BIN} ask "${query.replace(/"/g, '\\"').slice(0, 500)}"`,
      { encoding: 'utf8', timeout: 30000 }
    ).trim();
    return result.split('Answer:').pop()?.trim() || result;
  } catch (e) {
    return null;
  }
}

// ── Step 0: Verify NLM auth ────────────────────────────────────────────────
try {
  log('0', 'Checking NLM auth...');
  const authScript = join(HOME, 'auramaxing', 'helpers', 'nlm-auth-refresh.mjs');
  if (existsSync(authScript)) {
    execSync(`node "${authScript}"`, {
      timeout: 15000, stdio: 'pipe',
      env: { ...process.env, PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}`, PLAYWRIGHT_BROWSERS_PATH: `${HOME}/Library/Caches/ms-playwright` },
    });
    log('0', 'NLM auth OK');
  }
} catch (e) {
  log('0', `NLM auth refresh failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 1: Ingest memory + learnings into vector index ─────────────────────

try {
  log('1/7', 'Ingesting memory into vector index...');
  const entries = [];

  // Collect memory entries
  if (existsSync(MEMORY_DIR)) {
    const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8'));
        data.source = 'memory';
        entries.push(data);
      } catch {}
    }
  }

  // Collect learnings
  if (existsSync(LEARNINGS_DIR)) {
    const files = readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(LEARNINGS_DIR, f), 'utf8'));
        if (Array.isArray(data)) {
          data.forEach(d => { d.source = 'learning'; entries.push(d); });
        } else {
          data.source = 'learning';
          entries.push(data);
        }
      } catch {}
    }
  }

  if (entries.length > 0) {
    const result = execFileSync(PYTHON_BIN, [
      LIGHTRAG_CLI, 'ingest', '--workspace', LIGHTRAG_WORKSPACE,
    ], {
      input: JSON.stringify(entries),
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim();
    log('1/7', `Done: ${result}`);
  } else {
    log('1/7', 'No entries to ingest');
  }
} catch (e) {
  log('1/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 1b: Ingest cross-project knowledge ─────────────────────────────────

try {
  log('1b', 'Ingesting cross-project learnings...');
  const bridgeScript = join(HOME, 'auramaxing', 'helpers', 'lightrag-bridge.mjs');
  const result = execSync(`node "${bridgeScript}" ingest-cross`, {
    encoding: 'utf8', timeout: 30000,
  }).trim();
  log('1b', `Done: ${result}`);
} catch (e) {
  log('1b', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 2: Extract structured knowledge → NLM source + session-briefing.txt ─

try {
  log('2/7', 'Extracting structured knowledge via NLM...');

  const NLM_BRIDGE = join(HOME, 'auramaxing', 'helpers', 'notebooklm-bridge.mjs');

  // Collect recent memory summaries
  const files = existsSync(MEMORY_DIR)
    ? readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().slice(-20)
    : [];

  const entries = files.map(f => {
    try { return JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf8')); }
    catch { return null; }
  }).filter(Boolean);

  const raw = entries
    .map(e => `[${e.ts?.slice(0, 10)}] ${e.type}: ${e.content || e.summary || ''}`)
    .join('\n')
    .slice(0, 2000);

  if (raw.length > 50) {
    // Step 2a: Extract structured knowledge from session logs
    const structuredPrompt =
      `From these session logs, extract exactly: ` +
      `1) Key decisions made (list), ` +
      `2) Patterns that worked (tool + strategy, list), ` +
      `3) Failures to avoid (what broke + why, list), ` +
      `4) Planned next steps (list). ` +
      `Format as JSON with keys: decisions, patterns, failures, nextSteps. ` +
      `Each value is an array of strings. Output ONLY valid JSON, no markdown fences. ` +
      `Logs:\n${raw}`;

    const structuredRaw = nlm(structuredPrompt);
    let structuredKnowledge = null;

    if (structuredRaw && structuredRaw.length > 20) {
      // Try to parse JSON from NLM response (may have surrounding text)
      try {
        // Find JSON object in the response
        const jsonMatch = structuredRaw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          structuredKnowledge = JSON.parse(jsonMatch[0]);
        }
      } catch {
        log('2/7', 'Could not parse structured JSON from NLM, falling back');
      }
    }

    // Step 2b: Store structured knowledge as NLM source via store-knowledge
    if (structuredKnowledge) {
      try {
        const storeResult = execSync(
          `echo '${JSON.stringify(structuredKnowledge).replace(/'/g, "'\\''")}' | node "${NLM_BRIDGE}" store-knowledge`,
          { encoding: 'utf8', timeout: 30000 }
        ).trim();
        log('2/7', `Structured knowledge stored: ${storeResult.slice(0, 60)}`);
      } catch (e) {
        log('2/7', `store-knowledge failed (non-blocking): ${e.message?.slice(0, 60)}`);
      }
    }

    let briefing = '';

    // Append to master progress file (accumulates forever)
    try {
      const masterFile = join(HOME, '.auramaxing', 'nlm-cache', 'master-progress.md');
      let existing = '';
      try { existing = readFileSync(masterFile, 'utf8'); } catch {}

      const today = new Date().toISOString().slice(0, 10);
      const knowledge = structuredKnowledge || {};
      const newEntry = [
        `\n## ${today} - Session Update`,
        `**Project:** ${process.cwd()}`,
        briefing ? `**Summary:** ${briefing.slice(0, 300)}` : '',
        knowledge.decisions?.length ? `**Decisions:** ${knowledge.decisions.join('; ')}` : '',
        knowledge.patterns?.length ? `**Patterns:** ${knowledge.patterns.join('; ')}` : '',
        knowledge.failures?.length ? `**Failures:** ${knowledge.failures.join('; ')}` : '',
        knowledge.nextSteps?.length ? `**Next:** ${knowledge.nextSteps.join('; ')}` : '',
        '---',
      ].filter(Boolean).join('\n');

      writeFileSync(masterFile, existing + newEntry);

      // Upload master progress to NLM as source (replace existing)
      try {
        // Delete old master source if exists
        const masterIdFile = join(HOME, '.auramaxing', 'nlm-master-source-id');
        if (existsSync(masterIdFile)) {
          const oldId = readFileSync(masterIdFile, 'utf8').trim();
          try { execSync(`${NLM_BIN} source delete ${oldId.slice(0, 8)}`, { timeout: 10000, stdio: 'ignore' }); } catch {}
        }
        // Add updated master
        const result = execSync(
          `${NLM_BIN} source add "${masterFile}" --title "AURAMAXING Master Progress"`,
          { encoding: 'utf8', timeout: 15000 }
        ).trim();
        const idMatch = result.match(/([a-f0-9-]{36})/);
        if (idMatch) writeFileSync(masterIdFile, idMatch[1]);
        log('2-master', 'Master progress updated in NLM');
      } catch (e) {
        log('2-master', `NLM master upload failed: ${e.message?.slice(0, 60)}`);
      }
    } catch {}

    // Step 2c: Generate session-briefing.txt (keep existing behavior)
    // If we have structured data, generate briefing from it; otherwise fall back to NLM compression
    if (structuredKnowledge) {
      const decisions = (structuredKnowledge.decisions || []).slice(0, 3).join('; ');
      const patterns = (structuredKnowledge.patterns || []).slice(0, 3).join('; ');
      const nextSteps = (structuredKnowledge.nextSteps || []).slice(0, 3).join('; ');
      briefing = [
        decisions ? `Key decisions: ${decisions}.` : '',
        patterns ? `What worked: ${patterns}.` : '',
        nextSteps ? `Next: ${nextSteps}.` : '',
      ].filter(Boolean).join(' ');
    }

    // Fall back to NLM compression if structured extraction didn't produce a briefing
    if (!briefing || briefing.length < 20) {
      briefing = nlm(
        `Compress these session logs into a 3-sentence briefing for an AI assistant. ` +
        `Include: current project focus, key decisions made, tools/patterns that worked, ` +
        `and what to do next. Be specific with file names and task types. Logs:\n${raw}`
      );
    }

    if (briefing && briefing.length > 20) {
      writeFileSync(join(CACHE_DIR, 'session-briefing.txt'), briefing);
      // Also update the legacy compressed summary for backward compat
      writeFileSync(join(MEMORY_DIR, '_compressed-summary.json'), JSON.stringify({
        ts: new Date().toISOString(),
        type: 'compressed-summary',
        content: briefing,
        entriesCompressed: entries.length,
        structuredKnowledge: structuredKnowledge || null,
      }, null, 2));
      log('2/7', `Done: briefing ${briefing.length} chars, structured: ${!!structuredKnowledge}`);
    } else {
      log('2/7', 'NLM returned empty result for both structured and briefing');
    }
  } else {
    log('2/7', 'Not enough memory entries to compress');
  }
} catch (e) {
  log('2/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 3: NLM synthesize learnings → learnings-synthesis.txt ──────────────

try {
  log('3/7', 'Synthesizing learnings...');

  const learningFiles = existsSync(LEARNINGS_DIR)
    ? readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.json'))
    : [];

  const learnings = [];
  for (const f of learningFiles) {
    try {
      const data = JSON.parse(readFileSync(join(LEARNINGS_DIR, f), 'utf8'));
      if (Array.isArray(data)) {
        learnings.push(...data.filter(d => d.type === 'success'));
      } else if (data.type === 'success') {
        learnings.push(data);
      }
    } catch {}
  }

  if (learnings.length >= 2) {
    const raw = learnings
      .map(l => `${l.tool || l.key}: ${l.strategy || l.pattern || ''} (confidence: ${l.confidence || '?'})`)
      .join('\n')
      .slice(0, 1500);

    const synthesis = nlm(
      `Synthesize these tool learnings into exactly 5 concise rules. ` +
      `Each rule should be actionable and specific. Format: numbered list, one line each. ` +
      `Focus on what works and what to avoid. Learnings:\n${raw}`
    );

    if (synthesis && synthesis.length > 20) {
      writeFileSync(join(CACHE_DIR, 'learnings-synthesis.txt'), synthesis);
      log('3/7', `Done: ${synthesis.length} chars`);
    } else {
      log('3/7', 'NLM returned empty result');
    }
  } else {
    log('3/7', `Only ${learnings.length} success learnings, skipping synthesis`);
  }
} catch (e) {
  log('3/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 4: NLM anti-laziness per task type → anti-laziness-{type}.txt ──────

try {
  log('4/7', 'Generating anti-laziness directives...');

  const taskTypes = [
    'new-feature', 'bug-fix', 'deploy-ship', 'design', 'e2e-testing',
    'refactor', 'security', 'code-review', 'performance', 'investigate',
    'brain-dump', 'strategy', 'pitch', 'research', 'planning',
  ];

  // Batch all task types into one NLM call for efficiency
  const prompt = `You are generating anti-laziness enforcement rules for an AI coding assistant. ` +
    `For each task type below, generate a STRICT enforcement directive that: ` +
    `1) Names a specific shortcut the AI commonly takes for that task type ` +
    `2) Demands the OPPOSITE behavior with a concrete action ` +
    `3) Includes a verification step the AI must complete before reporting done ` +
    `Each directive must be universally applicable, NOT project-specific. ` +
    `Be aggressive and specific. "Be thorough" is NOT acceptable — name the exact lazy behavior to prevent. ` +
    `Format: one line per type as "type: directive". Task types:\n` +
    taskTypes.join('\n');

  const result = nlm(prompt);

  if (result && result.length > 50) {
    // Parse the result and save individual files
    const lines = result.split('\n').filter(l => l.includes(':'));
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const type = line.slice(0, colonIdx).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      const directive = line.slice(colonIdx + 1).trim();
      if (type && directive.length > 10) {
        // Match to known task types (fuzzy)
        const matched = taskTypes.find(t =>
          t === type || t.includes(type) || type.includes(t.replace('-', ''))
        );
        if (matched) {
          writeFileSync(join(CACHE_DIR, `anti-laziness-${matched}.txt`), directive);
        }
      }
    }
    log('4/7', `Done: parsed ${lines.length} directives`);
  } else {
    log('4/7', 'NLM returned empty result');
  }
} catch (e) {
  log('4/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 5: Generate session intent prediction ─────────────────────────────

try {
  log('5/7', 'Predicting next session intent...');
  execSync(`node "${join(HOME, 'auramaxing', 'helpers', 'intent-predictor.mjs')}"`, {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}` },
  });
  log('5/7', 'Done');
} catch (e) {
  log('5/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 6: Compress ENRICHMENTS → enrichments-compressed.json ──────────────

try {
  log('6/7', 'Compressing enrichments...');

  // The ENRICHMENTS from rational-router-apex.mjs (hardcoded here for pre-computation)
  const ENRICHMENTS = {
    'new-feature': [
      'input validation at all boundaries',
      'error states (network failure, invalid input, timeout, empty)',
      'loading/skeleton states',
      'responsive design (mobile-first)',
      'accessibility (ARIA, keyboard nav)',
      'E2E tests with Playwright',
      'edge cases and overflow handling',
    ],
    'bug-fix': [
      'root cause analysis before patching',
      'regression test that catches this exact bug',
      'check for same pattern in related code',
      'verify fix handles edge cases',
    ],
    'deploy-ship': [
      'pre-deploy smoke test',
      'rollback plan if deploy fails',
      'post-deploy canary monitoring',
      'verify zero-downtime',
    ],
    design: [
      'mobile-first responsive',
      'dark mode support',
      'loading/empty/error/overflow states',
      'accessibility (WCAG 2.1 AA)',
      'visual regression test',
    ],
    'e2e-testing': [
      'happy path + error paths + edge cases',
      'mobile viewport testing',
      'form validation testing',
      'cross-browser (chromium + firefox)',
    ],
    refactor: [
      'preserve all existing behavior',
      'add/update tests to cover refactored code',
      'benchmark before and after for performance',
    ],
    security: [
      'OWASP Top 10 check',
      'STRIDE threat model',
      'input sanitization audit',
      'auth/session handling review',
    ],
    'code-review': [
      'security implications',
      'performance impact',
      'test coverage gaps',
      'edge cases missed',
    ],
    performance: [
      'baseline measurement before changes',
      'identify actual bottleneck (profile, don\'t guess)',
      'test with realistic data volume',
      'check for N+1 queries and memory leaks',
    ],
    investigate: [
      'reproduce the issue first',
      'check logs and error traces',
      'narrow scope before patching',
      'verify the fix doesn\'t mask the real problem',
    ],
    'brain-dump': [
      'extract actionable decisions',
      'identify blockers and dependencies',
      'prioritize by impact vs effort',
    ],
    strategy: [
      'competitive landscape',
      'distribution channel strategy',
      'unit economics check',
      'go-to-market timeline',
    ],
    pitch: [
      'problem/solution clarity',
      'market size evidence',
      'traction metrics',
      'why now, why you',
    ],
    research: [
      'primary vs secondary sources',
      'verify claims with data',
      'identify conflicting evidence',
    ],
    planning: [
      'define success criteria',
      'identify risks and dependencies',
      'break into phases with milestones',
    ],
  };

  // Build compressed enrichments — one dense sentence per task type
  const allTypes = Object.entries(ENRICHMENTS)
    .map(([type, items]) => `${type}: ${items.join(', ')}`)
    .join('\n');

  const result = nlm(
    `Compress each of these enrichment lists into a single dense sentence (max 20 words each). ` +
    `Keep the task type prefix. Be specific, not generic. Format: "type: compressed sentence".\n${allTypes}`
  );

  if (result && result.length > 50) {
    const compressed = {};
    const lines = result.split('\n').filter(l => l.includes(':'));
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const type = line.slice(0, colonIdx).trim().toLowerCase().replace(/[^a-z-]/g, '');
      const text = line.slice(colonIdx + 1).trim();
      // Match to known types
      const matched = Object.keys(ENRICHMENTS).find(t =>
        t === type || t.includes(type) || type.includes(t.replace('-', ''))
      );
      if (matched && text.length > 10) {
        compressed[matched] = text;
      }
    }

    // Fill in any missing types with manual compression (fallback)
    for (const [type, items] of Object.entries(ENRICHMENTS)) {
      if (!compressed[type]) {
        compressed[type] = items.slice(0, 3).join('; ');
      }
    }

    writeFileSync(join(CACHE_DIR, 'enrichments-compressed.json'), JSON.stringify(compressed, null, 2));
    log('6/7', `Done: ${Object.keys(compressed).length} types compressed`);
  } else {
    // Fallback: manual compression without NLM
    const compressed = {};
    for (const [type, items] of Object.entries(ENRICHMENTS)) {
      compressed[type] = items.slice(0, 3).join('; ');
    }
    writeFileSync(join(CACHE_DIR, 'enrichments-compressed.json'), JSON.stringify(compressed, null, 2));
    log('6/7', 'Fallback: manual compression (NLM unavailable)');
  }
} catch (e) {
  log('6/7', `Failed: ${e.message?.slice(0, 80)}`);
}

// ── Step 7: Generate task-specific CLAUDE.md segments ───────────────────────
try {
  log('7/7', 'Generating CLAUDE.md segments...');
  execSync(`node "${join(HOME, 'auramaxing', 'helpers', 'claudemd-segments.mjs')}"`, {
    encoding: 'utf8', timeout: 10000,
  });
  log('7/7', 'Done');
} catch (e) {
  log('7/7', `Failed: ${e.message?.slice(0, 80)}`);
}

log('done', 'Pre-computation pipeline complete.');
process.exit(0);
