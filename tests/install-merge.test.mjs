#!/usr/bin/env node
/**
 * Tests for install.sh's settings.json merge — the wiring EVERY OTHER USER gets.
 * Run: node tests/install-merge.test.mjs
 *
 * Why this exists: v1.24.0 shipped the ChatGPT Council helpers but neither the
 * fresh-install template nor the merge wired them, so on any machine but the
 * author's it was dead code — and nothing caught it. This suite executes the
 * real python merge block extracted from install.sh against fixtures.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const REPO = join(homedir(), 'auramaxing');
const INSTALL = join(REPO, 'install.sh');
const TEMPLATE = join(REPO, 'setup', 'settings.json');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

// ── extract the merge block (the PYEOF block that defines has_hook) ──────────
const src = readFileSync(INSTALL, 'utf8');
const blocks = [...src.matchAll(/python3 - <<'PYEOF'\n([\s\S]*?)\nPYEOF/g)].map((m) => m[1]);
const merge = blocks.find((b) => b.includes('def has_hook'));

const TMP = mkdtempSync(join(tmpdir(), 'install-merge-'));
const PFX = 'export PATH="$HOME/.nvm/versions/node/v$(cat $HOME/.nvm/alias/default 2>/dev/null | tr -d \'[:space:]\' | sed \'s/^v//\')/bin:/usr/local/bin:/usr/bin:/bin:$PATH" && ';
const env = {
  ...process.env,
  _CM_PII_CMD: PFX + 'node ~/.claude/helpers/pii-redactor.mjs',
  _CM_QG_CMD: PFX + 'node ~/.claude/helpers/code-quality-gate.mjs 2>/dev/null || true',
  _CM_RR_CMD: PFX + 'node ~/.claude/helpers/rational-router-apex.mjs 2>/dev/null || true',
  _CM_SS_CMD: PFX + 'node ~/.claude/helpers/session-start.mjs || true',
  _CM_SSD_CMD: PFX + 'node ~/auramaxing/helpers/session-start-daemon.mjs 2>/dev/null || true',
  _CM_RUFLO_CMD: 'true',
  _CM_PTU_CMD: PFX + 'node ~/.claude/helpers/post-tool-use-apex.mjs 2>/dev/null || true',
  _CM_TC_CMD: PFX + 'node ~/.claude/helpers/task-complete.mjs 2>/dev/null || true',
  _CM_STOP_CMD: PFX + 'node ~/auramaxing/helpers/session-stop.mjs 2>/dev/null || true',
  _CM_DEF_CMD: PFX + 'node ~/auramaxing/helpers/defensive-handoff.mjs 2>/dev/null || true',
};

function runMerge(settingsPath) {
  const out = execFileSync('python3', ['-c', merge], {
    encoding: 'utf8', timeout: 15000, env: { ...env, _CM_SETTINGS: settingsPath },
  });
  return JSON.parse(out);
}
const cmds = (s, event) => (s.hooks?.[event] || []).flatMap((b) => (b.hooks || []).map((h) => h.command));
const hooksNamed = (s, event, name) => cmds(s, event).filter((c) => c.includes(name)).length;

console.log('\ninstall.sh — settings merge (what every other user gets)');

// ── 1. legacy user with an unrelated settings.json ──────────────────────────
const legacy = join(TMP, 'legacy.json');
writeFileSync(legacy, JSON.stringify({
  model: 'sonnet',
  hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine', timeout: 1000 }] }] },
}, null, 2));
const merged = runMerge(legacy);

ok('cablea el update-gate (updates obligatorios)', hooksNamed(merged, 'UserPromptSubmit', 'update-gate') === 1);
ok('el update-gate va PRIMERO en UserPromptSubmit',
  cmds(merged, 'UserPromptSubmit')[0]?.includes('update-gate'),
  cmds(merged, 'UserPromptSubmit')[0]?.slice(0, 80));
ok('cablea el router', hooksNamed(merged, 'UserPromptSubmit', 'rational-router-apex') === 1);
ok('cablea el ChatGPT Council en UserPromptSubmit', hooksNamed(merged, 'UserPromptSubmit', 'gpt-council') === 1);
ok('cablea el Council --stop en Stop',
  cmds(merged, 'Stop').some((c) => c.includes('gpt-council') && c.includes('--stop')));
ok('cablea los guardas de seguridad', hooksNamed(merged, 'PreToolUse', 'pii-redactor') === 1 && hooksNamed(merged, 'PreToolUse', 'code-quality-gate') === 1);
ok('respeta los hooks que el usuario ya tenía', cmds(merged, 'UserPromptSubmit').some((c) => c === 'echo mine'));
ok('no pisa el modelo elegido por el usuario', merged.model === 'sonnet');
ok('fuerza bypassPermissions + fastMode off', merged.permissions?.defaultMode === 'bypassPermissions' && merged.fastMode === false);

// ── 2. idempotence: re-running install.sh must not duplicate anything ───────
writeFileSync(legacy, JSON.stringify(merged, null, 2));
const twice = runMerge(legacy);
for (const [event, name] of [['UserPromptSubmit', 'update-gate'], ['UserPromptSubmit', 'gpt-council'],
  ['UserPromptSubmit', 'rational-router-apex'], ['Stop', 'gpt-council'], ['PreToolUse', 'pii-redactor']]) {
  ok(`idempotente: ${name} sigue apareciendo 1 vez en ${event}`, hooksNamed(twice, event, name) === 1,
    `count=${hooksNamed(twice, event, name)}`);
}

// ── 3. the fresh-install template must carry the same wiring ────────────────
const tmpl = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
ok('template: update-gate presente y primero',
  cmds(tmpl, 'UserPromptSubmit')[0]?.includes('update-gate'));
ok('template: Council en UserPromptSubmit', hooksNamed(tmpl, 'UserPromptSubmit', 'gpt-council') === 1);
ok('template: Council --stop en Stop',
  cmds(tmpl, 'Stop').some((c) => c.includes('gpt-council') && c.includes('--stop')));

// ── 4. every hook command must point at a file that actually exists ─────────
const missing = [];
for (const ev of Object.keys(tmpl.hooks || {})) {
  for (const c of cmds(tmpl, ev)) {
    const m = c.match(/node (~[^\s]+\.mjs)/);
    if (!m) continue;
    const p = m[1].replace('~', homedir());
    try { readFileSync(p); } catch { missing.push(`${ev}: ${m[1]}`); }
  }
}
ok('template: todo hook apunta a un archivo existente', missing.length === 0, missing.join(', '));

try { rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
