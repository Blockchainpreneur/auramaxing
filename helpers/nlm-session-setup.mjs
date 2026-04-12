#!/usr/bin/env node
/**
 * AURAMAXING NLM Session Setup (runs in background)
 *
 * Called by session-start.mjs as a detached background process.
 * 1. Refreshes NLM auth if expired
 * 2. Creates per-project NLM notebook if new project
 * 3. Switches to the project's notebook
 *
 * Receives project name as argv[2].
 * Always exits 0. Logs to ~/.auramaxing/nlm-setup.log
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const NLM_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
const LOG_FILE = join(HOME, '.auramaxing', 'nlm-setup.log');
const projectName = process.argv[2] || 'unknown';

mkdirSync(join(HOME, '.auramaxing'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
}

log(`Setup starting for project: ${projectName}`);

// Step 1: Auth refresh
try {
  const authScript = join(HOME, 'auramaxing', 'helpers', 'nlm-auth-refresh.mjs');
  if (existsSync(authScript)) {
    execSync(`node "${authScript}"`, {
      timeout: 20000, stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}`,
        PLAYWRIGHT_BROWSERS_PATH: join(HOME, 'Library', 'Caches', 'ms-playwright'),
      },
    });
    log('Auth: OK');
  }
} catch (e) {
  log(`Auth: failed (${e.message?.slice(0, 60)})`);
}

// Step 2: Create project notebook if needed
try {
  const nbMapFile = join(HOME, '.auramaxing', 'nlm-notebooks.json');
  let nbMap = {};
  try {
    if (existsSync(nbMapFile)) nbMap = JSON.parse(readFileSync(nbMapFile, 'utf8'));
  } catch {}

  if (!nbMap[projectName]) {
    log(`Creating notebook for: ${projectName}`);
    const result = execSync(
      `${NLM_BIN} create "AURAMAXING: ${projectName}"`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
    const idMatch = result.match(/([a-f0-9-]{36})/);
    if (idMatch) {
      nbMap[projectName] = idMatch[1];
      writeFileSync(nbMapFile, JSON.stringify(nbMap, null, 2));
      log(`Notebook created: ${idMatch[1]}`);
    } else {
      log(`Notebook create failed: ${result.slice(0, 100)}`);
    }
  } else {
    log(`Notebook exists: ${nbMap[projectName].slice(0, 8)}`);
  }

  // Step 3: Switch to project notebook
  if (nbMap[projectName]) {
    try {
      execSync(`${NLM_BIN} use ${nbMap[projectName].slice(0, 8)}`,
        { timeout: 5000, stdio: 'ignore' });
      log(`Switched to: ${projectName}`);
    } catch {}
  }
} catch (e) {
  log(`Notebook setup failed: ${e.message?.slice(0, 100)}`);
}

log('Setup complete');
process.exit(0);
