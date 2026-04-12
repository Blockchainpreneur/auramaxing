#!/usr/bin/env node
/**
 * PII Redaction PreToolUse Hook
 * Scans tool_input for sensitive data before Write/Edit/Bash executes.
 *
 * Claude Code PreToolUse hook response protocol (stdout JSON):
 *   { "decision": "approve" }                           — let tool run unchanged
 *   { "decision": "block", "reason": "..." }            — stop the tool, show reason
 *   { "decision": "modify", "tool_input": { ... } }     — run with redacted input
 *
 * HIGH severity (API key, JWT, ETH addr) → block
 * LOW/MEDIUM severity (email, phone, BTC, Solana) → modify (redact) + log
 * False-positive-prone rules (hex key, mnemonic) → log only, approve
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';

const LOG_DIR  = join(process.cwd(), '.claude-flow', 'data');
const LOG_PATH = join(LOG_DIR, 'pii-redaction-log.json');
const MAX_LOG  = 100;

// HIGH severity — block the tool call outright
const HIGH_RULES = [
  { name: 'JWT Token',   pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,     placeholder: '[REDACTED:JWT]' },
  { name: 'API Key',     pattern: /\b(sk-ant-|sk-|pk_live_|rk_live_|Bearer\s)[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED:API_KEY]' },
  { name: 'Eth Address', pattern: /\b0x[0-9a-fA-F]{40}\b/g,                                        placeholder: '[REDACTED:WALLET_ADDR]' },
];

// MODIFY severity — redact value but allow tool to run
const MODIFY_RULES = [
  { name: 'Email Address',  pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, placeholder: '[REDACTED:EMAIL]' },
  { name: 'Phone Number',   pattern: /(\+1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g,   placeholder: '[REDACTED:PHONE]' },
  { name: 'Large Amount',   pattern: /\$\s?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]{2})?/g,              placeholder: '[REDACTED:LARGE_AMOUNT]' },
  // Solana: exactly 43-44 base58 chars, not inside a word
  { name: 'Solana Address', pattern: /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{43,44}(?![A-Za-z0-9])/g, placeholder: '[REDACTED:SOL_ADDR]' },
  // Bitcoin: starts with 1 or 3, base58, 26-34 chars — requires non-alnum boundary
  { name: 'Bitcoin Address',pattern: /(?<![A-Za-z0-9])[13][a-km-zA-HJ-NP-Z1-9]{25,33}(?![A-Za-z0-9])/g, placeholder: '[REDACTED:BTC_ADDR]' },
];

// LOG-ONLY — too noisy to block/modify; just record detection
// Mnemonic seed: programmatic check (no regex backtracking risk)
function detectMnemonic(text) {
  if (text.length > 50000) return false; // skip huge payloads
  const words = text.match(/\b[a-z]{3,8}\b/g) || [];
  // Find runs of 12+ consecutive short lowercase words (BIP-39 style)
  let run = 0;
  for (const w of words) {
    if (w.length >= 3 && w.length <= 8) { run++; if (run >= 12) return true; }
    else run = 0;
  }
  return false;
}

function scanRules(text, rules) {
  let out  = text;
  const hit = [];
  for (const rule of rules) {
    const m = out.match(rule.pattern);
    if (m) {
      hit.push({ type: rule.name, count: m.length });
      out = out.replace(rule.pattern, rule.placeholder);
    }
  }
  return { text: out, found: hit };
}

function writeLog(toolName, found, inputLength) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    let log = [];
    if (existsSync(LOG_PATH)) {
      try { log = JSON.parse(readFileSync(LOG_PATH, 'utf-8')); } catch { log = []; }
    }
    log.unshift({ timestamp: new Date().toISOString(), tool: toolName, redacted: found, inputLength });
    if (log.length > MAX_LOG) log = log.slice(0, MAX_LOG);
    writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
    try { chmodSync(LOG_PATH, 0o600); } catch { /* non-critical */ }
  } catch { /* never block */ }
}

async function main() {
  let rawInput = '';
  let payload  = null;
  let toolName = 'unknown';

  try {
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      rawInput = Buffer.concat(chunks).toString().trim();
    } else {
      rawInput = process.argv[2] || '';
    }

    if (!rawInput) {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // Parse Claude Code hook payload
    try {
      payload  = JSON.parse(rawInput);
      toolName = (payload.tool_name || 'unknown').toLowerCase();
    } catch {
      // Raw text input (e.g. manual testing)
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    const toolInput = payload.tool_input || {};
    const scanText  = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

    // Skip trivially small inputs
    if (!scanText || scanText.length < 10) {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // ── HIGH severity: block ─────────────────────────────────────────────────
    const highScan = scanRules(scanText, HIGH_RULES);
    if (highScan.found.length > 0) {
      writeLog(toolName, highScan.found, scanText.length);
      const types = highScan.found.map(f => f.type).join(', ');
      process.stderr.write(`\x1b[31m🚫 Safety guard stopped this\x1b[0m — found a secret (${types}) in your code.\n   Secrets don't belong in code. Remove it and try again.\n`);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:   `PII Shield: detected ${types} in ${toolName} input. Remove secrets before proceeding.`,
      }));
      process.exit(0);
    }

    // ── MODIFY severity: redact and allow ────────────────────────────────────
    const modScan = scanRules(scanText, MODIFY_RULES);
    if (modScan.found.length > 0) {
      writeLog(toolName, modScan.found, scanText.length);
      const types = modScan.found.map(f => f.type).join(', ');
      process.stderr.write(`[PII Shield] REDACTED — ${types}\n`);
      // Reconstruct the tool_input with redacted content
      let redactedInput;
      try {
        redactedInput = typeof payload.tool_input === 'string'
          ? modScan.text
          : JSON.parse(modScan.text);
      } catch {
        redactedInput = modScan.text;
      }
      process.stdout.write(JSON.stringify({
        decision:   'modify',
        tool_input: redactedInput,
      }));
      process.exit(0);
    }

    // ── LOG-ONLY: mnemonic seed check ────────────────────────────────────────
    if (detectMnemonic(scanText)) {
      writeLog(toolName, [{ type: 'Possible Mnemonic Seed', count: 1 }], scanText.length);
      process.stderr.write(`[PII Shield] WARNING — possible mnemonic seed phrase detected (log only)\n`);
      // Don't block — too many false positives; just log
    }

    // All clear
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  } catch {
    // On any error, approve to never block legitimate work
    try { process.stdout.write(JSON.stringify({ decision: 'approve' })); } catch { /* noop */ }
  }

  process.exit(0);
}

main().catch(() => {
  try { process.stdout.write(JSON.stringify({ decision: 'approve' })); } catch { /* noop */ }
  process.exit(0);
});
