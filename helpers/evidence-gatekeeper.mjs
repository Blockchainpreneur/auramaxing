#!/usr/bin/env node
/**
 * AURAMAXING Evidence Gatekeeper (Stop hook) — the anti-laziness teeth.
 *
 * Text directives are exhortation; this is STRUCTURE. It blocks the turn from ending when the
 * assistant mutated source code but produced ZERO verification evidence (no test/build/typecheck/
 * lint run, no /qa·/review·/cso). Forces evidence-based completion instead of "should work".
 *
 * SAFETY (fail-open by design — never trap the user):
 *  - Honors `stop_hook_active`: if we already blocked once this turn, ALLOW (no infinite loop).
 *  - Kill-switch: AURA_GATEKEEPER_OFF=1 disables entirely.
 *  - Only gates real SOURCE files (.ts/.tsx/.js/.py/.css/...), never docs/markdown/json/config.
 *  - Any parse/IO error → ALLOW. Blocks at most ONCE per turn. 2s hard timeout.
 */
import { readFileSync, existsSync } from 'fs';

const ALLOW = () => process.exit(0);
if (process.env.AURA_GATEKEEPER_OFF === '1') ALLOW();
const timeout = setTimeout(ALLOW, Number(process.env.AURA_GK_TIMEOUT_MS) || 1800);

// Source extensions that warrant verification when changed. Docs/config intentionally excluded.
const SRC = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|php|css|scss|sql)$/i;
// Bash commands that count as real verification.
// Match real test/build/lint RUNNERS only. Unambiguous runners match anywhere; the generic verbs
// (test/build/lint/check) match ONLY at command position (start, or after ; && || |) behind a real
// runner like npm/yarn/pnpm/bun/make — so `echo test`, `cat tests/x`, `ls test/` no longer pass the
// gate (the substring-bypass the 10x self-audit found at this line).
const VERIFY_CMD = /\b(vitest|jest|pytest|playwright|tsc|eslint|ruff|mypy|pyright|rspec|phpunit)\b|\bcargo\s+(test|check|clippy)\b|\bgo\s+test\b|\bdotnet\s+test\b|\bdeno\s+(test|check)\b|\bnode\s+--(check|test)\b|(?:^|[;&|]\s*)(?:npm|yarn|pnpm|bun|make)\s+(?:run\s+)?(?:test|build|lint|type-?check|check)\b/i;
// gstack/skills that count as verification.
const VERIFY_SKILL = new Set(['qa', 'qa-only', 'review', 'cso', 'verify', 'investigate', 'design-review', 'benchmark', 'canary']);

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString().trim() || '{}'); } catch { return {}; }
}

function toolUsesSinceLastUserTurn(transcriptPath) {
  // Returns { mutated:[files], verified:bool } for the current turn.
  const raw = readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  // Find the last GENUINE user prompt (type user, content not a tool_result).
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    const t = o.type || o.role;
    if (t !== 'user') continue;
    const c = o.message?.content ?? o.content;
    const s = typeof c === 'string' ? c : JSON.stringify(c || '');
    if (!s.includes('tool_result')) { start = i; break; }
  }
  const mutated = [];
  let verified = false;
  for (let i = start; i < lines.length; i++) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    const content = o.message?.content ?? o.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || item.type !== 'tool_use') continue;
      const name = item.name || '';
      const inp = item.input || {};
      if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') {
        const fp = inp.file_path || inp.notebook_path || '';
        if (SRC.test(fp)) mutated.push(fp);
      }
      if (name === 'Bash' && typeof inp.command === 'string' && VERIFY_CMD.test(inp.command)) verified = true;
      if (name === 'Skill' && VERIFY_SKILL.has((inp.skill || '').toLowerCase())) verified = true;
      if ((name === 'Task' || name === 'Agent') && /\b(test|verify|qa|review|audit|lint|typecheck)\b/i.test(JSON.stringify(inp))) verified = true;
    }
  }
  return { mutated: [...new Set(mutated)], verified };
}

async function main() {
  try {
    const input = await readStdin();
    if (input.stop_hook_active) ALLOW();                 // already blocked once this turn → never loop
    const tp = input.transcript_path;
    if (!tp || !existsSync(tp)) ALLOW();                  // can't inspect → fail-open

    const { mutated, verified } = toolUsesSinceLastUserTurn(tp);
    if (mutated.length === 0 || verified) ALLOW();        // no source change, or already verified → done

    // Source changed with zero verification evidence → BLOCK once, demand proof.
    const sample = mutated.slice(0, 6).map(f => '  - ' + f.replace(process.env.HOME || '~', '~')).join('\n');
    const reason = [
      'EVIDENCE GATE — do NOT stop yet. You changed source code but ran ZERO verification this turn:',
      sample,
      '',
      'Before ending, produce EVIDENCE (not "should work"):',
      '  1. ROOT CAUSE — state it with file:line (for a fix). A symptom patch is not acceptable.',
      '  2. RUN the real check — tests / build / typecheck / lint (or /qa · /review · /cso) and PASTE the output.',
      '  3. REGRESSION — add or run a test that would have caught this; show it passing.',
      '  4. If anything fails, fix and re-run. Loop to green (100/100), then stop.',
      'Set AURA_GATEKEEPER_OFF=1 only if verification is genuinely impossible here.',
    ].join('\n');
    clearTimeout(timeout);
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  } catch {
    ALLOW();                                              // any error → fail-open
  }
}
main().catch(ALLOW);
