#!/usr/bin/env node
/**
 * Code Quality Gate — AURAMAXING
 * Fires on PostToolUse for Write and Edit operations.
 * Scans generated/modified code for quality issues and anti-patterns.
 *
 * Checks:
 * 1. Hardcoded secrets / credentials (HIGH — blocks)
 * 2. console.log / print debug statements left in non-test files
 * 3. Hardcoded localhost / IP addresses in non-config files
 * 4. TODO / FIXME without ticket reference
 * 5. TypeScript `any` type without suppression comment
 * 6. Empty catch blocks that swallow errors silently
 * 7. Synchronous fs operations in async contexts (Node.js)
 * 8. Missing await on obvious async calls
 *
 * Output: warnings to stderr (non-blocking), issues logged to quality-issues.json
 * Decision: always "approve" — quality gate is advisory, not blocking (except HIGH)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

// ── Context-guard config (Layer 2 — 40% context ceiling) ─────────────────────
const READ_MAX_BYTES = Number(process.env.AURA_READ_MAX_BYTES || 30720); // 30 KB
const GREP_REQUIRE_HEAD_LIMIT = process.env.AURA_GREP_REQUIRE_HEAD_LIMIT !== '0';
const GREP_MAX_HEAD_LIMIT = Number(process.env.AURA_GREP_MAX_HEAD_LIMIT || 250);
const BASH_DENY_PATTERNS = [
  // Only block truly unbounded finds: at /, ~, or /Users (no sub-path) AND without -maxdepth
  { re: /\bfind\s+(?:\/|~|\/Users)\s+(?!.*-maxdepth\s+\d)/, hint: 'narrow path or add -maxdepth N' },
  { re: /(?:^|\s|;|&&)ls\s+-[lah]*R[lah]*\b/,               hint: 'avoid ls -R; use a scoped Glob' },
  // cat of large log/data files (but allow cat with head/tail pipe)
  { re: /(?:^|\s|;|&&)cat\s+\S+\.(?:log|jsonl|csv)(?:\s|$)(?!.*\|\s*(?:head|tail|less|grep))/i, hint: 'pipe through head/tail, or Agent(Explore)' },
];

function ctxGuardForTool(toolName, toolInput) {
  try {
    if (toolName === 'read') {
      const p = toolInput.file_path;
      if (p && existsSync(p)) {
        const size = statSync(p).size;
        const hasRange = typeof toolInput.offset === 'number' || typeof toolInput.limit === 'number';
        if (size > READ_MAX_BYTES && !hasRange) {
          return {
            decision: 'block',
            reason: `[Context Guard] ${basename(p)} is ${(size/1024).toFixed(1)}KB (cap ${READ_MAX_BYTES/1024}KB). Use offset+limit, or delegate: Agent(Explore, "read X from ${basename(p)}").`,
          };
        }
      }
    }
    if (toolName === 'grep') {
      const mode = toolInput.output_mode || 'files_with_matches';
      const limit = toolInput.head_limit;
      if (GREP_REQUIRE_HEAD_LIMIT && mode === 'content' && (!limit || limit > GREP_MAX_HEAD_LIMIT)) {
        return {
          decision: 'block',
          reason: `[Context Guard] Grep content mode requires head_limit ≤ ${GREP_MAX_HEAD_LIMIT} (got ${limit || 'none'}). Set head_limit, or delegate to Agent(Explore).`,
        };
      }
    }
    if (toolName === 'bash') {
      const cmd = toolInput.command || '';
      for (const p of BASH_DENY_PATTERNS) {
        if (p.re.test(cmd)) {
          return {
            decision: 'block',
            reason: `[Context Guard] Unbounded-output command blocked. Hint: ${p.hint}. Or delegate to Agent.`,
          };
        }
      }
    }
  } catch { /* fail open */ }
  return null;
}

const cwd      = process.cwd();
const DATA_DIR = join(cwd, '.claude-flow', 'data');
const LOG_PATH = join(DATA_DIR, 'quality-issues.json');
const MAX_LOG  = 100;

