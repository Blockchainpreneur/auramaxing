#!/usr/bin/env node
/**
 * AURAMXING NLM Auth Refresh
 *
 * Auto-refreshes NotebookLM authentication using Chrome CDP.
 * Requires browser-server.mjs running on port 9222.
 * Non-blocking: exits 0 always.
 */
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { tmpdir } from 'os';

const HOME = homedir();
const NLM_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/notebooklm';
const PYTHON_BIN = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
const STORAGE_STATE = join(HOME, '.notebooklm', 'storage_state.json');
const CDP_URL = 'http://localhost:9222';

function log(msg) {
  process.stderr.write(`[nlm-auth] ${msg}\n`);
}

try {
  // ── Step 1: Check if NLM auth is still valid ──────────────────
  // Use `notebooklm auth check --test` for a real token fetch test
  // This is faster than `ask` and doesn't create a conversation
  try {
    const result = execSync(`${NLM_BIN} auth check --test 2>&1`, {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}`,
      },
    });
    if (result.includes('pass') && !result.includes('fail')) {
      log('Auth valid, no refresh needed');
      process.exit(0);
    }
    log('Auth check shows issues, attempting refresh...');
  } catch (e) {
    const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    if (output.includes('expired') || output.includes('fail') || output.includes('Redirected')) {
      log('Auth expired, attempting refresh...');
    } else {
      log('Auth check inconclusive, attempting refresh anyway...');
    }
  }

  // ── Step 2: Check if CDP is available, start if needed ─────────
  try {
    execSync(`curl -s --connect-timeout 2 ${CDP_URL}/json/version`, {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Try to start browser-server
    try {
      const serverScript = join(HOME, 'auramxing', 'scripts', 'browser-server.mjs');
      if (existsSync(serverScript)) {
        log('Starting browser-server for CDP...');
        const child = spawn('node', [serverScript], {
          detached: true, stdio: 'ignore',
          env: { ...process.env },
        });
        child.unref();
        // Wait for it to be ready
        execSync('sleep 3', { timeout: 5000 });
        // Verify
        execSync(`curl -s --connect-timeout 2 ${CDP_URL}/json/version`, {
          timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        log('CDP not available and browser-server not found. Cannot refresh.');
        process.exit(0);
      }
    } catch {
      log('CDP not available — cannot refresh NLM auth.');
      process.exit(0);
    }
  }

  // ── Step 3: Capture cookies via Playwright CDP ────────────────
  log('Connecting to Chrome via CDP to capture cookies...');

  mkdirSync(join(HOME, '.notebooklm'), { recursive: true });

  // Write Python script to temp file and execute (avoids shell escaping issues)
  const tmpScript = join(tmpdir(), `nlm-auth-refresh-${process.pid}.py`);
  const playwrightScript = [
    'import asyncio',
    'import json',
    'import os',
    'from playwright.async_api import async_playwright',
    '',
    'async def main():',
    '    async with async_playwright() as p:',
    `        browser = await p.chromium.connect_over_cdp("${CDP_URL}")`,
    '        context = browser.contexts[0] if browser.contexts else await browser.new_context()',
    '',
    '        page = await context.new_page()',
    '        try:',
    '            await page.goto("https://notebooklm.google.com/", wait_until="networkidle", timeout=30000)',
    '',
    '            await asyncio.sleep(3)',
    '',
    '            current_url = page.url',
    '            if "accounts.google.com" in current_url:',
    '                print("REDIRECT_TO_LOGIN", flush=True)',
    '                await page.close()',
    '                return',
    '',
    '            storage = await context.storage_state()',
    '',
    '            storage_path = os.path.expanduser("~/.notebooklm/storage_state.json")',
    '            with open(storage_path, "w") as f:',
    '                json.dump(storage, f, indent=2)',
    '',
    '            print(f"COOKIES_SAVED:{len(storage.get(\'cookies\', []))}", flush=True)',
    '        finally:',
    '            await page.close()',
    '',
    'asyncio.run(main())',
  ].join('\n');

  writeFileSync(tmpScript, playwrightScript);

  try {
    const result = execSync(`${PYTHON_BIN} "${tmpScript}"`, {
      encoding: 'utf8',
      timeout: 45000,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: join(HOME, 'Library', 'Caches', 'ms-playwright'),
        PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}`,
      },
    });

    if (result.includes('REDIRECT_TO_LOGIN')) {
      log('Chrome redirected to Google login — user may not be signed in. Manual login required.');
      process.exit(0);
    }

    const cookieMatch = result.match(/COOKIES_SAVED:(\d+)/);
    if (cookieMatch) {
      log(`Captured ${cookieMatch[1]} cookies from Chrome`);
    }
  } catch (e) {
    log(`Playwright CDP capture failed: ${(e.message || '').slice(0, 100)}`);
    try { unlinkSync(tmpScript); } catch {}
    process.exit(0);
  }

  // Clean up temp script
  try { unlinkSync(tmpScript); } catch {}

  // ── Step 4: Verify auth works ─────────────────────────────────
  try {
    const verify = execSync(`${NLM_BIN} list`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `/Library/Frameworks/Python.framework/Versions/3.12/bin:${process.env.PATH}`,
      },
    });
    if (verify && !verify.includes('Error') && !verify.includes('login')) {
      log('Auth refresh successful — NLM is ready');
    } else {
      log('Auth refresh completed but verification unclear');
    }
  } catch (e) {
    log(`Auth verification failed after refresh: ${(e.message || '').slice(0, 80)}`);
  }

} catch (e) {
  log(`Unexpected error: ${(e.message || '').slice(0, 100)}`);
}

process.exit(0);
