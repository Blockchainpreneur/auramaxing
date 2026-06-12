---
name: nlm-fix
description: Repair the NotebookLM (NLM) memory layer when auth expires or sync breaks. Use when a SessionStart message says "NLM auth expired", when nlm dead-letter/retry buffers grow, when "open Chrome and sign into notebooklm.google.com" appears, or when the user says "arregla NLM", "nlm roto", "fix notebooklm". Crystallized from the repeated manual repair flow (meta-engine: repeated request → skill).
---

# NLM Fix — auth + sync repair

NLM is AURAMAXING's deep-memory layer (see memory: NLM resolves via `python3 -m notebooklm`,
never a bare CLI). Auth lives in Chrome cookies; the bridge breaks when they expire.

## Repair sequence (run in order, stop at the first green)

1. **Diagnose** — `node ~/auramaxing/helpers/nlm-health-check.mjs` and read the verdict.
   Also check buffer pressure: dead-letter/retry counts in the SessionStart NLM banner.
2. **Cookie re-sync (cheap, fixes ~80%)** — requires the CDP Chrome running
   (`node ~/auramaxing/scripts/browser-server.mjs` if :9222 is down; NEVER kill :9222):
   `node ~/auramaxing/helpers/nlm-cookie-sync.mjs`
   The user must be signed into notebooklm.google.com in that Chrome profile — if not,
   open a tab for them: `node ~/auramaxing/scripts/browser-tab.mjs https://notebooklm.google.com`
   and tell them to sign in, then re-run the sync.
3. **Full re-auth (when cookie sync fails)** — `python3 -m notebooklm login`.
4. **Verify** — re-run `node ~/auramaxing/helpers/nlm-health-check.mjs`; expect healthy.
   Quote the output — a claim without evidence is false.
5. **Drain buffers** — if dead-letter count was large, replay what's salvageable via
   `node ~/auramaxing/helpers/nlm-replay-buffer.mjs` (auramaxing copy; if it errors,
   archive the dead-letter dir and note it — do not loop on unrecoverable entries).

## Rules
- Always run the auramaxing-side helpers (`~/auramaxing/helpers/...`) — internal execs
  point there; the `.claude` shadows were archived 2026-06-12.
- Never open a new Chrome window; tabs only, via browser-tab.mjs (CDP :9222).
- If everything fails, report the exact failing step + output and continue the session
  WITHOUT NLM (LightRAG + file memory still work) — NLM repair must never block a task.