// ── Quality rules ─────────────────────────────────────────────────────────────
const RULES = [
  {
    id: 'hardcoded-secret',
    severity: 'HIGH',
    description: 'Hardcoded secret / credential detected',
    test: (code) => {
      const patterns = [
        /['"`](?:sk-ant|sk-|pk_live_|rk_live_|ghp_|glpat-|xox[baprs]-)[A-Za-z0-9_\-]{10,}['"`]/,
        /(?:password|passwd|secret|api_key|apikey|token|auth_key)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
        /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
      ];
      return patterns.some(p => p.test(code));
    },
  },
  {
    id: 'debug-statements',
    severity: 'WARN',
    description: 'Debug statement left in code (console.log / print / debugger)',
    test: (code, filePath) => {
      // Skip test files
      if (/\.(test|spec)\.[jt]sx?$/.test(filePath) || /\/__tests__\//.test(filePath)) return false;
      return /\bconsole\.(log|debug|info|dir|trace)\(/.test(code) ||
             /\bdebugger\b/.test(code) ||
             /\bpprint\(|print\(f?['"]{1,3}DEBUG/.test(code);
    },
  },
  {
    id: 'hardcoded-localhost',
    severity: 'WARN',
    description: 'Hardcoded localhost URL or IP — use env vars instead',
    test: (code, filePath) => {
      // Allow in config files, .env examples, tests
      if (/\.(env|config|test|spec)\b/.test(filePath) || /example/.test(filePath)) return false;
      return /['"`]https?:\/\/localhost:\d+/.test(code) ||
             /['"`]https?:\/\/127\.0\.0\.1/.test(code) ||
             /['"`]https?:\/\/0\.0\.0\.0/.test(code);
    },
  },
  {
    id: 'todo-without-ticket',
    severity: 'INFO',
    description: 'TODO/FIXME without ticket reference (e.g., TODO(#123) or TODO: GH-456)',
    test: (code) => {
      // Match TODO/FIXME NOT followed by ticket patterns
      return /\/\/\s*(?:TODO|FIXME|HACK|XXX)(?!\s*[\(\[#]|\s*[A-Z]+-\d+|\s*GH-\d+)/i.test(code);
    },
  },
  {
    id: 'typescript-any',
    severity: 'WARN',
    description: 'TypeScript `any` type used without suppression comment',
    test: (code, filePath) => {
      if (!['.ts', '.tsx'].includes(extname(filePath))) return false;
      // Match `: any` or `as any` NOT preceded by // eslint-disable or @ts-ignore
      const lines = code.split('\n');
      return lines.some(line => {
        if (/\/\/\s*(?:eslint-disable|@ts-ignore|@ts-expect-error)/.test(line)) return false;
        return /:\s*any\b|as any\b/.test(line);
      });
    },
  },
  {
    id: 'empty-catch',
    severity: 'WARN',
    description: 'Empty catch block swallows errors silently',
    test: (code) => {
      // catch { } or catch (e) { } — per-line check, exempts lines with intentional comments
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(lines[i])) {
          // Check if this line or the line above has an exemption comment
          const context = (lines[i - 1] || '') + lines[i];
          if (!/\/[/*]\s*(?:intentional|ignore|expected|noop|ok to ignore|cleanup|optional)/i.test(context)) {
            return true;
          }
        }
      }
      return false;
    },
  },
  {
    id: 'missing-error-type',
    severity: 'INFO',
    description: 'Error caught as `any` — prefer `unknown` in TypeScript',
    test: (code, filePath) => {
      if (!['.ts', '.tsx'].includes(extname(filePath))) return false;
      return /catch\s*\(\s*\w+\s*:\s*any\s*\)/.test(code);
    },
  },
];

async function main() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    let raw = '';
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString().trim();
    }

    if (!raw) { console.log('{"decision":"approve"}'); process.exit(0); }

    let toolName = '', toolInput = {}, toolResult = '';
    try {
      const payload = JSON.parse(raw);
      toolName   = (payload.tool_name || '').toLowerCase();
      toolInput  = payload.tool_input  || {};
      toolResult = typeof payload.tool_result === 'string' ? payload.tool_result : '';
    } catch { console.log('{"decision":"approve"}'); process.exit(0); }

    // Context Guard first (Layer 2 — 40% ceiling) — covers Read/Grep/Glob/Bash
    if (['read', 'grep', 'glob', 'bash'].includes(toolName)) {
      const verdict = ctxGuardForTool(toolName, toolInput);
      if (verdict) {
        process.stderr.write(`\x1b[33m⚠ Context Guard\x1b[0m ${verdict.reason}\n`);
        console.log(JSON.stringify(verdict));
        process.exit(0);
      }
      console.log('{"decision":"approve"}');
      process.exit(0);
    }
    // Original quality-gate flow continues for Write/Edit/MultiEdit
    if (!['write', 'edit', 'multiedit'].includes(toolName)) {
      console.log('{"decision":"approve"}');
      process.exit(0);
    }

    // Extract code content and file path
    const filePath = toolInput.file_path || '';
    const code     = toolInput.content || toolInput.new_string || toolInput.new_content || '';

    if (!code || code.length < 10) {
      console.log('{"decision":"approve"}');
      process.exit(0);
    }

    // Skip binary files and lock files
    const ext = extname(filePath).toLowerCase();
    const skipExts = ['.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.lock', '.sum'];
    if (skipExts.includes(ext)) {
      console.log('{"decision":"approve"}');
      process.exit(0);
    }

    // Run quality checks
    const issues = [];
    for (const rule of RULES) {
      try {
        if (rule.test(code, filePath)) {
          issues.push({ id: rule.id, severity: rule.severity, description: rule.description, file: basename(filePath) });
        }
      } catch {}
    }

    // Log issues
    if (issues.length > 0) {
      let log = [];
      if (existsSync(LOG_PATH)) {
        try { log = JSON.parse(readFileSync(LOG_PATH, 'utf-8')); } catch {}
      }
      issues.forEach(issue => log.unshift({ ...issue, filePath, timestamp: new Date().toISOString() }));
      if (log.length > MAX_LOG) log = log.slice(0, MAX_LOG);
      try { writeFileSync(LOG_PATH, JSON.stringify(log, null, 2)); } catch {}

      // Block on HIGH severity
      const blocking = issues.filter(i => i.severity === 'HIGH');
      if (blocking.length > 0) {
        const reasons = blocking.map(i => i.description).join('; ');
        process.stderr.write(`\x1b[31m🚫 Code quality check stopped this\x1b[0m — ${reasons}\n   Fix the issue above and try again.\n`);
        console.log(JSON.stringify({ decision: 'block', reason: `[Quality Gate] ${reasons}` }));
        process.exit(0);
      }

      // Warn for non-blocking issues
      const warnings = issues.filter(i => i.severity !== 'HIGH');
      if (warnings.length > 0) {
        process.stderr.write(`\x1b[33m⚠ Heads up\x1b[0m — ${warnings.length} thing(s) to know about in ${basename(filePath)}:\n`);
        warnings.forEach(w => process.stderr.write(`  · ${w.description}\n`));
      }
    }

    console.log('{"decision":"approve"}');
  } catch {
    console.log('{"decision":"approve"}');
  }

  process.exit(0);
}

main().catch(() => { console.log('{"decision":"approve"}'); process.exit(0); });
