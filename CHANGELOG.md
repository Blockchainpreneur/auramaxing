# Changelog

All notable changes to Auramaxing are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v1.18.1 — 2026-06-15

- **Box nightly → Opus 4.8 (kill the last Fable/Sonnet remnant).** The v1.17.0 Fable-only window left a box-side `fable-revert` systemd timer that would flip `NIGHTLY_MODEL` to `claude-sonnet-4-6` on 2026-06-23. Removed that timer/service on the box and set `NIGHTLY_MODEL=claude-opus-4-8` in `/root/nightly/.nightly-env`; `cloud/nightly.sh` default is now `claude-opus-4-8` (was sonnet) so redeploys stay Opus. Everything (local + box) now runs Opus 4.8 only.

## v1.18.0 — 2026-06-15

- **EVERYTHING → Opus 4.8 at max (replaces the Fable-only window).** `settings.json` `model: opus[1m]` + `effortLevel: ultracode` + `fastMode: off`; standing default enforced by `~/.auramaxing/opus-window.json` (router emits the OPUS-MAX directive; `ultramax-guard` hard-blocks any non-Opus spawn + requires `ultrathink`). ULTRAMAX & BILLION inherit Opus 4.8. `aura-delegate` reframed Sonnet→Opus fleet. `install.sh` + `setup/` templates de-Fabled (and the reinstall-time Ruflo daemon removed). Revert: delete `opus-window.json`.
- **Loop-resilience hardening of the evidence-gatekeeper (v3→v4→v5).** v3: persistent bounded re-block (`AURA_GK_MAX_NUDGES`, default 20) so a still-failing gate re-blocks on every stop attempt, not once; +4.5s self-timeout, 24h ledger freshness. v4: greatness gate decoupled from this-turn source mutation + rubber-stamp ("(no evidence given)"/empty) rejected + Bash source-edits (`sed -i`/`tee`/redirect) counted as mutation. v5: `isFail` vocabulary now covers cargo/rspec/vitest `×`/eslint `✖`/make/`exited status` (red tests were counting GREEN); `tool_result.is_error:true` wired (authoritative); RED dominates GREEN (no masking); `isSidechain` lines no longer credit the parent gate; BILLION no longer single-shot on re-block; the router AUTO-LEDGER now APPENDS across prompts instead of overwriting (multi-prompt tasks keep their deliverable).
- **3 principles** from the published-Claude-prompt audit added to `prompt-engine.mjs` + `ORCHESTRATION.md §0.8`: `[skill-first]`, `[substance-first]`, `[no-confabulation]`.
- **Security/correctness fixes** (5-agent audit): `compact-hooks.mjs` `bash -c "$(cat …)"` command-injection → structured argv; `pii-redactor` HIGH-secret block now dual-format (`permissionDecision:deny`); `~/.auramaxing` perms 700/600; serena/codegraph (uninstalled MCP) routing removed.
- **NLM browser-hijack fix**: `nlm-auth-refresh.mjs` is headless-first via `nlm-cookie-sync` (no NotebookLM tab opened); visible re-auth opt-in via `AURA_NLM_VISIBLE_AUTH=1`.
- **evals 103 → 125/125** (router 38 · hooks 87), baseline re-locked.

## v1.17.0 — 2026-06-12

- **FABLE-ONLY WINDOW (user directive): everything runs on Fable 5 until 2026-06-23, then back to normal AUTOMATICALLY.** `~/.auramaxing/fable-window.json` gates it by date (midnight Cancún): the router suppresses the Sonnet DELEGATE directive and emits the window directive on every routed prompt; the guard blocks ANY sonnet/haiku spawn outright (no frame exception) on Agent/Task/Workflow. Expires alone — zero manual reversion. Box nightly switched to `NIGHTLY_MODEL=claude-fable-5` with a PERSISTENT systemd timer (`fable-revert`, survives reboots, Persistent=true) reverting to Sonnet on Jun 23 05:05 UTC and disabling itself.
- Eval harness self-neutralizes the live window (deterministic suite regardless of the active window; dedicated cases test active/expired explicitly).
- **evals 103/103** (+4 window cases), baseline re-locked.

