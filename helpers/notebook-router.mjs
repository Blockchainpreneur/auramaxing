#!/usr/bin/env node
/**
 * AURAMAXING Notebook Router — multi-notebook provisioning + routing
 *
 * Responsibilities:
 *   1. Ensure global notebooks exist: decisions, patterns, projects, briefings
 *   2. Provision per-project notebooks (already handled by nlm-session-setup for "memory")
 *   3. Route writes/reads to the correct notebook by content type
 *   4. Maintain ~/.auramaxing/nlm-notebooks.json with schema:
 *        { projects: { <name>: { memory: <uuid> } }, global: { decisions, patterns, projects, briefings } }
 *
 * CLI:
 *   node notebook-router.mjs ensure                # provision all missing notebooks
 *   node notebook-router.mjs get <type> [project]  # print UUID for routing
 *   node notebook-router.mjs migrate               # upgrade legacy flat map -> schema
 *
 * Library (import):
 *   ensureAll(), notebookFor(type, project), readMap(), writeMap(map)
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { findNlm, pythonEnv } from './find-bin.mjs';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const MAP_FILE = join(AUR, 'nlm-notebooks.json');
const LEGACY_SINGLE = join(AUR, 'nlm-notebook-id');
const NLM_BIN = findNlm();

mkdirSync(AUR, { recursive: true });

const GLOBAL_NOTEBOOKS = {
  decisions:  'AURAMAXING Global: Decisions',
  patterns:   'AURAMAXING Global: Patterns',
  projects:   'AURAMAXING Global: Projects',
  briefings:  'AURAMAXING Global: Briefings',
};

export function readMap() {
  try {
    if (!existsSync(MAP_FILE)) return { projects: {}, global: {} };
    const raw = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
    // Migrate legacy flat map { projectName: uuid } -> { projects: { projectName: { memory: uuid } } }
    if (!raw.projects && !raw.global) {
      const projects = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v)) {
          projects[k] = { memory: v };
        }
      }
      return { projects, global: {} };
    }
    raw.projects ||= {};
    raw.global ||= {};
    return raw;
  } catch {
    return { projects: {}, global: {} };
  }
}

export function writeMap(map) {
  try { writeFileSync(MAP_FILE, JSON.stringify(map, null, 2)); } catch {}
}

function nlm(args, { timeout = 15000 } = {}) {
  if (!NLM_BIN) throw new Error('NLM CLI not available');
  return execSync(`${NLM_BIN} ${args}`, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, PATH: pythonEnv().PATH },
  }).trim();
}

function createNotebook(title) {
  const out = nlm(`create "${title.replace(/"/g, '\\"')}"`);
  const m = out.match(/([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

/**
 * Provision missing notebooks. Idempotent. Returns the map.
 * Creates: 4 global notebooks + current-project memory (if project arg given).
 */
export function ensureAll({ project = null, verbose = false } = {}) {
  const map = readMap();
  const log = (...a) => { if (verbose) console.log(...a); };

  // Seed from legacy single-notebook file (first-time migration)
  try {
    if (existsSync(LEGACY_SINGLE) && project && !map.projects[project]) {
      const id = readFileSync(LEGACY_SINGLE, 'utf8').trim();
      if (/^[a-f0-9-]{36}$/.test(id)) {
        map.projects[project] = { memory: id };
        log(`Migrated legacy notebook-id -> projects.${project}.memory`);
      }
    }
  } catch {}

  // Global notebooks
  for (const [key, title] of Object.entries(GLOBAL_NOTEBOOKS)) {
    if (map.global[key]) continue;
    try {
      const id = createNotebook(title);
      if (id) {
        map.global[key] = id;
        log(`Created global.${key} -> ${id.slice(0, 8)}`);
        // Rate-limit-friendly spacing between creations
        execSync('sleep 0.5');
      } else {
        log(`Failed to parse UUID for ${title}`);
      }
    } catch (e) {
      log(`Create ${key} failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Per-project memory notebook
  if (project) {
    map.projects[project] ||= {};
    if (!map.projects[project].memory) {
      try {
        const id = createNotebook(`AURAMAXING: ${project}`);
        if (id) {
          map.projects[project].memory = id;
          log(`Created projects.${project}.memory -> ${id.slice(0, 8)}`);
        }
      } catch (e) {
        log(`Project create failed: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  writeMap(map);
  return map;
}

/**
 * Route by content type -> notebook UUID.
 *   type: 'decision' | 'learning' | 'pattern' | 'prd' | 'diff' | 'session' | 'research' | 'briefing' | 'memory'
 */
export function notebookFor(type, project) {
  const map = readMap();
  const proj = project && map.projects[project] ? map.projects[project] : null;

  switch (type) {
    case 'decision':  return map.global.decisions || proj?.memory;
    case 'learning':
    case 'pattern':   return map.global.patterns || proj?.memory;
    case 'research':  return map.global.projects || proj?.memory;
    case 'briefing':  return map.global.briefings || proj?.memory;
    case 'prd':
    case 'diff':
    case 'session':
    case 'memory':
    default:          return proj?.memory || map.global.projects;
  }
}

// ── CLI ─────────────────────────────────────────────────────────
// Only run CLI when invoked directly (not on import).
const isMain = import.meta.url === `file://${process.argv[1]}`;
const cmd = isMain ? process.argv[2] : null;
if (!isMain || !cmd) { /* library mode: do not exit */ }
else try {
  if (cmd === 'ensure') {
    const proj = process.argv[3] || null;
    const map = ensureAll({ project: proj, verbose: true });
    console.log(JSON.stringify(map, null, 2));
  } else if (cmd === 'get') {
    const type = process.argv[3];
    const proj = process.argv[4] || null;
    const id = notebookFor(type, proj);
    if (id) console.log(id);
    else process.exit(2);
  } else if (cmd === 'migrate') {
    const map = readMap();
    writeMap(map);
    console.log('Migrated.');
  } else if (cmd === 'map') {
    console.log(JSON.stringify(readMap(), null, 2));
  } else {
    console.error('Usage: notebook-router.mjs <ensure|get|migrate|map> [args]');
    process.exit(2);
  }
} catch (e) {
  console.error(`notebook-router error: ${e.message}`);
  process.exit(1);
}
