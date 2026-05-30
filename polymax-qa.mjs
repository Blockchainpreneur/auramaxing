import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];

// Find or create polymax tab
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:7878') || p.url().includes('localhost:7878'));
if (!page) {
  page = await ctx.newPage();
  await page.goto('http://127.0.0.1:7878/', { waitUntil: 'networkidle', timeout: 20000 });
} else {
  await page.bringToFront();
  await page.evaluate(() => localStorage.removeItem('polymax.dashboard.v3'));
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
}

// Wait for first render
await page.waitForFunction(() => {
  const cards = document.querySelectorAll('[data-card]');
  const hero = document.querySelector('[data-hero]');
  return cards.length > 0 || hero || document.querySelector('[data-empty]');
}, { timeout: 15000 }).catch(() => {});

// Mobile shot
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/polymax-mobile.png', fullPage: false });
const mobileFull = await page.screenshot({ path: '/tmp/polymax-mobile-full.png', fullPage: true });

// Counts + active preset
const stats = await page.evaluate(() => {
  const presetEls = Array.from(document.querySelectorAll('[data-preset]'));
  const presets = presetEls.map(e => ({ key: e.dataset.preset, label: e.textContent?.trim().slice(0,40), active: e.classList.contains('is-active') }));
  return {
    cardCount: document.querySelectorAll('[data-card]').length,
    hasHero: !!document.querySelector('[data-hero]'),
    presets,
    timestamp: document.querySelector('[data-ts]')?.textContent || '',
    title: document.title,
    bodyTextStart: document.body.innerText.slice(0, 300),
  };
});
console.log('STATS:', JSON.stringify(stats, null, 2));

// Desktop
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/polymax-desktop.png', fullPage: false });

// Try clicking each preset and record card count
const presetKeys = ['locked','whale','closing','longshot','all'];
const presetCounts = {};
for (const k of presetKeys) {
  const ok = await page.evaluate((k) => {
    const el = document.querySelector(`[data-preset="${k}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, k);
  if (!ok) { presetCounts[k] = 'NOT_FOUND'; continue; }
  await page.waitForTimeout(250);
  presetCounts[k] = await page.evaluate(() => document.querySelectorAll('[data-card]').length);
}
console.log('PRESET_COUNTS:', JSON.stringify(presetCounts));

// Reset to "all" then take a populated mobile shot
await page.evaluate(() => document.querySelector('[data-preset="all"]')?.click());
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/polymax-mobile-all.png', fullPage: false });

// Try Advanced drawer toggle
const advExists = await page.evaluate(() => !!document.querySelector('[data-adv-toggle]'));
console.log('ADVANCED_TOGGLE:', advExists);
if (advExists) {
  await page.evaluate(() => document.querySelector('[data-adv-toggle]').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/polymax-mobile-adv.png', fullPage: false });
  await page.evaluate(() => document.querySelector('[data-adv-toggle]').click()); // close
}

// Console errors check
const logs = await page.evaluate(() => window.__logs || []);
console.log('PAGE_LOGS:', JSON.stringify(logs));

// Compress screenshots
for (const f of ['mobile','mobile-full','desktop','mobile-all','mobile-adv']) {
  try {
    execSync(`sips -Z 900 -s formatOptions 30 -s format jpeg /tmp/polymax-${f}.png --out /tmp/polymax-${f}.jpg 2>/dev/null`);
  } catch {}
}
console.log('DONE');
