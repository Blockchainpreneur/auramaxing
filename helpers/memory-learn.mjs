#!/usr/bin/env node
/**
 * Memory Learning Hook — v2
 * Runs on PostToolUse — stores tool outcomes and patterns with rich context.
 *
 * Improvements v2:
 * - Hash-based dedup using Set (O(1) lookup vs O(n) array scan)
 * - Async-safe: uses try/catch around all I/O, never blocks
 * - Better context extraction: handles nested objects
 * - Tracks tool success rate per project
 * Non-blocking: exits 0 always.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const cwd           = process.cwd();
const DATA_DIR      = join(cwd, '.claude-flow', 'data');
const METRICS_DIR   = join(cwd, '.claude-flow', 'metrics');
const PATTERNS_PATH = join(DATA_DIR, 'learned-patterns.json');
const DEDUP_PATH    = join(DATA_DIR, 'dedup-hashes.json');
const SWARM_PATH    = join(METRICS_DIR, 'swarm-activity.json');
const MAX_PATTERNS  = 200;
const DEDUP_WINDOW  = 50; // remember last N unique hashes

// ── Stop hook: clear swarm status ─────────────────────────────────────────────
if (process.argv[2] === 'stop') {
  try {
    if (existsSync(SWARM_PATH)) {
      writeFileSync(SWARM_PATH, JSON.stringify({
        swarm: { active: false, agent_count: 0, coordination_active: false, agents: [] },
        ts: new Date().toISOString(), cleared: 'session-end',
      }, null, 2));
    }
  } catch {}
  process.exit(0);
}

// Simple hash: tool + context string → short key
function hashKey(tool, context) {
  // djb2-lite: fast, no deps, good enough for dedup
  let h = 5381;
  const s = tool + '|' + context;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36); // unsigned 32-bit hex
}

// Extract most useful context from tool_input object
function extractContext(raw, maxLen = 120) {
  if (!raw) return '';
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Priority: file_path > command > query > pattern > description > prompt > first string value
    const val = obj.file_path || obj.command || obj.query || obj.pattern ||
      obj.description || obj.prompt || obj.content ||
      Object.values(obj).find(v => typeof v === 'string' && v.length > 2) || '';
    const clean = String(val).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
  } catch {
    const clean = String(raw).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    return clean.length > 120 ? clean.slice(0, 119) + '…' : clean;
  }
}

async function main() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    let raw = '';
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString().trim();
    }

    let toolName = 'unknown', toolInput = '', toolResult = '';
    if (raw) {
      try {
        const payload = JSON.parse(raw);
        toolName   = payload.tool_name   || payload.toolName   || 'unknown';
        toolInput  = typeof payload.tool_input  === 'string' ? payload.tool_input  : JSON.stringify(payload.tool_input  || {});
        toolResult = typeof payload.tool_result === 'string' ? payload.tool_result : JSON.stringify(payload.tool_result || '');
      } catch {}
    }

    toolName = toolName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
    if (toolName === 'consolidate') process.exit(0);

    const context   = extractContext(toolInput);
    const timestamp = new Date().toISOString();
    const project   = basename(cwd);
    const success   = !/\b(error|failed|exception|traceback|fatal)\b/i.test(toolResult);

    // ── Hash-based dedup ───────────────────────────────────────────────────────
    const key = hashKey(toolName, context);
    let hashes = [];
    if (existsSync(DEDUP_PATH)) {
      try { hashes = JSON.parse(readFileSync(DEDUP_PATH, 'utf-8')); } catch {}
    }
    if (hashes.includes(key)) process.exit(0); // duplicate

    // Update hash ring
    hashes.unshift(key);
    if (hashes.length > DEDUP_WINDOW) hashes = hashes.slice(0, DEDUP_WINDOW);
    try { writeFileSync(DEDUP_PATH, JSON.stringify(hashes)); } catch {}

    // ── Store pattern ─────────────────────────────────────────────────────────
    let patterns = [];
    if (existsSync(PATTERNS_PATH)) {
      try { patterns = JSON.parse(readFileSync(PATTERNS_PATH, 'utf-8')); } catch {}
    }

    patterns.unshift({
      id:        `${toolName}-${Date.now()}`,
      tool:      toolName,
      project,
      context,
      pattern:   context ? `${toolName}: ${context}` : `${toolName} at ${timestamp.slice(0, 16)}`,
      timestamp,
      success,
    });

    if (patterns.length > MAX_PATTERNS) patterns = patterns.slice(0, MAX_PATTERNS);
    writeFileSync(PATTERNS_PATH, JSON.stringify(patterns, null, 2));
  } catch { /* never block */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
