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
  { name: 'JWT Token',      pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,         placeholder: '[REDACTED:JWT]' },
  // Service keys with dash OR underscore prefixes (sk_live_ = Stripe SECRET key slipped past the old sk- dash rule).
  { name: 'API Key',        pattern: /\b(sk-ant-|sk-|pk_live_|sk_live_|rk_live_|Bearer\s)[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED:API_KEY]' },
  { name: 'AWS Access Key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                                  placeholder: '[REDACTED:AWS_KEY]' },
  { name: 'GitHub Token',   pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, placeholder: '[REDACTED:GH_TOKEN]' },
  { name: 'Google API Key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,                                      placeholder: '[REDACTED:GOOGLE_KEY]' },
  { name: 'GitLab Token',   pattern: /\bglpat-[A-Za-z0-9_-]{20}\b/g,                                    placeholder: '[REDACTED:GITLAB_TOKEN]' },
  { name: 'Slack Token',    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,                               placeholder: '[REDACTED:SLACK_TOKEN]' },
  { name: 'Private Key',    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,                        placeholder: '[REDACTED:PRIVATE_KEY]' },
  // NOTE: a public ETH/BTC/SOL ADDRESS is NOT a secret — it is meant to be shared (you give it
  // out to RECEIVE funds). The old `0x[40hex]` HIGH-block made it impossible to write legit crypto
  // code (every contract/token address blocked) while MISSING the actual secret. Removed (audit
  // 2026-06-16, P-4). The real fund-controlling secret — a 64-hex PRIVATE KEY / seed — is caught by
  // detectPrivateKeyHex below (P-6), which the old rules let through entirely.
];

// P-6 (audit 2026-06-16): a raw 32-byte (64-hex) PRIVATE KEY controls the wallet — leaking it =
// total loss of funds. The old gate blocked the harmless 40-hex *address* but never the key. A bare
// 64-hex is ALSO a sha256 hash / git object, so blocking all 64-hex would false-positive on hashes;
// we block ONLY when a key-ish identifier sits within ~40 chars before it (high-confidence secret),
// and log-only otherwise. Covers `privateKey = "0x<64hex>"`, `WALLET_SECRET=<64hex>`, mnemonic/seed.
// Context gap is [^\n]{0,40}? (any non-newline) so it survives JSON-stringified tool_input where the
// quote is escaped (`= \"0x…`) — a stricter class missed the backslash and let the key through.
const PRIVKEY_HEX = /(?:private|priv|secret|wallet|signer|deployer|mnemonic|seed|pk)[^\n]{0,40}?(?:0x)?[0-9a-fA-F]{64}\b/i;
function detectPrivateKeyHex(text) { return PRIVKEY_HEX.test(text); }

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
// Mnemonic seed: checks against common BIP-39 words to reduce false positives
const BIP39_COMMON = new Set([
  'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse',
  'access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act',
  'action','actor','actual','adapt','add','addict','address','adjust','admit','adult',
  'advance','advice','aerobic','affair','afford','afraid','again','age','agent','agree',
  'ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien',
  'all','alley','allow','almost','alone','alpha','already','also','alter','always',
  'amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle',
  'angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety',
  'any','apart','apology','appear','apple','approve','april','arch','arctic','area',
  'arena','argue','arm','armed','armor','army','around','arrange','arrest','arrive',
  'arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist',
  'assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit',
  'august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware',
  'awesome','awful','awkward','axis','baby','bachelor','bacon','badge','bag','balance',
  'balcony','ball','bamboo','banana','banner','bar','barely','bargain','barrel','base',
  'basic','basket','battle','beach','bean','beauty','because','become','beef','before',
  'begin','behave','behind','believe','below','belt','bench','benefit','best','betray',
]);
function detectMnemonic(text) {
  if (text.length > 50000) return false;
  const words = text.match(/\b[a-z]{3,8}\b/g) || [];
  let run = 0;
  for (const w of words) {
    if (BIP39_COMMON.has(w)) { run++; if (run >= 12) return true; }
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
    // P-6: context-flagged 64-hex private key joins the HIGH block set (the secret that controls funds).
    if (detectPrivateKeyHex(scanText)) highScan.found.push({ type: 'Private Key (hex)', count: 1 });
    if (highScan.found.length > 0) {
      writeLog(toolName, highScan.found, scanText.length);
      const types = highScan.found.map(f => f.type).join(', ');
      process.stderr.write(`\x1b[31m🚫 Safety guard stopped this\x1b[0m — found a secret (${types}) in your code.\n   Secrets don't belong in code. Remove it and try again.\n`);
      // Dual-format so EVERY CLI version honors the block (the secrets safety-net must not
      // silently fail-open on builds that require hookSpecificOutput.permissionDecision).
      const reason = `PII Shield: detected ${types} in ${toolName} input. Remove secrets before proceeding.`;
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
      }));
      process.exit(0);
    }

    // ── WARN severity: detect + warn, but NEVER mutate the code (audit 2026-06-16, P-3) ──────
    // These patterns (email, phone, $amount, BTC/SOL public addresses) used to `decision:modify`,
    // SILENTLY REWRITING the user's source on disk — e.g. `price = "$1,000.00"` → `[REDACTED:LARGE_AMOUNT]`,
    // a contact email → `[REDACTED:EMAIL]`, a public address → placeholder. In a money app that is
    // catastrophic data corruption, and these values are legit code content (public addresses, pricing,
    // support emails), NOT secrets. Now: log + a VISIBLE stderr warning, then APPROVE unchanged. Real
    // secrets are already hard-blocked above; this layer must never corrupt the loop's output.
    const warnScan = scanRules(scanText, MODIFY_RULES);
    if (warnScan.found.length > 0) {
      writeLog(toolName, warnScan.found, scanText.length);
      const types = warnScan.found.map(f => f.type).join(', ');
      process.stderr.write(`\x1b[33m[PII Shield] heads-up\x1b[0m — ${types} present in ${toolName} input (NOT modified; real secrets are blocked separately). If this is real user PII headed for a public repo, handle it deliberately.\n`);
      // Fall through to approve — do NOT modify.
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
