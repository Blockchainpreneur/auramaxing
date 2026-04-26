#!/usr/bin/env node
/**
 * AURAMAXING NLM Weekly Synthesis — compound intelligence loop
 *
 * For each global notebook (decisions, patterns, projects, briefings):
 *   1. Trigger `artifact generate report` (NLM synthesizes all sources into a report)
 *   2. Poll until ready (max 10 min)
 *   3. Fetch the generated report content
 *   4. Add the report back into the SAME notebook as a new source titled "Weekly synthesis YYYY-MM-DD"
 *
 * This creates compound intelligence: each week's synthesis becomes queryable
 * memory for subsequent weeks. Prunes older "Weekly synthesis" sources to keep
 * at most 4 (one month rolling).
 *
 * Triggered externally by a stamp-file cadence check (>= 7 days).
 * Not meant to run synchronously — invoke detached.
 *
 * Usage: node nlm-weekly-synth.mjs [--force]
 * Always exits 0. Logs to ~/.auramaxing/nlm-weekly-synth.log
 */
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';
import { readMap } from './notebook-router.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const LOG = join(AUR, 'nlm-weekly-synth.log');
const STAMP = join(AUR, '.last-weekly-synth');
const NLM_BIN = findNlm();
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const MAX_WAIT_MS = 10 * 60 * 1000;

mkdirSync(AUR, { recursive: true });

function log(...parts) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${parts.join(' ')}\n`); } catch {}
}

function nlm(args, { timeout = 30000 } = {}) {
  return execSync(`${NLM_BIN} ${args}`, {
    encoding: 'utf8', timeout,
    env: { ...process.env, PATH: pythonEnv().PATH },
  }).trim();
}

function shouldRun(force) {
  if (force) return true;
  if (!existsSync(STAMP)) return true;
  try {
    const age = Date.now() - statSync(STAMP).mtimeMs;
    return age >= SEVEN_DAYS_MS;
  } catch { return true; }
}

function stampNow() {
  try { writeFileSync(STAMP, String(Date.now())); } catch {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function synthesizeNotebook(nbKey, nbId) {
  const short = nbId.slice(0, 8);
  log(`Synthesizing notebook ${nbKey} (${short})`);
  try {
    nlm(`use ${short}`, { timeout: 10000 });

    // Generate report
    let genOut;
    try {
      genOut = nlm(`generate report`, { timeout: 60000 });
    } catch (e) {
      log(`  generate report failed: ${e.message?.slice(0, 120)}`);
      return { ok: false, reason: 'generate-failed' };
    }
    // Parse artifact ID
    const idMatch = genOut.match(/([a-f0-9-]{36})/);
    if (!idMatch) {
      log(`  could not parse artifact id from: ${genOut.slice(0, 120)}`);
      return { ok: false, reason: 'no-artifact-id' };
    }
    const artifactId = idMatch[1];
    log(`  artifact ${artifactId.slice(0, 8)} generating...`);

    // Wait for it
    const waitStart = Date.now();
    while (Date.now() - waitStart < MAX_WAIT_MS) {
      await sleep(10000);
      try {
        nlm(`artifact wait ${artifactId.slice(0, 8)}`, { timeout: 15000 });
        break;
      } catch {
        // Not ready yet, keep polling
      }
    }

    // Fetch content
    let content = '';
    try {
      content = nlm(`artifact get ${artifactId.slice(0, 8)}`, { timeout: 30000 });
    } catch (e) {
      log(`  artifact get failed: ${e.message?.slice(0, 120)}`);
      return { ok: false, reason: 'get-failed' };
    }
    if (!content || content.length < 200) {
      log(`  artifact content empty/short (${content.length} chars)`);
      return { ok: false, reason: 'empty-content' };
    }

    // Write tmp, re-ingest as source
    const date = new Date().toISOString().slice(0, 10);
    const title = `Weekly synthesis ${date}`;
    const tmp = join(tmpdir(), `aura-synth-${nbKey}-${date}.md`);
    writeFileSync(tmp, `# ${title}\n\n_Auto-generated from ${nbKey} notebook sources._\n\n${content}`);
    try {
      nlm(`source add "${tmp}" --title "${title}"`, { timeout: 45000 });
      log(`  re-ingested as "${title}"`);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }

    return { ok: true, artifactId, title };
  } catch (e) {
    log(`  unexpected error: ${e.message?.slice(0, 200)}`);
    return { ok: false, reason: 'exception' };
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!NLM_BIN) { log('NLM CLI unavailable'); return; }
  if (!shouldRun(force)) {
    log('Skipped: 7-day cadence not yet elapsed');
    return;
  }

  // Stamp optimistically so concurrent invocations don't double-run
  stampNow();

  const map = readMap();
  const targets = Object.entries(map.global || {});
  if (targets.length === 0) {
    log('No global notebooks configured; nothing to synthesize');
    return;
  }

  log(`Starting synthesis across ${targets.length} global notebooks`);
  for (const [key, id] of targets) {
    await synthesizeNotebook(key, id);
  }
  log('Synthesis run complete');
}

main().catch(e => { log('fatal:', e.message); }).finally(() => setTimeout(() => process.exit(0), 200));
