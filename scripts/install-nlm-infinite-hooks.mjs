#!/usr/bin/env node
/**
 * AURAMAXING — Install NLM Infinite-Memory Hooks
 *
 * Idempotently patches ~/.claude/settings.json to add:
 *   - UserPromptSubmit: nlm-live-recall.mjs (live retrieval + speculative pre-fetch)
 *   - PostToolUse[Edit|Write|MultiEdit|NotebookEdit]: diff-capturer.mjs
 *   - Stop: aura-session-flush.mjs (drains diff buffer, flushes NLM writes, triggers weekly synth)
 *
 * Backs up settings.json before each modification.
 * Safe to re-run (detects existing entries by unique fingerprint).
 *
 * Usage: node install-nlm-infinite-hooks.mjs [--dry-run] [--rollback]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const SETTINGS = join(HOME, '.claude', 'settings.json');
const BACKUP = `${SETTINGS}.bak.nlm-infinite.${Date.now()}`;
const DRY = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

const PATH_PREFIX = `export PATH="$HOME/.nvm/versions/node/v$(cat $HOME/.nvm/alias/default 2>/dev/null | tr -d '[:space:]' | sed 's/^v//')/bin:/usr/local/bin:/usr/bin:/bin:$PATH"`;

function hookCmd(relativeHelper, timeout = 1500) {
  return {
    type: 'command',
    command: `${PATH_PREFIX} && node ~/auramaxing/helpers/${relativeHelper} 2>/dev/null || true`,
    timeout,
  };
}

const FINGERPRINTS = {
  'nlm-live-recall.mjs': 'nlm-live-recall.mjs',
  'diff-capturer.mjs': 'diff-capturer.mjs',
  'aura-session-flush.mjs': 'aura-session-flush.mjs',
};

function hasHookFor(hooks, fingerprint) {
  if (!Array.isArray(hooks)) return false;
  return hooks.some(block =>
    (block.hooks || []).some(h => (h.command || '').includes(fingerprint))
  );
}

function addHook(settings, event, block) {
  settings.hooks ||= {};
  settings.hooks[event] ||= [];
  settings.hooks[event].push(block);
}

function removeHookByFingerprint(settings, event, fingerprint) {
  if (!settings.hooks?.[event]) return 0;
  const before = settings.hooks[event].length;
  settings.hooks[event] = settings.hooks[event].filter(block =>
    !(block.hooks || []).some(h => (h.command || '').includes(fingerprint))
  );
  return before - settings.hooks[event].length;
}

function main() {
  if (!existsSync(SETTINGS)) {
    console.error(`settings.json not found at ${SETTINGS}`);
    process.exit(1);
  }

  // Back up
  if (!DRY && !ROLLBACK) {
    copyFileSync(SETTINGS, BACKUP);
    console.log(`✓ Backup: ${BACKUP}`);
  }

  const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
  let changes = 0;

  if (ROLLBACK) {
    for (const [event, events] of Object.entries(settings.hooks || {})) {
      for (const fp of Object.values(FINGERPRINTS)) {
        const n = removeHookByFingerprint(settings, event, fp);
        if (n) { console.log(`✓ Removed ${n} hook(s) for ${fp} from ${event}`); changes += n; }
      }
    }
  } else {
    // 1. UserPromptSubmit: nlm-live-recall (registered AFTER existing prompt-engine/rational-router — so runs last)
    if (!hasHookFor(settings.hooks?.UserPromptSubmit, FINGERPRINTS['nlm-live-recall.mjs'])) {
      addHook(settings, 'UserPromptSubmit', {
        hooks: [hookCmd('nlm-live-recall.mjs', 1500)],
      });
      console.log('✓ Added UserPromptSubmit: nlm-live-recall.mjs (1500ms budget)');
      changes++;
    } else {
      console.log('- UserPromptSubmit: nlm-live-recall.mjs already present');
    }

    // 2. PostToolUse[Edit|Write|MultiEdit|NotebookEdit]: diff-capturer
    if (!hasHookFor(settings.hooks?.PostToolUse, FINGERPRINTS['diff-capturer.mjs'])) {
      addHook(settings, 'PostToolUse', {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [hookCmd('diff-capturer.mjs', 1000)],
      });
      console.log('✓ Added PostToolUse[Edit|Write|MultiEdit|NotebookEdit]: diff-capturer.mjs');
      changes++;
    } else {
      console.log('- PostToolUse: diff-capturer.mjs already present');
    }

    // 3. Stop: aura-session-flush
    if (!hasHookFor(settings.hooks?.Stop, FINGERPRINTS['aura-session-flush.mjs'])) {
      addHook(settings, 'Stop', {
        hooks: [hookCmd('aura-session-flush.mjs', 2000)],
      });
      console.log('✓ Added Stop: aura-session-flush.mjs');
      changes++;
    } else {
      console.log('- Stop: aura-session-flush.mjs already present');
    }
  }

  if (changes === 0) {
    console.log('\nNo changes needed.');
    if (!DRY && !ROLLBACK) try { require('fs').unlinkSync(BACKUP); } catch {}
    return;
  }

  if (DRY) {
    console.log('\n[dry-run] Would write:');
    console.log(JSON.stringify(settings, null, 2));
    return;
  }

  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`\n✓ settings.json updated (${changes} change${changes === 1 ? '' : 's'})`);
  console.log(`  Rollback: node ${process.argv[1]} --rollback`);
}

main();
