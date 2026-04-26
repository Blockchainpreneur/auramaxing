#!/usr/bin/env node
/**
 * AURAMAXING Diff Capturer — PostToolUse hook for Edit/Write/NotebookEdit
 *
 * Reads the tool-use JSON from stdin, extracts the change, and appends a
 * structured diff entry to ~/.auramaxing/diff-buffer-{pid}.jsonl.
 * Zero NLM calls here — purely local buffering. The buffer is drained
 * on session-stop by precompute-pipeline (or manually via nlm-writer flush).
 *
 * PRD files get a distinct `source: 'prd-edit'` tag so nlm-writer routes them
 * to versioned source entries.
 *
 * Always exits 0. Never blocks the tool call.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const AUR = join(HOME, '.auramaxing');
const BUFFER = join(AUR, `diff-buffer-${process.ppid}.jsonl`);
const MAX_DIFF_SIZE = 10 * 1024; // 10 KB

mkdirSync(AUR, { recursive: true });

function isPrd(filePath) {
  return /PRD\.md|product-requirements|prd\/.*\.md|\.auramaxing\/PRD\.md/i.test(filePath || '');
}

function isBinary(s) {
  if (!s) return false;
  // Quick heuristic: any null byte in first 512 chars
  return s.slice(0, 512).includes('\u0000');
}

function makeUnifiedDiff(oldStr, newStr, filePath) {
  const oldLines = (oldStr || '').split('\n');
  const newLines = (newStr || '').split('\n');
  const header = `--- ${filePath}\n+++ ${filePath}\n`;
  // Minimal diff: full old + full new blocks (not a real unified diff — just enough signal)
  const body = [
    ...oldLines.slice(0, 40).map(l => `- ${l}`),
    oldLines.length > 40 ? `- ...(${oldLines.length - 40} more lines)` : null,
    ...newLines.slice(0, 40).map(l => `+ ${l}`),
    newLines.length > 40 ? `+ ...(${newLines.length - 40} more lines)` : null,
  ].filter(Boolean).join('\n');
  return (header + body).slice(0, MAX_DIFF_SIZE);
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString().trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function main() {
  const input = await readInput();
  // Expected shape from PostToolUse hook: { tool, input, result, ... }
  // We handle a few shapes to be robust across Claude Code versions.
  const toolName = input.tool_name || input.tool || '';
  const toolInput = input.tool_input || input.input || {};
  const toolResult = input.tool_result || input.result || null;

  if (!/^(Edit|Write|NotebookEdit|MultiEdit)$/i.test(toolName)) process.exit(0);

  // Extract fields
  const filePath = toolInput.file_path || toolInput.path || toolInput.notebook_path;
  if (!filePath) process.exit(0);

  let oldStr = toolInput.old_string || '';
  let newStr = toolInput.new_string || toolInput.content || '';

  // For Write tool, old_string is the previous file content (may not be provided) — skip diff
  if (!oldStr && toolName === 'Write') {
    oldStr = '';
  }

  if (isBinary(oldStr) || isBinary(newStr)) process.exit(0);
  if (!oldStr && !newStr) process.exit(0);

  // Empty no-op change
  if (oldStr === newStr) process.exit(0);

  const entry = {
    ts: new Date().toISOString(),
    file: filePath,
    tool: toolName,
    prd: isPrd(filePath),
    project: basename(input.cwd || process.cwd()),
    diff: makeUnifiedDiff(oldStr, newStr, filePath),
    bytes: { old: oldStr.length, new: newStr.length },
  };

  try { appendFileSync(BUFFER, JSON.stringify(entry) + '\n'); } catch {}
  process.exit(0);
}

main().catch(() => process.exit(0));
