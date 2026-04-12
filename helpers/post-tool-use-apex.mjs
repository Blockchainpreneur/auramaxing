#!/usr/bin/env node
/**
 * PostToolUse APEX — AURAMXING
 *
 * Runs after every tool call. Three auto-actions:
 * 1. Logs tool events for completion diagram
 * 2. Detects failures and triggers self-healing (3 retries)
 * 3. Forwards to daemon
 *
 * Always exits 0. Non-blocking.
 */
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { request } from 'http';

const DIR = join(homedir(), '.auramxing');
const SESSION_PID = process.ppid || process.pid;
const EVENTS_FILE = join(DIR, `turn-events-${SESSION_PID}.jsonl`);
const LEARNINGS_DIR = join(DIR, 'learnings');

mkdirSync(DIR, { recursive: true });
mkdirSync(LEARNINGS_DIR, { recursive: true });

try {
  let body = '';
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    body = Buffer.concat(chunks).toString();
  }

  let event = {};
  try { event = JSON.parse(body); } catch {}

  const toolName = event.tool_name || 'unknown';
  const input = event.tool_input || {};
  const response = event.tool_response || event.tool_result || '';
  const responseStr = typeof response === 'string' ? response : JSON.stringify(response);

  // ── 1. Log tool event ─────────────────────────────────────────
  const entry = { tool: toolName, ts: Date.now() };
  if (input.file_path) entry.file = input.file_path;
  if (input.command) entry.cmd = String(input.command).slice(0, 80);
  appendFileSync(EVENTS_FILE, JSON.stringify(entry) + '\n');

  // ── 2. Self-healing: detect failures and log ──────────────────
  // Smart failure detection: check structure first, then patterns
  let isFailure = false;
  try {
    // For Bash: check exit code if available
    if (toolName === 'Bash' || toolName === 'bash') {
      isFailure = /Exit code [1-9]|exit code [1-9]|command not found|permission denied/i.test(responseStr);
    } else if (toolName === 'Read') {
      isFailure = /File does not exist|ENOENT|Permission denied/i.test(responseStr);
    } else if (toolName === 'Edit' || toolName === 'Write') {
      isFailure = /ENOENT|EACCES|not found|Permission denied|old_string.*not found/i.test(responseStr);
    } else if (toolName === 'Agent') {
      isFailure = /error|failed|timed out/i.test(responseStr) && !/completed|success/i.test(responseStr);
    } else {
      // Generic: only flag if the response is short (likely an error message) AND contains error keywords
      isFailure = responseStr.length < 500 && /\b(error|ENOENT|EACCES|denied|refused|timed out)\b/i.test(responseStr);
    }
  } catch { isFailure = false; }

  if (isFailure && toolName !== 'unknown') {
    const key = `${toolName}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
    const failFile = join(LEARNINGS_DIR, `${key}-failure.json`);

    // Log the failure
    let failures = [];
    try { failures = JSON.parse(readFileSync(failFile, 'utf8')); if (!Array.isArray(failures)) failures = [failures]; } catch {}
    failures.push({
      ts: new Date().toISOString(),
      tool: toolName,
      error: responseStr.slice(0, 200),
      input: JSON.stringify(input).slice(0, 200),
      type: 'failure',
    });
    writeFileSync(failFile, JSON.stringify(failures.slice(-5), null, 2));

    // Output self-healing suggestion to stdout (Claude reads this)
    const successFile = join(LEARNINGS_DIR, `${key}-success.json`);
    if (existsSync(successFile)) {
      try {
        const success = JSON.parse(readFileSync(successFile, 'utf8'));
        if (success.strategy) {
          process.stdout.write(`[AURAMXING SELF-HEAL] ${toolName} failed. Previously successful strategy: ${success.strategy}\n`);
        }
      } catch {}
    } else {
      // Suggest alternatives based on tool type
      const alternatives = {
        Bash: 'Try a different command approach or check permissions',
        Edit: 'Read the file first to verify the old_string exists exactly',
        Write: 'Check directory exists and file is not read-only',
        Read: 'Verify file path is correct and file exists',
        Agent: 'Try running the task directly instead of spawning an agent',
        WebFetch: 'Use firecrawl CLI instead: firecrawl scrape <url>',
        WebSearch: 'Use firecrawl CLI: firecrawl search <query>',
      };
      const alt = alternatives[toolName];
      if (alt) {
        process.stdout.write(`[AURAMXING SELF-HEAL] ${toolName} failed. Try: ${alt}\n`);
      }
    }
  }

  // ── 3. Log success for self-healing ───────────────────────────
  if (!isFailure && toolName !== 'unknown') {
    // Record successful tool use pattern (lightweight)
    const key = `${toolName}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
    const successFile = join(LEARNINGS_DIR, `${key}-success.json`);
    // Only write if there was a prior failure (tracks recovery)
    const failFile = join(LEARNINGS_DIR, `${key}-failure.json`);
    if (existsSync(failFile)) {
      writeFileSync(successFile, JSON.stringify({
        ts: new Date().toISOString(),
        tool: toolName,
        strategy: `Use ${toolName} with: ${JSON.stringify(input).slice(0, 100)}`,
        confidence: 7,
        type: 'success',
      }, null, 2));
    }
  }

  // ── 4. Forward to daemon ──────────────────────────────────────
  const payload = JSON.stringify({ tool: toolName, cwd: process.cwd(), raw: body.slice(0, 200) });
  const req = request({
    hostname: 'localhost', port: 57821, path: '/tool-event', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
} catch {}

process.exit(0);
