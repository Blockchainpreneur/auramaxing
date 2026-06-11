#!/usr/bin/env node
/**
 * AURAMAXING design-taste learning system (Phase-08 / Design-Supremacy companion).
 *
 * Records per-project design approvals/rejections and decays their weight 5%/week
 * (0.95^weeks_elapsed), so the taste profile tracks RECENT taste and lets old verdicts fade.
 * The decayed profile feeds future variant generation: query before generating design
 * variants, record the verdict after — never regenerate a look the profile already rejects.
 *
 * Storage: ~/.auramaxing/taste/<project>.json  (project = git-remote slug or cwd basename)
 *   { project, decisions: [ { ts, verdict: 'approve'|'reject', tags: [...], note } ] }
 *
 * CLI:
 *   taste.mjs record <approve|reject> "<comma,tags>" "<note>"   # log a verdict for cwd's project
 *   taste.mjs profile [--json]                                  # decayed weighted profile for cwd
 *   taste.mjs project                                           # print the resolved project key
 *
 * Decay is applied at READ time (pure: storage keeps raw ts; queries weight by 0.95^weeks).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const DIR = join(homedir(), '.auramaxing', 'taste');
const WEEK = 7 * 24 * 3600;
const DECAY = 0.95;                          // 5% per week
const now = () => Math.floor(Date.now() / 1000);

function projectKey(cwd = process.cwd()) {
  // Prefer the git remote slug (stable across clones); fall back to the dir basename.
  try {
    const url = execSync('git -C "' + cwd + '" remote get-url origin 2>/dev/null', { encoding: 'utf8', timeout: 1500 }).trim();
    const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1].replace(/[^\w.-]/g, '_');
  } catch {}
  return (cwd.split('/').filter(Boolean).pop() || 'default').replace(/[^\w.-]/g, '_');
}

function storePath(key) { return join(DIR, key + '.json'); }
function load(key) { try { return JSON.parse(readFileSync(storePath(key), 'utf8')); } catch { return { project: key, decisions: [] }; } }
function save(key, data) { try { mkdirSync(DIR, { recursive: true }); } catch {} writeFileSync(storePath(key), JSON.stringify(data, null, 2)); }

// Decayed weighted tally over tags: weight = 0.95^(weeks since the decision).
function profile(key) {
  const data = load(key);
  const t = now();
  const tags = {};   // tag -> { approve: w, reject: w }
  let nApprove = 0, nReject = 0;
  for (const d of data.decisions || []) {
    const weeks = Math.max(0, (t - (d.ts || t)) / WEEK);
    const w = Math.pow(DECAY, weeks);
    if (d.verdict === 'approve') nApprove += w; else if (d.verdict === 'reject') nReject += w;
    for (const tag of d.tags || []) {
      tags[tag] = tags[tag] || { approve: 0, reject: 0 };
      tags[tag][d.verdict === 'approve' ? 'approve' : 'reject'] += w;
    }
  }
  // Net taste per tag (approve - reject, decayed). Positive = liked, negative = rejected.
  const liked = [], disliked = [];
  for (const [tag, v] of Object.entries(tags)) {
    const net = v.approve - v.reject;
    (net >= 0 ? liked : disliked).push({ tag, net: Number(net.toFixed(3)), approve: Number(v.approve.toFixed(3)), reject: Number(v.reject.toFixed(3)) });
  }
  liked.sort((a, b) => b.net - a.net);
  disliked.sort((a, b) => a.net - b.net);
  return { project: key, totalDecisions: (data.decisions || []).length,
           decayedApprovals: Number(nApprove.toFixed(3)), decayedRejections: Number(nReject.toFixed(3)),
           liked, disliked };
}

const [, , cmd, ...args] = process.argv;
const key = projectKey();

if (cmd === 'record') {
  const verdict = (args[0] || '').toLowerCase();
  if (verdict !== 'approve' && verdict !== 'reject') { console.error('usage: taste.mjs record <approve|reject> "tags" "note"'); process.exit(1); }
  const tags = (args[1] || '').split(',').map(s => s.trim()).filter(Boolean);
  const note = args.slice(2).join(' ');
  const data = load(key);
  data.decisions.push({ ts: now(), verdict, tags, note });
  save(key, data);
  console.log(JSON.stringify({ recorded: verdict, project: key, tags, note }, null, 2));
} else if (cmd === 'project') {
  console.log(key);
} else { // profile (default)
  const p = profile(key);
  if (args.includes('--json')) { console.log(JSON.stringify(p, null, 2)); }
  else {
    console.log(`taste profile · ${p.project}  (${p.totalDecisions} decisions; decayed ✓${p.decayedApprovals} ✗${p.decayedRejections})`);
    if (p.liked.length)    console.log('  LIKED:    ' + p.liked.slice(0, 12).map(x => `${x.tag}(+${x.net})`).join(', '));
    if (p.disliked.length) console.log('  REJECTED: ' + p.disliked.slice(0, 12).map(x => `${x.tag}(${x.net})`).join(', '));
    if (!p.liked.length && !p.disliked.length) console.log('  (no taste recorded yet — record approvals/rejections to build the profile)');
  }
}
