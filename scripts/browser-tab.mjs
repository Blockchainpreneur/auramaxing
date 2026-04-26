#!/usr/bin/env node
/**
 * AURAMAXING Browser Tab — open URLs, screenshot, interact
 *
 * Connects to the running browser server via CDP.
 * Opens new tabs in the user's existing Chrome window.
 * Tabs are NEVER closed.
 *
 * Usage:
 *   node browser-tab.mjs <url>                       # open tab
 *   node browser-tab.mjs <url> --screenshot file.png  # open + screenshot
 *   node browser-tab.mjs --list                       # list all tabs
 *   node browser-tab.mjs --read                       # read active page text
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const CDP_PORT = 9222;
const CDP_URL = `http://localhost:${CDP_PORT}`;

// ── Ensure server is running ──────────────────────────────────
function ensureServer() {
  try {
    execSync(`curl -sf ${CDP_URL}/json/version >/dev/null 2>&1`, { timeout: 2000 });
  } catch {
    console.log('Starting browser server...');
    const server = join(homedir(), 'auramaxing', 'scripts', 'browser-server.mjs');
    execSync(`node "${server}"`, { stdio: 'inherit', timeout: 20000 });
  }
}

// ── List tabs ─────────────────────────────────────────────────
if (process.argv.includes('--list')) {
  ensureServer();
  try {
    const res = execSync(`curl -sf ${CDP_URL}/json`, { encoding: 'utf8', timeout: 3000 });
    const tabs = JSON.parse(res).filter(t => t.type === 'page' && !t.url.startsWith('chrome'));
    for (const t of tabs) {
      console.log(`${t.title?.slice(0, 50).padEnd(52)} ${t.url?.slice(0, 60)}`);
    }
    console.log(`\n${tabs.length} tab(s) open.`);
  } catch (e) { console.error('Error:', e.message); }
  process.exit(0);
}

// ── Async main ────────────────────────────────────────────────
(async () => {
  // ── Read active page ────────────────────────────────────────
  if (process.argv.includes('--read')) {
    ensureServer();
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
    const pages = browser.contexts().flatMap(c => c.pages());
    const page = pages.find(p => !p.url().startsWith('chrome')) || pages[0];
    if (page) {
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '');
      console.log(text);
    }
    process.exit(0);
  }

  // ── Open tab ────────────────────────────────────────────────
  const url = process.argv.find(a => a.startsWith('http'));
  const ssIdx = process.argv.indexOf('--screenshot');
  const ssPath = ssIdx > -1 ? process.argv[ssIdx + 1] : null;

  if (!url) {
    console.error('Usage: node browser-tab.mjs <url> [--screenshot file.png] [--list] [--read]');
    process.exit(1);
  }

  ensureServer();

  try {
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    console.log(`Tab opened: ${url}`);
    console.log(`Title: ${await page.title()}`);

    if (ssPath) {
      await page.screenshot({ path: ssPath, fullPage: false });
      console.log(`Screenshot: ${ssPath}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  process.exit(0);
})();
