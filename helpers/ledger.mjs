#!/usr/bin/env node
/**
 * AURAMAXING task ledger — external memory of OPEN work for the current session.
 *
 * The evidence-gatekeeper Stop hook refuses to let the turn end while this ledger has open
 * items for the current session (the long-horizon anti-laziness forcing function: the model
 * cannot quietly drop later phases of a big task — the ledger remembers what context forgot).
 *
 * Fail-open contract: the gatekeeper IGNORES a ledger that is missing, stale (>6h), malformed,
 * or stamped with a different session. So a buggy/forgotten ledger can never wedge a turn.
 *
 * CLI:
 *   ledger.mjs init <sessionId> '<json-array-of-descs>'   # open a ledger with phases
 *   ledger.mjs add  "<desc>"                               # append an item
 *   ledger.mjs done <id>                                   # mark an item complete
 *   ledger.mjs clear                                       # close the ledger (no open items)
 *   ledger.mjs status                                      # print current state (default)
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

// Per-session ledgers (~/.auramaxing/ledger/<sessionId>.json) — concurrent Claude
// sessions used to CLOBBER one global ledger.json (one session's `great` stamped the
// other's item; gates silently fail-opened). Resolution: AURA_LEDGER_FILE (tests) >
// --session <id> > newest per-session file (<6h) > legacy ~/.auramaxing/ledger.json.
import { readdirSync, statSync, existsSync } from 'fs';
const LDIR = process.env.AURA_LEDGER_DIR || join(homedir(), '.auramaxing', 'ledger');
const argvRaw = process.argv.slice(2);
const sIdx = argvRaw.indexOf('--session');
const SESSION = sIdx >= 0 ? (argvRaw[sIdx + 1] || '') : '';
if (sIdx >= 0) argvRaw.splice(sIdx, 2);
function resolveLP() {
  if (process.env.AURA_LEDGER_FILE) return process.env.AURA_LEDGER_FILE;
  if (SESSION) return join(LDIR, `${SESSION}.json`);
  try {
    const fresh = readdirSync(LDIR).filter(f => f.endsWith('.json'))
      .map(f => ({ f, m: statSync(join(LDIR, f)).mtimeMs }))
      .filter(x => Date.now() - x.m < 6 * 3600e3)
      .sort((a, b) => b.m - a.m);
    if (fresh.length) return join(LDIR, fresh[0].f);
  } catch {}
  return join(homedir(), '.auramaxing', 'ledger.json');
}
const LP = resolveLP();
const now = () => Math.floor(Date.now() / 1000);

function load() { try { return JSON.parse(readFileSync(LP, 'utf8')); } catch { return null; } }
// F7 (audit 2026-06-17) — atomic write (temp+rename). The gatekeeper reads this file from a separate
// process on every Stop; a non-atomic writeFileSync could be observed half-written → JSON.parse throws
// → the completeness/greatness gate silently fail-opens. temp+rename is atomic on one filesystem.
function writeJsonAtomic(file, o) {
  try { mkdirSync(dirname(file), { recursive: true }); } catch {}
  const data = JSON.stringify(o, null, 2);
  try { const tmp = `${file}.tmp.${process.pid}`; writeFileSync(tmp, data); renameSync(tmp, file); }
  catch { try { writeFileSync(file, data); } catch {} }
}
function save(o) { writeJsonAtomic(LP, o); }

const [cmd, ...args] = argvRaw;
// Default sessionId to --session when creating a fresh ledger (and backfill a null one):
// a ledger born via bare `add` used to carry sessionId:null, which silently failed migrate's
// `src.sessionId === from` guard — open items then died on compact handoff (found 2026-07-03).
let l = load() || { sessionId: SESSION || null, ts: now(), items: [] };
if (!l.sessionId && SESSION) l.sessionId = SESSION;
if (!Array.isArray(l.items)) l.items = [];
const nextId = () => l.items.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;

switch (cmd) {
  case 'init': {
    const sid = args[0] || '';
    let descs = [];
    try { descs = JSON.parse(args[1] || '[]'); } catch { descs = args.slice(1).filter(Boolean); }
    if (!Array.isArray(descs)) descs = [descs];
    l = { sessionId: sid, ts: now(),
          items: descs.map((d, i) => ({ id: i + 1, desc: String(typeof d === 'string' ? d : (d && d.desc) || d), done: false })) };
    save(l); break;
  }
  case 'add':   { l.items.push({ id: nextId(), desc: args.join(' '), done: false }); l.ts = now(); save(l); break; }
  case 'done':  { const it = l.items.find(x => x.id === Number(args[0])); if (it) it.done = true; l.ts = now(); save(l); break; }
  // CONVERGENT REFINEMENT (2026-06-18) — record ONE refinement round on an item. The deliverable
  // enters an infinite refinement loop and only closes when a round yields NO further improvement
  // (convergence). Gate 3 refuses to accept a `great` close on a `refineRequired` item until at
  // least AURA_GK_MIN_REFINE rounds are recorded — so "max refinement" is PROVEN, not asserted.
  //   ledger.mjs refine <id> "<what improved this round / 'converged: nothing left to improve'>"
  case 'refine': { const it = l.items.find(x => x.id === Number(args[0]));
                   if (it) { if (!Array.isArray(it.refinements)) it.refinements = [];
                             it.refinements.push({ round: it.refinements.length + 1, delta: args.slice(1).join(' ') || '(unspecified)', ts: now() }); }
                   l.ts = now(); save(l); break; }
  // ADVERSARIAL PASS (2026-06-20) — record an INDEPENDENT critic's attack + the fix. Greatness on a
  // refineRequired deliverable requires this (or a real /review·/cso·/codex run in the session):
  // self-certification is not greatness. The note must describe what was attacked and what changed.
  //   ledger.mjs adversary <id> "<critic attacked X · found Y · fixed Z>"
  case 'adversary': { const it = l.items.find(x => x.id === Number(args[0]));
                      if (it) it.adversary = { note: args.slice(1).join(' ') || '', ts: now() };
                      l.ts = now(); save(l); break; }
  // ABSOLUTE GREATNESS GATE (Phase 08) — records the 3-YES pass + evidence and marks done.
  // This is the ONLY honest way to close a substantial code deliverable: Gate 3 in the
  // gatekeeper blocks turn-end while a done item lacks a `greatness` record.
  case 'great': { const it = l.items.find(x => x.id === Number(args[0]));
                  if (it) { it.greatness = { passed: true, evidence: args.slice(1).join(' ') || '(no evidence given)', ts: now() }; it.done = true; }
                  l.ts = now(); save(l); break; }
  case 'clear': { l = { sessionId: l.sessionId, ts: now(), items: [] }; save(l); break; }
  // L6 (audit 2026-06-17) — handoff-aware migration. After auto-compact a NEW session_id is assigned;
  // the gatekeeper is STRICTLY session-scoped, so the pre-compact ledger is orphaned and Gate 2/3
  // silently fail-open across the handoff. `migrate <fromSid> <toSid>` re-stamps the predecessor's
  // still-OPEN items onto the successor session (done items are history, dropped). Called by the
  // PostCompact hook with the lineage staged at PreCompact. Isolation-safe: only the explicit
  // predecessor is adopted — a random concurrent session is never touched.
  case 'migrate': {
    const from = args[0] || '', to = args[1] || '';
    if (from && to && from !== to) {
      try {
        const src = JSON.parse(readFileSync(join(LDIR, `${from}.json`), 'utf8'));
        if (src && src.sessionId === from && Array.isArray(src.items)) {
          const toFile = join(LDIR, `${to}.json`);
          let dst = { sessionId: to, ts: now(), items: [] };
          try { const ex = JSON.parse(readFileSync(toFile, 'utf8')); if (ex && ex.sessionId === to && Array.isArray(ex.items)) dst = ex; } catch {}
          let mid = dst.items.reduce((m, x) => Math.max(m, x.id || 0), 0);
          for (const it of src.items) if (it && !it.done) dst.items.push({ ...it, id: ++mid });
          dst.ts = now();
          writeJsonAtomic(toFile, dst);
        }
      } catch {}
    }
    break;
  }
  case 'status': default: break;
}

const open = l.items.filter(x => !x.done);
console.log(JSON.stringify({ sessionId: l.sessionId, open: open.length, total: l.items.length, items: l.items }, null, 2));