## v1.16.0 — 2026-06-12

- **BILLION WATCHDOG — mechanical anti-stop (user report: "stopping before achieving the given goals and revenue").** Sticky mode kept the engine ARMED but nothing mechanically forced continuation: the gatekeeper blocked once per turn (anti-wedge) and the model stopped anyway. Now, while the session's BILLION flag is armed AND its ledger has open objectives, EVERY stop attempt is re-blocked with a continuation NUDGE (resume-first → next autonomous objective → schedule continuation), bounded by a nudge budget (`AURA_BILLION_NUDGES`, default 12 per user prompt; router resets the counter each prompt — cap reached/objectives closed/"billion off" → allow, so it can never wedge). This is the doctrine's Parte-7 watchdog, in-harness: continuation is the SYSTEM's property, not the model's whim.
- **evals 99/99** (+5 watchdog: nudges-on-stop, counter persists, cap respected, closed-objectives allow, other-session immune; normal one-block loop-guard behavior preserved), baseline re-locked.

## v1.15.0 — 2026-06-12

- **BILLION is now STICKY + RESILIENT (user report: "se está apagando").** Root cause: the mode was per-task — any follow-up prompt without the keyword cleared the flag and killed the engine. Now the keyword arms a session-scoped sticky flag (`billion-mode.json`, rolling 24h refreshed per prompt); every subsequent prompt of the session keeps BILLION+ULTRAMAX+guard active. Only `billion off`/`apaga billion`, the 4 exit conditions, or 24h idle clear it. Live state machine 5/5: arm → persist on plain prompt → other-session isolation → explicit off → stays off.
- **The perpetual 50→3 cycle (user directive):** from each forced-quota round the tournament selects EXACTLY the 3 maximum-leverage ideas (leverage = impact × autonomous-executability ÷ effort — not the easiest 3), all 3 execute to completion through L2/L3, and only then the 50-ideas exercise re-runs on the new world-state. Losers archived per round.
- **Resilience mandates:** resume-first (read STATE/GOALS and continue the open objective on every prompt while active), one ledger item per objective (completeness gate blocks silent stops), and a turn may not end without a closed objective gate OR a scheduled continuation (ScheduleWakeup//loop/cron) — otherwise zero-tolerance violation.
- **False positive caught by the new evals:** "billón **para** dominar" — the Spanish preposition "para" matched the off-words and killed the mode; off-regex tightened.
- **evals 94/94** (+5 sticky state machine, +3 top-3/sticky anchors), baseline re-locked.

## v1.14.0 — 2026-06-12

- **Full self-audit (ULTRAMAX fleet: 2 Fable auditors + main).** 21+ verified findings, all fixed:
  - **Truth pass on CLAUDE.md/AUTOPILOT-FLOW/CAPABILITIES** (19 findings, 8 operationally-false): fastMode claimed on (off), Ruflo claimed active (disabled), phantom MCP roster (sentry/supabase/github/figma/n8n/firecrawl/sequential-thinking removed; serena/codegraph were never installed — 5 task routes pointed at them, now route Grep/Glob+Explore), agent-browser CLI missing, wrong CLI names (notebooklm-py→`python3 -m notebooklm`), stale counts.
  - **Helper graveyard cleaned:** 32 .claude helpers audited → 15 DEAD (12 stale shadows of live auramaxing twins + 3 dead-both) archived to `_archived-2026-06-12/`. Key structural truth: runtime is SPLIT — 12 hooks run from .claude, 7 from auramaxing, and ALL internal cross-helper execs point at auramaxing. New `drift-all-helper-pairs` eval guards every remaining mirror pair (was only 4 of 28).
  - **Loop coverage now literally every routed prompt:** full Perfection Loop ≥30 complexity, new GOAL LOOP (COMPACT) for routed tasks <30 (docs/retro/browse — depth scales, discipline doesn't). Fixed a live silent-drop: Spanish actionable prompts with no English rule match ("escribe un post…") exited the router with zero output — now fall back to the build route with the full loop.
  - **Meta-engine applied:** new `nlm-fix` skill (crystallized from the repeated NLM auth-repair flow; auth is broken right now per SessionStart). Skill candidates logged: /taste, ledger, self-heal.
- **evals 89/89** (+3 coverage cases +1 universal drift), baseline re-locked.

## v1.13.0 — 2026-06-11

- **BILLION MODE — The Billion-Dollar Perpetual Engine.** Keyword `billion`/`billón` in any prompt → inherits ULTRAMAX in full (Fable-5-only fleet at MAX presets + 3-lock guard) and layers the mega-loop from the user's blueprint, now canonical at `docs/BILLION-ENGINE.md`: 5 nested loops (Horizon $1B-thesis ⊃ Mission ⊃ Goal ⊃ Execution ⊃ Reason-Act, parent-gate verification at every level), the forced-quota engine (50 ideas in marked blocks — never stop at 12 or 30), the 5 adversarial tournaments (output · interview-before-build · kill-your-company · negotiation · 80-page second opinion), autonomous-executability ranking, the 8-stage chain to $1B + measurable ladder, the anti-stop structured turn close, and the permission matrix.
- **HUMAN-INDEPENDENCE (hard principle #4, per user directive):** the plan contains ONLY engine/multi-agent-executable tasks — never assigns work to a human; humans get SUGGESTIONS.md entries, never dependencies; approval-gated items are optional accelerators the loop routes around. The plan succeeds even if the human does nothing or disappears.
- New `billion-engine` skill (operating protocol: state files under `~/.auramaxing/billion/<project>/`, quota blocks, tournament judge sets as parallel Fable spawns, anti-stop block). Router: tier `FABLE 5 · BILLION`, complexity 95, dominant BILLION directive; ultramax typo-tolerance extended to `ultramas`.
- **evals 85/85** (+4: billion activates engine incl. HUMAN-INDEPENDENCE/QUOTA/TOURNAMENT anchors, billón Spanish, `billing` must NOT trigger, `ultramas` typo), baseline re-locked.

## v1.12.1 — 2026-06-11

- **Per-session ledger (Critical fix, found live).** Concurrent Claude sessions shared ONE global `~/.auramaxing/ledger.json` and clobbered each other — one session's router overwrote the other's open items and one session's `great` stamped the other's deliverable (observed live: a parallel session's Vercel-deploy evidence landed on this session's item), silently fail-opening Gates 2/3. Now: router writes `~/.auramaxing/ledger/<sessionId>.json`; the gatekeeper reads its own session's file (legacy fallback intact); `ledger.mjs` gains `--session <id>` (gatekeeper/router messages include it) + newest-fresh-file fallback. 3 isolation evals added.
- **evals 81/81**, baseline re-locked.

## v1.12.0 — 2026-06-11

- **The Perfection Loop is IDENTICAL in normal and ULTRAMAX mode — only model delegation changes.** Per-phase /goal binding (one visible task per Perfection-Loop phase 00–11, closed only with gate evidence) now applies on EVERY actionable prompt, not just under ULTRAMAX.
- **AUTO-INVOKE — the heart of the autopilot, explicit.** The GOAL LOOP directive now mandates that every phase composes AND CALLS its tools automatically (gstack skills, MCP, subagents/fleet, Bash) per the task→tool table — never ask permission mid-loop, never describe a tool call instead of making it.
- **SONNET AT MAXIMUM — 10x forced diligence.** Sonnet is only useful next to Fable under forced max presets + heavy prompt engineering: every Sonnet/Haiku worker prompt MUST carry "ultrathink" (max extended thinking) + the ZERO-TOLERANCE frame + acceptance test + evidence contract (returns must quote real run output) + banned phrases (auto-REJECT). Wired into the router's DELEGATE directive and the aura-delegate skill (new harness rule 9).
- **Guard normal mode (mechanical enforcement).** `ultramax-guard.mjs` now also enforces WITHOUT the ultramax flag: any Agent/Task/Workflow spawn explicitly targeting sonnet/haiku is hard-blocked unless its prompt/script carries "ultrathink" AND the ZERO-TOLERANCE frame. Fable/inherit spawns untouched; kill-switch intact.
- **evals 78/78** (+6 normal-mode guard cases, +1 delegate-sonnet-max router case; failopen-other-session migrated to opus), baseline re-locked.

## v1.11.0 — 2026-06-11

- **The Perfection Loop now reaches EVERY actionable prompt — including Spanish.** `ACTION_VERBS` was English-only, so Spanish prompts ("verifica", "aplica", "arregla"…) never triggered the goal-loop/ledger/Perfection-Loop directives. Now bilingual with stem matching for conjugations (aplic-, verific-, arregl-, mejor-, termin-, integr-…).
- **ULTRAMAX can never be silently dropped.** Detection moved BEFORE every router early-exit: a Spanish/short/question-phrased ultramax prompt used to leave the router with NO directive at all (no rule match → silent exit). Now: no-match falls back to the generic build route, questions bypass the question-filter, trivial scores bypass the <3% exit — the ULTRAMAX directive always fires.
- **ULTRAMAX per-phase /goal binding + max presets, explicit.** The GOAL LOOP directive under ULTRAMAX now mandates one visible task per Perfection-Loop phase (00–11), closed only with gate evidence; directive points (4)(5) pin MAXIMUM presets everywhere (main agent ultrathink every phase; main + fleet at the ultracode session max — per-spawn effort is not yet a platform surface, tracked upstream as anthropics/claude-code#25591).
- **update-check.sh semver fix (Critical).** Version comparison was string inequality — local 1.10.0 vs remote 1.9.0 produced a blocking "UPDATE REQUIRED → 1.9.0" downgrade banner (lexicographic 1.10.0 < 1.9.0). New numeric per-segment `ver_gt`, applied on the slow path AND re-validating the 720-min cache path; poisoned caches purged.
- **evals 72/72** (+5: 3 ver_gt regression checks, ultramax-spanish-fallback, spanish-action-gets-loop), baseline re-locked.

## v1.10.0 — 2026-06-11

- **ULTRAMAX v2 — Fable-5 fleet at MAXIMUM presets** — per the user's directive, ULTRAMAX no longer means "zero delegation": it now means delegation is allowed but ONLY to **Fable 5 multi-agents at max capability** — every Agent/Task spawn inherits the Fable session default (claude-fable-5 + effortLevel ultracode) or sets `model:"fable"`, every spawned prompt MUST carry **"ultrathink"** (maximum extended-thinking budget), and Workflow scripts may not override any agent onto a non-Fable model. The aura-delegate Sonnet protocol stays suspended, but its zero-tolerance discipline transfers to the Fable fleet (atomic specs + acceptance tests, returns gated on outcomes).
- **ultramax-guard v2 (3 locks)** — the PreToolUse guard now enforces: (1) model lock (non-Fable Agent/Task spawn → block), (2) max-thinking lock (spawn prompt missing "ultrathink" → block with re-issue instructions), (3) workflow lock (`model: "sonnet"|"haiku"|"opus"` in a Workflow script → block). Matcher widened `Agent|Task` → `Agent|Task|Workflow` in settings.json. Still fail-open (no flag / other session / stale / kill-switch → approve).
- **Typo-tolerant trigger** — `ultramax`, `ultra max`, `ultra-max`, `uktramax` all activate the mode (real user typos observed); near-misses (`ultra maximal`, `ultramaximal`) stay silent.
- **evals 67/67** (+12: 9 ultramax-guard cases incl. drift check, 2 router ULTRAMAX-v2 anchors, 1 typo-tolerance + 1 spaced-keyword case), baseline re-locked.

## v1.9.0 — 2026-06-11

- **Zero-Tolerance loop embedded in EVERY Sonnet delegation** — per the user's directive, every delegated sub-task now carries the 8 Zero-Tolerance Rules + the Tier-2 micro-loop (scope+20x hypothesis → build → /qa → /review+/cso → improve → Absolute Greatness Gate) as a forcing frame, so the cheaper worker model is driven to its ceiling. Wired into both the router's DELEGATE directive and the `aura-delegate` skill harness (new rule 8); a worker return missing the loop evidence is rejected on sight. (CLAUDE.md's aspirational framing is intentional semantic priming — left as-is by design.)
- **self-heal.mjs wired live (was 100% dead code)** — all 5 exports were unreferenced; `post-tool-use-apex.mjs` reimplemented a weaker tool-only inline version. Now the hook dynamically imports self-heal's `getBestStrategy` (read) + `recordSuccess` (write), keyed by the router's task classification (`task-tool`), so logged strategies actually inform behavior on the next failure. Dynamic import + optional-chaining = cannot crash the hot path. Verified: read-half surfaces a seeded strategy, write-half records under the task+tool key.
- **evals 55/55** stable (router 25 · hooks 30); transient dips this session were machine-thrash flakiness (swap), confirmed by paired clean reruns.

## v1.8.0 — 2026-06-10

- **THE ABSOLUTE PERFECTION LOOP** — the user's 12-phase / 3-tier production loop is now the authoritative doctrine (`docs/ORCHESTRATION.md` §0.0), emitted on every action task by the router (normal + ULTRAMAX), with the 8 Zero-Tolerance Rules as the constitution.
  - **Tier 1 Foundation** (00 /office-hours 6Q + /plan-ceo-review · 01 moat research + ≥3 "10x because Y" hypotheses · 02 /plan-eng-review architecture lock) → **Tier 2 micro detail loop** per atomic detail (03 scope+3 refs+20x hypothesis · 04 build+tests ≥35% · 05 /qa+/browse+/codex · 06 /review+/cso+quantified moat gap · 07 improve+re-/qa+20x binary · 08 Absolute Greatness Gate) → **Tier 3 ship** (09 /review+/ship+/cso+/docs · 10 e2e /qa+moat check · 11 /retro+memory).
- **Gate 3 — Absolute Greatness Gate (mechanically enforced)** — `evidence-gatekeeper.mjs` now blocks turn-end once when code changed AND the deliverable was marked done WITHOUT a recorded greatness pass (the 3 binary YES questions). Clears via the new `ledger.mjs great <id> "<evidence>"`. Fail-open, session-scoped, ≤1 block/turn (cannot wedge). Verified 8/8 offline + live runtime block→allow cycle.
- **Design-taste learning** — new `taste.mjs`: per-project approval/rejection profile that decays 5%/week (`0.95^weeks`, verified exact) and feeds future variant generation; query before generating, record the verdict after.
- **Router**: every action task emits the Perfection-Loop reference + 8 Zero-Tolerance Rules + the 3 greatness questions + the `ledger great` close instruction.
- **evals 55/55** (+5: 3 Gate-3, ledger-great, taste-decay), baseline re-locked. `AURA_LEDGER_FILE` override added for isolated testing.

## v1.7.0 — 2026-06-10

- **ULTRAMAX mode** — type `ultramax` anywhere in a prompt and the ENTIRE task runs on Fable 5 exclusively: zero delegation (no Sonnet/Haiku workers, no `model:` downgrade on any Agent/Task spawn, no box fleet), full AURAMAXING structure preserved (visible goal-loop, phased-excellence, anti-laziness, evidence gates) — Fable does every part itself.
  - Router (`rational-router-apex.mjs`): detects the keyword, forces complexity→85 (full phased-excellence + ultrathink), shows `FABLE 5 · ULTRAMAX` in the display, suppresses the aura-delegate directive, and unshifts a dominant ULTRAMAX directive. Per-task (not sticky): a plain prompt clears the session flag.
  - Enforcement (`ultramax-guard.mjs`, new PreToolUse hook on Agent|Task): hard-blocks any non-Fable spawn while ULTRAMAX is active for the session — instructions alone aren't enforcement. Fail-open (missing/stale/mismatched flag, parse error, or `AURA_ULTRAMAX_OFF=1` → approve); session-scoped + 2h freshness so it never wedges a later session.
  - Verified: 9/9 guard behavior matrix (block sonnet/opus, allow no-model/fable/other-session/stale/kill-switch/non-agent) + 2 router regression cases. evals 50/50.

## v1.6.0 — 2026-06-10

- **Visible goal-loop on every action prompt** — router now turns every action task (complexity ≥30) into a `/goal`-focused loop: the first tool call must be a TaskCreate step-list (audit·investigate·plan·execute·verify), one step in_progress at a time, each marked complete with evidence as its gate passes. The visible task list + the durable ledger (Gate 2) are the two trackers; the turn ends only when every step is done.
- **Context lean ceiling 35%→55% + suppression flipped** — `context-threshold-monitor` ceiling raised to 55% (soft 45%); the old "do NOT recommend /clear, wait for native auto-compact (~95%)" rule — the actual reason context never stayed lean — is replaced with a one-line safe `/clear` recommendation at 55% (work is staged + auto-resumes). A hook cannot press the button; this makes the user/native-compact trigger fire at the lean ceiling instead of ~95%.
- **Phantom-tool purge** — router recommended 4 uninstalled tools on a large fraction of prompts: `serena` (5×), `codegraph` (4×), `agent-browser` (2×), `sequential-thinking` (6×). All 17 references replaced with real, always-available equivalents (Grep/Glob + Explore agent for code/symbol nav, browser-tab.mjs CDP for browsing, native ultrathink for sequential reasoning). Eval cases that hard-coded the ghost names updated to assert the real tools.
- **evals 48/48**, runtime copies synced.

## v1.5.0 — 2026-06-10

- **Nightly Engine** — autonomous overnight improvement loop on the box (02:00–08:00 America/Cancun, systemd `aura-nightly.timer` @ 07:00 UTC, `Persistent=true`): per project — fresh clone → AUDIT (Sonnet, hooks OFF) → FIX (≤3/round, ≤4 rounds) → deterministic test gate (fail ⇒ revert) → commit → push to `aura/nightly-<date>` (never main). Zero Mac involvement.
- `cloud/nightly.sh` (box driver) + `cloud/nightly-projects.conf` (repo list + per-repo test command) + `cloud/nightly-install.sh` (idempotent deploy, `--gh-token`) + `cloud/nightly-report.sh` (fetch morning report).
- Fix: nightly.sh now sources `/root/nightly/.nightly-env` explicitly — systemd timer runs don't inherit sshd's PermitUserEnvironment, so the GH token never reached scheduled runs.
- Box provisioned: node v18.19.1 + npm 9.2.0 for test gates; GH PAT installed for private repos (4 active projects).
- Verified: 2 end-to-end smoke runs on the box (audit found 10 real issues; gate executed the real suite and correctly reverted failing fixes; report + log written).

## v1.4.0 — 2026-06-10

- **install: global-by-default** — installer now always installs the AURAMAXING CLAUDE.md as the user's global `~/.claude/CLAUDE.md` (timestamped backup of any pre-existing file; opt out with `--keep-claude-md`).
- **install: portable for all users** — purged all machine-specific values from `setup/` (personal `additionalDirectories` removed); `setup/settings.json` now uses a `__HOME__` placeholder rendered at install time, so the global setup works natively on any machine.
- **mandatory update gate** — new `helpers/update-gate.mjs` UserPromptSubmit hook: when a newer version is published, prompts are blocked until `bash ~/auramaxing/scripts/update.sh` is run. Blocks via stdout `{"decision":"block"}` (wrapper-safe) AND exit 2 (raw wiring). Fail-open on missing/stale state or any error (<300ms, no inline network; offline users are never bricked); kill-switch `AURA_UPDATE_GATE_OFF=1`.
- **scripts/update.sh** — one-command updater: `git pull --ff-only` + idempotent `install.sh` re-run + state reset.
- **scripts/update-check.sh `--write-state`** — atomically persists version state to `~/.auramaxing/update-state.json` for the gate; session-start uses it and escalates the banner to UPDATE REQUIRED.
- **evals: 48/48** — 4 new gate regression cases (block-on-newer, allow-current, fail-open-missing-state, kill-switch); runtime eval copy re-synced with repo (fixes 41-case drift).

## [1.3.1] - 2026-06-10

### Docs
- Documented the **Fable→Sonnet Orchestration Engine** in `docs/ORCHESTRATION.md` §0.7 (the always-on automatic loop: intercept → build ledger → gatekeeper-enforce → delegate to Sonnet under gates), including the **honest economics** (realistic ~25–40% Fable / 60–75% Sonnet token split; ~30–50% cost reduction vs Fable-solo; NOT a measured 10× / 90-10). Distributed reference so every install's doctrine matches the live engine.
- Broadened the auto-ledger to intercept every action task at complexity ≥30 (was ≥50).

## [1.3.0] - 2026-06-10

### Added — `aura-delegate` skill (orchestration engine, phase 2)
- New auto-invoked skill encoding the **strict Fable→Sonnet delegation protocol**: Fable stays a terse orchestrator (plan · spec · accept/reject · fuse · crucial edits ≈5–10% of tokens); Sonnet workers do the bulk (≈90–95%) under a draconian gated harness (atomic fully-specced sub-task + acceptance test, plan-before-code, mandatory self-critique, deterministic gate on return, 2-of-3 redundancy on critical, Reflexion on failure). Delegation runs via `Agent` (model: sonnet) or the box `orchestra.sh ORCH_MODEL=claude-sonnet-4-6`. The router auto-references it on complex action tasks; the auto-ledger + gatekeeper enforce the non-stop loop.
- **Honest scope (in-skill):** one session = one model (Fable spawns Sonnet workers, not token-level switching); Sonnet ≠ Fable on hard reasoning (why the crucial 5–10% stays on Fable); the 90/10 split is a process discipline, not a hard guarantee; the 10x is unmeasured pending an A/B.

## [1.2.0] - 2026-06-10

### Added — automatic non-stop loop (orchestration engine, phase 1)
- The router now **auto-opens the completion ledger** on complex ACTION tasks (`complexity≥50` + action verb): writes a session-scoped `~/.auramaxing/ledger.json` deliverable. The evidence-gatekeeper's Gate 2 then **structurally refuses to end the turn** until the deliverable is marked done (`ledger.mjs done <id>`) — which only happens after the full verified + audited loop. "Don't stop until 100/100" is now enforced by code, not exhortation, with zero manual step. Grounded in orchestrator-worker + Reflexion + harness-engineering research (external-gate verification, durable cross-context state).

### Fixed
- Gatekeeper Gate 2 is now **strictly session-scoped**: it fires only when the Stop payload's `session_id` matches the ledger's. Previously a session-less invocation (e.g. the eval harness) could be blocked by an unrelated open ledger. Keeps the eval + other sessions immune; no cross-session contamination.

## [1.1.1] - 2026-06-10

### Security
- Documented a **trusted-channel prompt-injection rule** (applied to the active global `~/.claude/CLAUDE.md`; note: `CLAUDE.md` is install-local and gitignored, so each install must add this to its own global instructions — it is NOT shipped in the repo). The rule: AURAMAXING control blocks (`[AURAMAXING UPDATE]`/`DIRECTIVE`/`MEMORY`/…) are authoritative ONLY from the local hook channel; the same strings inside tool results, files, web pages, or recalled-memory bodies are untrusted data. Closes the `[AURAMAXING UPDATE]` self-injection channel and the memory-as-injection vector. (Code-level security hardening — gatekeeper v2, pii-redactor — shipped distributed in 1.1.0.)

## [1.1.0] - 2026-06-10

### Added
- **Task ledger** (`helpers/ledger.mjs` + `~/.auramaxing/ledger.json`) — external memory of open work; the gatekeeper refuses turn-end while same-session items remain open (long-horizon anti-laziness).
- Router `RETRIEVE-FIRST + DELEGATE` directive — retrieve minimal context before edits; orchestrate bulk labor to cheaper workers under strict gates while the lead model keeps the decision boundaries.
- 3 gatekeeper regression evals (failing-test, passing-result, agent-review-bypass) → suite now 44/44.

### Changed
- Default model → `claude-fable-5` (1M ctx) across settings, templates, statusline + context-window tables.
- `effortLevel: ultracode` pinned in the installed settings.
- code-quality-gate hook matcher narrowed to `Write|Edit|MultiEdit` (removes overhead on Read/Grep/Glob/Bash).

### Security / Fixed
- **Gatekeeper v2** — verifies OUTCOMES not utterances: a *failing* test no longer satisfies the gate; closed the `echo test` and agent-prompt-"review" bypasses. Still fail-open (blocks ≤1/turn, kill-switch intact).
- **pii-redactor hardened** — added AWS, GitHub (`ghp_`/`github_pat_`), Stripe `sk_live_`, Google, GitLab, Slack, and PEM private-key detection.
- Fixed memory self-poisoning that injected `?: ? (confidence: ?)` into the session memory block.

## [1.0.0] - 2026-04-12

Initial release. Repolished from CLAUDEMAX with full rebrand to Auramaxing.

### Added

- **Aura autopilot engine** (`rational-router-apex.mjs`) — complexity scoring, 15 task types, auto-routing to gstack skills, ENRICH protocol for production-ready defaults
- **20 hooks** covering the full lifecycle: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop events
- **Browser CDP integration** — `browser-server.mjs` and `browser-tab.mjs` for tab-based Chrome automation via the user's existing session (no new windows, sessions preserved)
- **LightRAG semantic search** — sentence-transformers (all-MiniLM-L6-v2, 384-dim), 500-doc index with oldest-first pruning, content-based vector dedup
- **NotebookLM integration** — core memory layer with per-project notebooks, deep recall fallback, NLM-compressed session briefings (~100 tokens, 87% reduction), auto auth refresh via Chrome CDP
- **PII redactor** (`pii-redactor.mjs`) — PreToolUse gate that blocks API keys, tokens, passwords, and credentials before Write/Edit/Bash executes
- **Code quality gate** (`code-quality-gate.mjs`) — PreToolUse scanner for hardcoded secrets (block), debug statements, `any` types, and empty catch blocks (warn)
- **Self-healing engine** (`self-heal.mjs`) — records winning strategies, retries up to 3 alternatives on failure, persists outcomes to `~/.auramaxing/learnings/`
- **Statusline** with MAXING label — displays model, context%, weekly limit%, real cost vs API cost
- **Prompt engine** with anti-laziness system — 5-step planning gate, NLM-generated directives, task-specific CLAUDE.md segments (~500 tokens vs ~6,000 full)
- **Memory lifecycle** — session-start loads, prompt-engine searches (LightRAG + NLM), session-stop saves, NLM compresses in background
- **Intent predictor** — analyzes recent sessions to predict next task for precomputation
- **10-step precompute pipeline** — runs in background after session stop (vector dedup, knowledge graph, intent prediction, LightRAG rebuild)
- **Token optimization** — average ~478 tokens/prompt (down from ~1,200-2,750), prompt deduplication, per-task CLAUDE.md segments
- **State daemon** (port 57821) — persistent project state across hooks
- **Cross-project knowledge graph** — scans gstack + Claude memory across all projects
- **Type-aware memory pruning** — 50 sessions, 30 prompts, 10 decisions with oldest-first eviction

### Fixed

- Shell injection in router (`execSync` replaced with `execFileSync` + stdin)
- Question filter blocking investigation queries
- NLM cache key collision (SHA256 replaces 40-char truncation)
- Anti-laziness regex stripping digits from task names (e.g., `e2e-testing`)
- Memory pruning flooding (separate limits by type)
- False-positive failure detection in post-tool-use hook

### Changed

- Full rebrand from CLAUDEMAX to Auramaxing — all paths, references, environment blocks, and display strings updated
- Autopilot engine renamed from Ripple to Aura
- All data paths moved to `~/.auramaxing/`
- Project root at `~/auramaxing/`
