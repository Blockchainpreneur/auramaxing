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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const LP = process.env.AURA_LEDGER_FILE || join(homedir(), '.auramaxing', 'ledger.json');
const now = () => Math.floor(Date.now() / 1000);

function load() { try { return JSON.parse(readFileSync(LP, 'utf8')); } catch { return null; } }
function save(o) { try { mkdirSync(dirname(LP), { recursive: true }); } catch {} writeFileSync(LP, JSON.stringify(o, null, 2)); }

const [, , cmd, ...args] = process.argv;
let l = load() || { sessionId: null, ts: now(), items: [] };
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
  // ABSOLUTE GREATNESS GATE (Phase 08) — records the 3-YES pass + evidence and marks done.
  // This is the ONLY honest way to close a substantial code deliverable: Gate 3 in the
  // gatekeeper blocks turn-end while a done item lacks a `greatness` record.
  case 'great': { const it = l.items.find(x => x.id === Number(args[0]));
                  if (it) { it.greatness = { passed: true, evidence: args.slice(1).join(' ') || '(no evidence given)', ts: now() }; it.done = true; }
                  l.ts = now(); save(l); break; }
  case 'clear': { l = { sessionId: l.sessionId, ts: now(), items: [] }; save(l); break; }
  case 'status': default: break;
}

const open = l.items.filter(x => !x.done);
console.log(JSON.stringify({ sessionId: l.sessionId, open: open.length, total: l.items.length, items: l.items }, null, 2));
