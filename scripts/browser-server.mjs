#!/usr/bin/env node
/**
 * AURAMAXING Browser Server — native browser automation
 *
 * Launches the user's installed Chrome with a persistent profile copy.
 * All sessions, cookies, and logins from the user's Chrome are preserved.
 * Connects via Chrome DevTools Protocol (CDP) on port 9222.
 *
 * Usage:
 *   node scripts/browser-server.mjs              # start (copies profile on first run)
 *   node scripts/browser-server.mjs --stop       # stop server
 *   node scripts/browser-server.mjs --status     # check if running
 *   node scripts/browser-server.mjs --sync       # re-sync profile from Chrome
 *
 * Other scripts connect via:
 *   chromium.connectOverCDP('http://localhost:9222')
 */
import { execSync, spawn as spawnProc } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, cpSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CDP_PORT = 9222;
const HOME = homedir();
const PID_FILE = join(HOME, '.auramaxing', 'browser.pid');
const PROFILE_DIR = join(HOME, '.auramaxing', 'chrome-cdp-profile');
const CHROME_PROFILE = join(HOME, 'Library', 'Application Support', 'Google', 'Chrome');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function isCdpRunning() {
  try {
    execSync(`curl -sf http://localhost:${CDP_PORT}/json/version >/dev/null 2>&1`, { timeout: 2000 });
    return true;
  } catch { return false; }
}

function syncProfile() {
  if (!existsSync(CHROME_PROFILE)) {
    console.log('No Chrome profile found at', CHROME_PROFILE);
    console.log('Starting with empty profile — log in once and sessions persist.');
    mkdirSync(PROFILE_DIR, { recursive: true });
    return;
  }
  console.log('Syncing Chrome profile (cookies, sessions, extensions)...');
  mkdirSync(PROFILE_DIR, { recursive: true });
  try {
    // Copy key profile data — Default folder has cookies, sessions, extensions
    cpSync(join(CHROME_PROFILE, 'Default'), join(PROFILE_DIR, 'Default'), { recursive: true, force: false, errorOnExist: false });
    cpSync(join(CHROME_PROFILE, 'Local State'), join(PROFILE_DIR, 'Local State'), { force: false, errorOnExist: false });
  } catch (e) {
    // First sync copies, subsequent syncs skip (force: false)
  }
  console.log('Profile synced.');
}

// ── Stop ──────────────────────────────────────────────────────
if (process.argv.includes('--stop')) {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    try { process.kill(parseInt(pid)); } catch {}
    try { unlinkSync(PID_FILE); } catch {}
    console.log('Browser server stopped.');
  } else {
    // Kill any Chrome with our CDP port
    try { execSync(`pkill -f "remote-debugging-port=${CDP_PORT}" 2>/dev/null`); } catch {}
    console.log('Browser server stopped.');
  }
  process.exit(0);
}

// ── Status ────────────────────────────────────────────────────
if (process.argv.includes('--status')) {
  if (isCdpRunning()) {
    try {
      const res = execSync(`curl -sf http://localhost:${CDP_PORT}/json/version`, { encoding: 'utf8', timeout: 2000 });
      const info = JSON.parse(res);
      console.log(`Running: ${info.Browser || 'Chrome'} on port ${CDP_PORT}`);
    } catch { console.log(`Running on port ${CDP_PORT}`); }
  } else {
    console.log('Not running.');
  }
  process.exit(0);
}

// ── Sync profile ──────────────────────────────────────────────
if (process.argv.includes('--sync')) {
  syncProfile();
  process.exit(0);
}

// ── Already running? ──────────────────────────────────────────
if (isCdpRunning()) {
  console.log(`Already running on port ${CDP_PORT}.`);
  process.exit(0);
}

// ── Find Chrome ───────────────────────────────────────────────
const chromePath = findChrome();
if (!chromePath) {
  console.error('Chrome not found. Install Google Chrome.');
  process.exit(1);
}

// ── Sync profile on first run ─────────────────────────────────
if (!existsSync(join(PROFILE_DIR, 'Default'))) {
  syncProfile();
} else {
  console.log(`Using existing profile: ${PROFILE_DIR}`);
}

// ── Launch Chrome ─────────────────────────────────────────────
console.log(`Starting browser server (${chromePath.split('/').pop()})...`);

const chrome = spawnProc(chromePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  '--start-maximized',
  'about:blank',
], {
  detached: true,
  stdio: 'ignore',
});

chrome.unref();
writeFileSync(PID_FILE, String(chrome.pid));

// Wait for CDP
let ready = false;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 500));
  if (isCdpRunning()) { ready = true; break; }
}

if (ready) {
  console.log(`Browser server ready on port ${CDP_PORT}`);
  console.log('Your Chrome sessions are preserved. Tabs never close.');
} else {
  console.error('Chrome started but CDP not responding.');
  process.exit(1);
}

process.exit(0);
