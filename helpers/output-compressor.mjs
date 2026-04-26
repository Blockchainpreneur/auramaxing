#!/usr/bin/env node
/**
 * AURAMAXING Output Compressor — PostToolUse hook (Layer 3 — 40% ceiling)
 *
 * Caps any single tool's output contribution to context. If tool_result exceeds
 * OUTPUT_MAX_BYTES, stashes full output at ~/.auramaxing/tool-outputs/{hash}.txt
 * and replaces body with a compact summary + retrieval hint.
 *
 * Response protocol:
 *   { "decision": "modify", "tool_result": "<compressed>" }  — replace output (if supported)
 *   { "decision": "approve" }                                — unchanged
 *
 * Applies only to read-heavy tools: Read, Grep, Glob, Bash.
 * Never compresses Edit/Write results (would break downstream review).
 * Always exits 0. Fail-open on any error.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const STASH = join(HOME, '.auramaxing', 'tool-outputs');
const OUTPUT_MAX_BYTES = Number(process.env.AURA_OUTPUT_MAX_BYTES || 5120); // 5 KB
const SUMMARY_HEAD = 400;
const SUMMARY_TAIL = 200;
const STASH_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

mkdirSync(STASH, { recursive: true });

// Best-effort stash prune — skip files older than TTL at write time
function pruneOldStash() {
  try {
    const now = Date.now();
    const { readdirSync, statSync, unlinkSync } = require('fs');
    for (const f of readdirSync(STASH)) {
      const full = join(STASH, f);
      try {
        const age = now - statSync(full).mtimeMs;
        if (age > STASH_TTL_MS) unlinkSync(full);
      } catch {}
    }
  } catch {}
}

function compress(output, toolName) {
  const hash = createHash('sha256').update(output).digest('hex').slice(0, 12);
  const file = join(STASH, `${hash}.txt`);
  try { if (!existsSync(file)) writeFileSync(file, output); } catch {}
  const lineCount = output.split('\n').length;
  const head = output.slice(0, SUMMARY_HEAD).replace(/\n/g, ' ').trim();
  const tail = output.slice(-SUMMARY_TAIL).replace(/\n/g, ' ').trim();
  return [
    `[OUTPUT-COMPRESSED tool=${toolName} size=${output.length}B lines=${lineCount} hash=${hash}]`,
    `head: ${head}${output.length > SUMMARY_HEAD ? '…' : ''}`,
    output.length > SUMMARY_HEAD + SUMMARY_TAIL ? `tail: …${tail}` : '',
    `retrieve: cat ~/.auramaxing/tool-outputs/${hash}.txt`,
  ].filter(Boolean).join('\n');
}

async function main() {
  try {
    if (process.stdin.isTTY) { console.log('{"decision":"approve"}'); process.exit(0); }
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) { console.log('{"decision":"approve"}'); process.exit(0); }

    let payload;
    try { payload = JSON.parse(raw); }
    catch { console.log('{"decision":"approve"}'); process.exit(0); }

    const toolName = (payload.tool_name || '').toLowerCase();
    const result = typeof payload.tool_result === 'string'
      ? payload.tool_result
      : JSON.stringify(payload.tool_result || '');

    // Only compress read-heavy tools
    if (!['read', 'grep', 'bash', 'glob'].includes(toolName)) {
      console.log('{"decision":"approve"}'); process.exit(0);
    }
    if (!result || result.length <= OUTPUT_MAX_BYTES) {
      console.log('{"decision":"approve"}'); process.exit(0);
    }

    const compressed = compress(result, toolName);
    process.stderr.write(`[Output Compressor] ${toolName} ${result.length}B → ${compressed.length}B (stash=${compressed.match(/hash=(\w+)/)?.[1] || '?'})\n`);
    console.log(JSON.stringify({ decision: 'modify', tool_result: compressed }));

    // Opportunistic cleanup (~1% of runs)
    if (Math.random() < 0.01) pruneOldStash();
  } catch {
    try { console.log('{"decision":"approve"}'); } catch {}
  }
  process.exit(0);
}
main().catch(() => { try { console.log('{"decision":"approve"}'); } catch {} process.exit(0); });
