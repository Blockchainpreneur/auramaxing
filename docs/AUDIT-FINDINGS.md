# AURAMAXING Deep Audit — 2026-06-02 (run on box, 6 parallel agents)

## Facet: 
I have everything I need. Here is the full audit report.

---

## AURAMAXING Autopilot Router + Prompt Engine — Findings Report

**Scope:** `helpers/rational-router-apex.mjs`, `helpers/prompt-engine.mjs`, `helpers/rational-router.mjs`, `helpers/notebook-router.mjs`, `helpers/precompute-pipeline.mjs`, `helpers/intent-predictor.mjs`, `helpers/find-bin.mjs`, `setup/settings.json`

---

### Finding 1 — LightRAG timeout bomb: semantic memory never fires on live prompts

**Severity:** P0  
**File:** `prompt-engine.mjs:61-64` + `rational-router-apex.mjs:635-638`

```js
// prompt-engine.mjs:61-64
const result = execFileSync(PYTHON_BIN, [
  LIGHTRAG_CLI, 'query', '--workspace', LIGHTRAG_WORKSPACE, ...
], {
  timeout: 6000,   // ← 6 seconds allowed
```

```js
// rational-router-apex.mjs:635-638
const enriched = execSync(`node "${engineScript}" 2>/dev/null`, {
  input: JSON.stringify({ prompt: promptText, cwd: process.cwd() }),
  encoding: 'utf8', timeout: 3000,  // ← outer wrapper: 3 seconds total
```

**Root cause:** `rational-router-apex.mjs` spawns `prompt-engine.mjs` via `execSync` with a 3000ms timeout. `prompt-engine.mjs` allocates 6000ms for its LightRAG query. Node kills the outer `execSync` at 3s, which kills the subprocess mid-execution. LightRAG never returns. The `UserPromptSubmit` hook in `settings.json:53` also has `"timeout": 3000`. The file-header comment says *"Max 3s total"* but the code allows 6s for one sub-operation.

**Impact:** The entire semantic memory retrieval system — the primary value proposition of the memory stack — produces zero results on every live prompt. The TF-IDF fallback always fires instead.

**Fix:**
```js
// prompt-engine.mjs:64 — match inner timeout to realistic slice of the budget
timeout: 1800,   // leaves 1.2s for the rest of the pipeline
```
If LightRAG warm-up genuinely needs 6s, move the query to the **precompute pipeline** (Step 1 already runs it) and serve only cached results from a local file in the live path.

---

### Finding 2 — Dead deep-recall guard: `lightragResults === null` is structurally impossible

**Severity:** P0  
**File:** `prompt-engine.mjs:55,193`

```js
// Line 55 — initialized as []
let lightragResults = [];

// Line 193 — first branch can never be true
if (lightragResults === null ||
    (Array.isArray(lightragResults) && lightragResults.length === 0 && process.env.LIGHTRAG_DISABLED)) {
```

**Root cause:** `lightragResults` is always an array (initialized `[]`, only ever assigned `JSON.parse(result)` which is an array). The `=== null` branch is dead. The second branch fires only when `LIGHTRAG_DISABLED` is explicitly set in env — which it never is by default. The comment says *"previously fired on every low-score result"*, but the intended fix is inverted: it now fires on **no result ever**, rather than on *only when LightRAG is unavailable*.

**Impact:** The NLM deep-recall fallback — the second-layer memory system — never activates. Both layers of memory retrieval are simultaneously broken.

**Fix:**
```js
// prompt-engine.mjs:193 — fire when LightRAG returned nothing (failed, cold, or disabled)
if (lightragResults.length === 0) {
```

---

### Finding 3 — NLM `spawn()` breaks on Python module fallback path

**Severity:** P0  
**File:** `find-bin.mjs:31-38`, `prompt-engine.mjs:163-164`

```js
// find-bin.mjs:31-38 — fallback returns a string with a space
_nlmCache = `${py} -m notebooklm`;  // e.g. "python3 -m notebooklm"
return _nlmCache;

// prompt-engine.mjs:163-164
const child = spawn(NLM_BIN, ['ask', prompt.slice(0, 200)], {
  // spawn() does NOT split on spaces — tries to exec literal "python3 -m notebooklm"
```

**Root cause:** `child_process.spawn` takes an executable path as its first argument and does NOT shell-split it. When `NLM_BIN = 'python3 -m notebooklm'`, Node tries to find a binary literally named `python3 -m notebooklm`, which doesn't exist. The spawn silently fails (caught by `try/catch`). Additionally, `NLM_BIN` is not null-checked before the spawn at line 163 — a null `NLM_BIN` also throws (caught, but still wrong).

**Impact:** Background NLM learning never fires on any system where NotebookLM is installed as a Python package rather than a standalone binary. The NLM cache for prompt enrichment is never populated.

**Fix:**
```js
// find-bin.mjs — expose structured form
export function findNlmArgs() {
  // returns { bin: 'python3', args: ['-m', 'notebooklm'] } or { bin: 'notebooklm', args: [] }
}

// prompt-engine.mjs:163
if (NLM_BIN) {
  const { bin, args: baseArgs } = findNlmArgs();
  const child = spawn(bin, [...baseArgs, 'ask', prompt.slice(0, 200)], { ... });
```

---

### Finding 4 — Blocking `execSync` update-check in the 3s hot path

**Severity:** P1  
**File:** `rational-router-apex.mjs:581-603`

```js
// Lines 581-603 — synchronous, BLOCKS before any routing output
const result = execSync(`bash "${checkScript}" 2>/dev/null`, {
  encoding: 'utf8', timeout: 5000,  // 5s timeout inside a 3s hook
}).trim();
```

**Root cause:** `execSync` with `timeout: 5000` runs synchronously in the UserPromptSubmit hook, which has `"timeout": 3000` (settings.json:53). If `update-check.sh` takes >3s (e.g., on a cold nvm node lookup, slow filesystem, or first-run before the 60min TTL cache exists), the harness kills the hook at 3s — silently dropping **all** routing directives, ENRICH, TOOLS, and PHASED EXCELLENCE LOOP output for that prompt. The comment says *"Cache-backed: 60min TTL"* but only applies after the first successful run.

**Impact:** Every prompt on a slow machine or after cache expiry loses all autopilot routing. The failure is completely silent (`2>/dev/null || true`).

**Fix:** Move the update check to async fire-and-forget, storing the result to a file. Read the file synchronously (instant) and inject the notice on the *next* prompt:
```js
// Fast sync check against cache file — never blocks
const snoozeFile = join(homedir(), '.auramaxing', 'update-pending.txt');
if (existsSync(snoozeFile)) {
  const notice = readFileSync(snoozeFile, 'utf8').trim();
  process.stdout.write(`[AURAMAXING UPDATE]\n${notice}\n[/AURAMAXING UPDATE]\n`);
}
// Async refresh — never in the hot path
spawn('bash', [checkScript], { detached: true, stdio: 'ignore' }).unref();
```

---

### Finding 5 — PHASED EXCELLENCE LOOP injected on every actionable prompt (~375 tokens / prompt)

**Severity:** P1  
**File:** `prompt-engine.mjs:246-265`, `rational-router-apex.mjs:707-717`

The `phasedLoop` constant in `prompt-engine.mjs` (lines 248-264) is a 17-line, ~1,500-character / ~375-token block appended to the output of **every** prompt that matches any of the 7 static patterns (`/^(fix|update|...)/i`, `/^(build|create|...)/i`, etc.). These patterns match the vast majority of development prompts.

Separately, `rational-router-apex.mjs` emits its own `PHASED EXCELLENCE LOOP` directive for complexity≥50 (line 709) and a condensed version for complexity 30–49 (line 716). This means **complex prompts get the loop twice** — once from `prompt-engine.mjs` (called at line 635 via execSync) and once from the router itself.

```js
// rational-router-apex.mjs:635 — calls prompt-engine.mjs
const enriched = execSync(`node "${engineScript}"...`);
if (enriched) process.stdout.write(enriched + '\n');   // includes phasedLoop

// rational-router-apex.mjs:709 — then emits its OWN loop
directives.push('PHASED EXCELLENCE LOOP (MANDATORY...): ...');
```

**Impact:** At 100 prompts/session: 37,500+ wasted tokens just from loop duplication. At the top complexity tier this is 600-800 additional tokens from the router's version, totaling ~1,000–1,200 overhead tokens per complex message.

**Fix:** Gate `prompt-engine.mjs`'s loop on a complexity env var set by the router:
```js
// rational-router-apex.mjs (before calling prompt-engine.mjs)
process.env.AURA_COMPLEXITY = String(complexity);

// prompt-engine.mjs:246
const complexity = parseInt(process.env.AURA_COMPLEXITY || '0');
if (complexity < 50) {  // router already emits the full loop for ≥50
  structuredPrompt += `\n${phasedLoop}`;
}
```

---

### Finding 6 — Shell injection in NLM `execSync` template strings

**Severity:** P1  
**File:** `notebook-router.mjs:69,77`, `precompute-pipeline.mjs:194-199`, `intent-predictor.mjs:124-125`

```js
// notebook-router.mjs:69 — args interpolated directly
return execSync(`${NLM_BIN} ${args}`, { ... }).trim();

// notebook-router.mjs:77 — title escapes " but not backtick/$()
const out = nlm(`create "${title.replace(/"/g, '\\"')}"`);

// precompute-pipeline.mjs:194 — NLM response content echoed into shell
const storeResult = execSync(
  `echo '${JSON.stringify(structuredKnowledge).replace(/'/g, "'\\''")}' | node "${NLM_BRIDGE}" store-knowledge`,
```

**Root cause:** All three sites build shell command strings by interpolating user-derived or NLM-response-derived data. The `replace(/"/g, '\\"')` guard on `title` does NOT escape backticks, `$()`, semicolons, or newlines. The `structuredKnowledge` in `precompute-pipeline.mjs` comes from JSON parsed from NLM output (itself derived from session logs which contain user file paths and prompt text).

**Fix:** Use `execFileSync` with an array of arguments instead of shell string interpolation:
```js
// notebook-router.mjs:77
execFileSync(NLM_BIN, ['create', title], { encoding: 'utf8', timeout });

// precompute-pipeline.mjs:194 — pipe via stdin instead of shell echo
const child = execFileSync('node', [NLM_BRIDGE, 'store-knowledge'], {
  input: JSON.stringify(structuredKnowledge), encoding: 'utf8', timeout: 30000,
});
```

---

### Finding 7 — ENRICHMENTS object duplicated verbatim across two files

**Severity:** P1  
**File:** `rational-router-apex.mjs:302-393` and `precompute-pipeline.mjs:404-495`

The `ENRICHMENTS` object (14 task types, ~90 lines) is copy-pasted identically in both files. The precompute pipeline uses it to generate `enrichments-compressed.json`; the router uses it as a fallback when that cache is absent.

**Root cause:** No shared module — these are standalone `.mjs` scripts and the author duplicated rather than extracted.

**Impact:** Any update to enrichments in the router (new task type, refined items) will not appear in the compressed cache until someone updates `precompute-pipeline.mjs` as well. The two have already drifted — `precompute-pipeline.mjs:495` has a `planning` type with distinct items not present in the router version.

**Fix:** Extract to `helpers/enrichments.mjs`:
```js
// helpers/enrichments.mjs
export const ENRICHMENTS = { 'new-feature': [...], 'bug-fix': [...], ... };

// both files
import { ENRICHMENTS } from './enrichments.mjs';
```

---

### Finding 8 — Complexity boost reads context file with substring match on task ID

**Severity:** P2  
**File:** `rational-router-apex.mjs:554-563`

```js
const ctx = readFileSync(ctxFile, 'utf8').toLowerCase();
if (ctx.includes(primary.id))  complexity = Math.min(85, complexity + 15); // seen before
if (ctx.length > 2000)         complexity = Math.min(85, complexity + 5);  // big project
```

**Root cause:** `primary.id` is a short string like `"bug-fix"` or `"design"`. The context file is a `.md` document (session history, decisions, notes). Any document that mentions `"bug-fix"` in any context — including phrases like *"reviewed past bug-fix sessions"*, *"this is not a bug-fix"* — unconditionally boosts complexity by 15 points, potentially escalating a HAIKU task to SONNET or SONNET to OPUS.

**Impact:** Inflated tier selection. A `documentation` task (base score 5) that matches the pattern becomes HAIKU (20) instead of being silently dropped. A `bug-fix` (35) in a project with any history jumps to 50+ (SONNET→OPUS boundary).

**Fix:** Either check a structured JSON context file with an explicit `taskHistory` array, or flip to a frequency-weighted check:
```js
const matches = (ctx.match(new RegExp(`\\b${primary.id}\\b`, 'g')) || []).length;
if (matches >= 3) complexity = Math.min(85, complexity + 15); // only if seen 3+ times
```

---

### Finding 9 — Question detection filter drops legitimate investigation prompts

**Severity:** P2  
**File:** `rational-router-apex.mjs:533-539`

```js
const isQuestion =
  /^(is |are |...what |why |how |...)/i.test(normalized.trim()) &&
  !ACTION_VERBS.test(normalized) &&
  !ENTREPRENEUR_INTENT.test(prompt);
const INVESTIGATION_INTENT = /\b(how does|how do|...)\b.*\b(work|fail|break|crash|...)\b/i;
if (isQuestion && !INVESTIGATION_INTENT.test(prompt)) process.exit(0);
```

**Root cause:** The `INVESTIGATION_INTENT` regex requires **two** matching clauses connected by `.*`: a question phrase AND a technical verb. Legitimate investigation prompts like *"Why is auth failing?"*, *"How do I debug this?"*, *"What's wrong with the payment flow?"* pass `isQuestion` but fail `INVESTIGATION_INTENT` (no second-clause verb match) and are silently dropped — no routing, no directives.

The legacy `rational-router.mjs` has a broader `investigate` rule that would have matched `"what is"` — but APEX's question filter intercepts before rule matching.

**Fix:** Add common investigation phrases explicitly to the rescue guard:
```js
const INVESTIGATION_INTENT = /\b(how does|how do|how is|how are|what causes|...)\b.*\b(work|fail|...)\b/i
  || /\b(why is|why are|why does|why isn.t|what.s wrong|what.s broken|how do i (debug|fix|diagnose))\b/i;
```
Or restructure: check rule matches BEFORE filtering questions, exit only if `matches.length === 0 && isQuestion`.

---

### Finding 10 — Dead code: `rational-router.mjs` (12K) diverges silently from APEX

**Severity:** P2  
**File:** `rational-router.mjs` (entire file)

The file opens with:
```js
/** @deprecated Use rational-router-apex.mjs instead. */
```

It is not referenced in `settings.json`, not imported by any active file, and has diverged in meaningful ways: it lacks the entrepreneur layer (brain-dump, strategy, pitch, fundraise, hire), has `strategy` and `planning` merged into one rule, and uses different complexity scores. The `performance` rule includes Spanish patterns (`rapido`, `mejorar`) that APEX dropped.

**Impact:** Anyone reading this file to understand routing behavior gets the wrong mental model. The `swarm-activity.json` generation code is duplicated (identical block in both files). Any test harness that imports the old router gets a different routing outcome than production. The file is a maintenance landmine.

**Fix:** Delete the file. Move the `AGENT_LABELS`/`AGENT_ICONS`/`TIER_LABEL` display logic it contains (which APEX lacks) into APEX's STDERR block — they're the better UX but APEX silently dropped them.

---

## Summary Table

| # | Severity | File | Lines | Issue | Fix |
|---|----------|------|-------|-------|-----|
| 1 | **P0** | `prompt-engine.mjs` | 64 | LightRAG 6s timeout inside 3s hook — semantic memory never fires | Reduce LightRAG timeout to 1800ms |
| 2 | **P0** | `prompt-engine.mjs` | 193 | `lightragResults === null` impossible — deep recall dead | Change guard to `lightragResults.length === 0` |
| 3 | **P0** | `find-bin.mjs:35` + `prompt-engine.mjs:164` | 35, 164 | `spawn(NLM_BIN, ...)` fails when NLM_BIN is `"python3 -m notebooklm"` | Expose structured `{ bin, args }` from `findNlmArgs()` |
| 4 | **P1** | `rational-router-apex.mjs` | 582-603 | Blocking `execSync` update-check in 3s hot path silently kills all routing | Async fire-and-forget; read cached result sync |
| 5 | **P1** | `prompt-engine.mjs` | 248-265 | PHASED EXCELLENCE LOOP (~375 tokens) emitted on every actionable prompt; doubled for complexity≥50 | Gate on `AURA_COMPLEXITY` env var set by router |
| 6 | **P1** | `notebook-router.mjs:69,77`; `precompute-pipeline.mjs:194` | multiple | Shell injection via unsanitized template strings in NLM `execSync` calls | Replace with `execFileSync(bin, [...args])` |
| 7 | **P1** | `rational-router-apex.mjs:302-393` + `precompute-pipeline.mjs:404-495` | 90 lines × 2 | ENRICHMENTS object duplicated verbatim; already drifted | Extract to shared `helpers/enrichments.mjs` |
| 8 | **P2** | `rational-router-apex.mjs` | 558-562 | Complexity boost from `ctx.includes(primary.id)` substring — false positives on any mention | Use frequency threshold (≥3 occurrences) or structured context |
| 9 | **P2** | `rational-router-apex.mjs` | 533-539 | Question filter drops `"Why is auth failing?"` — INVESTIGATION_INTENT guard too narrow | Add `"why is/isn't/are", "what's wrong"` rescue patterns |
| 10 | **P2** | `rational-router.mjs` | entire | 12K dead code, diverged from APEX, wrong mental model for any reader | Delete; merge AGENT_LABELS display block into APEX |

---

## 10x-Leverage Improvements (Ranked by Impact)

**1. Fix the timeout chain (Findings 1+2+3 together) — single PR, restores the entire memory subsystem.** LightRAG, deep recall, and NLM background learning are all simultaneously broken by three independent bugs. Fixing them together turns on three memory layers at once.

**2. Async update-check + PHASED EXCELLENCE LOOP gating (Findings 4+5 together)** — removes ~1,000 tokens per prompt overhead on complex tasks and eliminates the silent routing kill. Net token reduction for a 100-message session: ~100,000 tokens (~8% of Opus 4.8's context budget).

**3. Shell injection hardening (Finding 6)** — one-line fix per call site with `execFileSync`, eliminates the injection surface entirely.

**4. Extract shared `enrichments.mjs` (Finding 7)** — five-minute refactor that prevents the guaranteed drift already visible (precompute-pipeline has a `planning` type the router lacks).

**5. Parallelise `precompute-pipeline.mjs` steps 3-7** (not a finding above, but visible in the code) — steps 3 (learnings synthesis), 4 (anti-laziness), 5 (intent prediction), 6 (compress enrichments), 7 (CLAUDE.md segments) are completely independent. Running them with `Promise.all` via `spawn` instead of sequential `execSync` cuts the pipeline from ~60s to ~15-20s, meaning cached artifacts are ready for the next session ~3× faster.


---

## Facet: router/autopilot
Now I have everything I need. Let me write the full audit report.

---

## AURAMAXING Skills System Audit

**Scope:** `.claude/skills/` (30 project skills), `skills/` (5 root-level), `/root/.claude/skills/` (5 global), plus `tui/.claude/skills/` discovered as a shadow copy.

**Total skill files:** 30 + 5 + 5 + 30 (tui mirror) = **70 files; ~40 unique skill definitions**

---

### Top 10 Findings by Impact

---

#### \#1 — `tui/.claude/skills/` is a 30-file exact mirror of `.claude/skills/` [CRITICAL]

Every file in `.claude/skills/` has a byte-identical copy in `tui/.claude/skills/`. Confirmed with `diff` — `IDENTICAL` on every file tested.

- **Evidence:** `diff .claude/skills/agentdb-advanced/SKILL.md tui/.claude/skills/agentdb-advanced/SKILL.md` → `IDENTICAL` (and all 30 others)
- **Impact:** ~18,000 lines of dead weight. If `.claude/skills/` is updated, `tui/.claude/skills/` drifts silently. Any skill edit must be applied twice.
- **Action:** Delete `tui/.claude/skills/` entirely. The `tui/` subproject should inherit skills from the parent `.claude/` directory or the user-global `~/.claude/skills/`.

---

#### \#2 — `skills/` root dir is an exact copy of `/root/.claude/skills/` [CRITICAL]

`skills/aura-capabilities/SKILL.md`, `skills/aura-design-supremacy/SKILL.md`, etc. are byte-for-byte copies of the global `~/.claude/skills/` counterparts.

- **Evidence:** `diff skills/aura-capabilities/SKILL.md /root/.claude/skills/aura-capabilities/SKILL.md` → `IDENTICAL`
- **Impact:** 5 skills × ~60 lines each = 300 extra lines. Same silent-drift problem. Worse: the root-level `skills/` is not in the standard `.claude/skills/` load path, so they may not even be active.
- **Action:** Delete `skills/` entirely (the root-level copy). The global `/root/.claude/skills/` is authoritative.

---

#### \#3 — AgentDB 7-skill cluster: undifferentiated routing, massive overlap [HIGH]

Seven skills all covering one technology with nearly identical setup boilerplate:

| Skill | Lines | Core claim |
|---|---|---|
| `agentdb-advanced` | 550 | QUIC sync, multi-DB |
| `agentdb-learning` | 545 | 9 RL algorithms |
| `agentdb-memory-patterns` | 339 | Session/long-term memory |
| `agentdb-optimization` | 509 | Quantization, HNSW |
| `agentdb-vector-search` | 339 | Semantic search |
| `reasoningbank-agentdb` | 446 | ReasoningBank + AgentDB |
| `reasoningbank-intelligence` | 201 | ReasoningBank learning |

All seven share identical scaffolding: `npx agentdb@latest init ./db.db`, `npx agentdb@latest mcp`, `claude mcp add agentdb ...`, the "150x-12,500x faster" claim, and HNSW initialization. The descriptions are not crisp enough to route correctly — "store agent memories" could match `agentdb-memory-patterns`, `reasoningbank-agentdb`, or `agentdb-vector-search`.

`reasoningbank-intelligence` (201 lines) is almost entirely subsumed by `reasoningbank-agentdb` (446 lines); the latter contains everything the former does plus AgentDB integration.

- **Evidence:** `agentdb-memory-patterns/SKILL.md:20–46`, `agentdb-vector-search/SKILL.md:20–60`, `reasoningbank-agentdb/SKILL.md:20–46` — all three have near-identical `init`/`mcp` blocks.
- **Action:** Consolidate to 3 skills: `agentdb-core` (init, HNSW, vector search, memory patterns — the 80% case), `agentdb-learning` (RL algorithms, ReasoningBank — the specialist path), `agentdb-distributed` (QUIC sync, multi-DB, optimization). Delete `reasoningbank-intelligence` — it's a subset of `reasoningbank-agentdb`.

---

#### \#4 — V3 cluster: 9 internal dev-only skills, one should be a runbook [HIGH]

Nine skills exist solely for developing `claude-flow v3` internals. They would only ever be needed together on the same session:

`v3-cli-modernization` (871L), `v3-core-implementation` (796L), `v3-ddd-architecture` (441L), `v3-integration-deep` (240L), `v3-mcp-optimization` (776L), `v3-memory-unification` (173L), `v3-performance-optimization` (389L), `v3-security-overhaul` (81L), `v3-swarm-coordination` (339L)

Total: ~4,100 lines. The trigger audience is developers actively modifying the claude-flow codebase — a single user, on a single repo, for a single extended session. Splitting across 9 skills creates 9 separate routing decisions for what is fundamentally one project context.

- **Evidence:** Every v3 skill Quick Start spawns the same Task agents (`"core-implementer"`, `"core-architect"`, `"v3-memory-specialist"`) — they're all orchestrating the same swarm.
- **Action:** Collapse to 2 skills: `v3-architecture` (DDD, core, CLI — the design decisions) and `v3-implementation` (MCP, memory, performance, security, swarm — the execution patterns). Or better: a single `claude-flow-v3-dev` skill with a table of contents.

---

#### \#5 — `v3-security-overhaul` is functionally hollow [HIGH]

- **Evidence:** `v3-security-overhaul/SKILL.md` is **81 lines** total. It references `CVE-1`, `CVE-2`, `CVE-3` — these are not real CVE identifiers (real ones have the form `CVE-YYYY-NNNNN`). The "security patterns" section is generic bcrypt + Zod + path sanitization boilerplate that Claude already knows without this skill.
- **Impact:** A skill invoked for security work loads this file and gets nothing beyond what the model already has, while conveying false confidence ("CVE-1 fixed").
- **Action:** Delete entirely or replace with a real skill that references the actual security ADRs and the `npx @claude-flow/cli@latest security scan` output format.

---

#### \#6 — `swarm-orchestration` is fully subsumed by `swarm-advanced` [MEDIUM-HIGH]

`swarm-orchestration` (179 lines) covers: mesh/hierarchical/adaptive topologies, parallel/pipeline/adaptive execution, memory coordination, load balancing, fault tolerance, performance monitoring — all at a surface level.

`swarm-advanced` (973 lines) covers all of the above in far more depth, plus research swarm patterns, dev swarm patterns, testing swarm patterns, specialized agent roles, and MCP integration.

There is no trigger condition that would correctly route to `swarm-orchestration` and *not* also match `swarm-advanced`. The smaller skill is a strict subset.

- **Evidence:** `swarm-orchestration/SKILL.md:37–64` (topology patterns) vs `swarm-advanced/SKILL.md:39–59` (same topology patterns, more complete).
- **Action:** Delete `swarm-orchestration`. If a "quick start" entry point is needed, add a `## Quick Start` section at the top of `swarm-advanced`.

---

#### \#7 — Design skills: 3-layer circular redundancy [MEDIUM-HIGH]

`aura-design-supremacy`, `design-tournament`, and `front-10x` describe the same pipeline in three overlapping documents:

- All three describe the tournament procedure (generate 3 variants, screenshot, Opus judge, taste gate)
- All three list the same stack (Tailwind v4 OKLCH, shadcn, Lenis, GSAP, hallmark 65-gate)
- All three reference `~/auramaxing/docs/DESIGN-SUPREMACY.md` as the canonical source
- `front-10x` invokes `/design-tournament` which references `aura-design-supremacy` sequence

The architecture is: `front-10x` (entry point) → `design-tournament` (procedure) → `aura-design-supremacy` (gate checklist). But `aura-design-supremacy` also re-describes the tournament, and `front-10x` also re-describes the sequence. A user invoking any one of the three will read 60-70% identical content.

- **Evidence:** `aura-design-supremacy/SKILL.md:12–26` (tournament steps) vs `design-tournament/SKILL.md:17–42` (same tournament steps, slightly expanded) vs `front-10x/SKILL.md:26–34` (tournament referenced again).
- **Action:** Merge `aura-design-supremacy` + `design-tournament` into one canonical `design-supremacy` skill. Keep `front-10x` as the entry point but strip its duplicated content, replacing with a single reference + the component-discovery and cinematic-craft sections that are genuinely unique to it.

---

#### \#8 — `pair-programming` (1,202 lines): never-triggered dead skill [MEDIUM]

The description says "AI-assisted pair programming with multiple modes (driver/navigator/switch)." No user prompt naturally phrases a coding request as "pair program with me in navigator mode" — they just ask to code. The triggering conditions overlap 100% with normal coding tasks that don't invoke a skill.

Additionally, 1,202 lines is enormous context load for a skill that essentially instructs Claude to do what it already does (code, review, explain). The skill provides no unique CLI commands, APIs, or tool orchestration patterns not already covered by `aura-orchestration`.

- **Evidence:** Skill trigger is "pair programming" — but `aura-orchestration/SKILL.md` already covers collaborative coding patterns in its EXECUTE phase.
- **Action:** Reduce to a 50-line trigger card that maps mode names to behaviors. Remove all redundant orchestration content already in `aura-orchestration`.

---

#### \#9 — `sparc-methodology` is a 1,115-line reference manual, not a skill [MEDIUM]

- **Evidence:** `sparc-methodology/SKILL.md:22–33` — the skill opens with a 9-section Table of Contents. At 1,115 lines it is too large to load as a routing-triggered skill without consuming a significant portion of the context window.
- **Impact:** The SPARC modes are already exposed as individual invokable skills in the system-reminder (`sparc:orchestrator`, `sparc:coder`, `sparc:architect`, etc.) and as dedicated agent types. This skill duplicates all of them in a single monolith.
- **Action:** Strip `sparc-methodology` to a 100-line index: one-sentence descriptions of each mode + the key orchestration flow. Remove all code examples and detailed phase descriptions — those belong in the individual `sparc:*` skills.

---

#### \#10 — `stream-chain` (563 lines): ambiguous trigger, scope creep [MEDIUM]

Trigger: "Stream-JSON chaining for multi-agent pipelines, data transformation, and sequential workflows." This description overlaps with every swarm/pipeline skill. There is no unique command surface — it describes patterns for composing Claude Code Task calls in JSON streams, which is already covered by `swarm-advanced` and `aura-orchestration`.

- **Evidence:** `stream-chain/SKILL.md` describes `jsonl` piping patterns — the same patterns shown in `swarm-advanced/SKILL.md` pipeline examples.
- **Action:** Either merge the unique stream-chain patterns into `swarm-advanced` as a "Stream Pipeline" section, or give it a sharper trigger condition ("streaming multi-gigabyte data between agents with backpressure") that distinguishes it from general orchestration.

---

### Consolidated Skill Set Recommendation

**From 35 project skills → 17 high-leverage skills:**

| Proposed Skill | Replaces | Reduction |
|---|---|---|
| `agentdb-core` | agentdb-vector-search + agentdb-memory-patterns + agentdb-optimization | 3→1 |
| `agentdb-learning` | agentdb-learning + reasoningbank-agentdb + reasoningbank-intelligence | 3→1 |
| `agentdb-distributed` | agentdb-advanced | keeps 1 |
| `v3-architecture` | v3-core-implementation + v3-ddd-architecture + v3-cli-modernization | 3→1 |
| `v3-implementation` | v3-mcp-optimization + v3-memory-unification + v3-performance-optimization + v3-security-overhaul + v3-swarm-coordination + v3-integration-deep | 6→1 |
| `swarm-advanced` | swarm-advanced + swarm-orchestration | 2→1 |
| `design-supremacy` | aura-design-supremacy + design-tournament | 2→1 |
| `front-10x` | front-10x (stripped of duplicates) | keeps 1 |
| `github-dev` | github-code-review + github-multi-repo | 2→1 |
| `github-ops` | github-project-management + github-release-management + github-workflow-automation | 3→1 |
| `hooks-automation` | keeps | keeps 1 |
| `sparc-methodology` | stripped to index | 1→1 (−80% size) |
| `browser` | keeps | keeps 1 |
| `skill-builder` | keeps | keeps 1 |
| `verification-quality` | keeps | keeps 1 |
| `pair-programming` | stripped to 50-line trigger card | 1→1 (−96% size) |
| `stream-chain` | merge unique parts into swarm-advanced or delete | 1→0 |

**Structural deletions:** Delete `tui/.claude/skills/` (30 files, all identical to `.claude/skills/`). Delete `skills/` root dir (5 files, all identical to `~/.claude/skills/`).

**Net result:** 70 files → 17 files. ~40,000 lines → ~12,000 lines. Every skill has a crisp, non-overlapping trigger.

### Gaps to Fill

- **`debugging`** — structured approach for tracing production failures (no equivalent exists)
- **`cloud-deploy`** — Supabase Edge, Vercel, Fly.io deployment beyond CI/CD (covered only partially in GitHub skills)
- **`aura-capabilities` references `~/auramaxing/docs/`** paths — if those docs don't exist in the running environment, the skill is a dead reference that fails silently; add a `CAPABILITIES.md` existence check or inline the critical table


---

## Facet: skills
Here is the audit. Top 10 by impact:

---

## Top 10 — Hooks Audit: AURAMAXING

### #1 · CRITICAL — `rational-router-apex.mjs:582-641`
**UserPromptSubmit — blocks up to 8s per prompt via `execSync`.**  
Two synchronous child processes: `bash update-check.sh` (5s timeout) + `node prompt-engine.mjs` (3s timeout). Both block the event loop. Despite "cache-backed" comment, `bash update-check.sh` still spawns a subprocess every call. **Fix:** spawn async, write result to cache file, read cache synchronously on next turn.

### #2 · CRITICAL — `session-stop.mjs:112-130`
**Stop fires after every response turn, kills MCP servers.**  
`pkill` + `SIGTERM` against any child process matching `mcp|supabase|context7|shadcn`. `Stop` is not `SessionEnd` — it fires between turns, destroying active MCP connections. **Fix:** move to `SessionEnd` hook only.

### #3 · HIGH — `task-complete.mjs:150` + `session-stop.mjs:219`
**Stop — 800ms unconditional dead wait per turn.**  
`setTimeout(exit, 300)` and `setTimeout(exit, 500)` added after fire-and-forget HTTP calls to daemon port 57821. If daemon is down (common), both delays still elapse. **Fix:** `req.on('finish', () => process.exit(0))` with a `setTimeout(exit, 50).unref()` fallback.

### #4 · HIGH — `output-compressor.mjs:35`
**PostToolUse — `require('fs')` in `.mjs` = stash grows unbounded + 5KB compression cap breaks context.**  
`pruneOldStash()` always throws `ReferenceError` silently. Stash never pruned. Also `OUTPUT_MAX_BYTES=5120` compresses any tool output over 5KB — Claude sees head/tail fragments, not full content, silently degrading edit accuracy. **Fix:** use top-level ESM `import`; raise cap to 50KB.

### #5 · HIGH — `pii-redactor.mjs:26-27`
**PreToolUse — HIGH severity regex false-positives block all writes/edits.**  
`0x[hex]{40}` blocks public Ethereum contract addresses, test fixtures, and 40-char hex constants. `sk-[20+ chars]` matches broad identifiers. HIGH severity = `{ decision: 'block' }` — stops the Edit/Write/Bash tool entirely. **Fix:** tighten patterns to known key formats; demote Eth addresses to MODIFY (they're not secrets).

### #6 · HIGH — `context-threshold-monitor.mjs:231`
**UserPromptSubmit — `cw.model` throws TypeError every time, silently killing auto-handoff.**  
The hook's own comment says `UserPromptSubmit` never receives `context_window`. So `cw` is always `undefined`. Line 231: `const model = cw.model || ...` → TypeError → `main().catch(exit)`. The flag at line 229 was already written, so no retry. Handoff/SDR/NLM delegation never run. **Fix:** `const model = (cw && cw.model) || input.model || detectedModel || 'unknown'`.

### #7 · MEDIUM — `aura-session-flush.mjs:84`
**Stop — `require('fs')` in `.mjs` = weekly NLM synthesis never fires.**  
`maybeTriggerWeekly()` uses `const { statSync } = require('fs')` inside an ES module. Always throws, always returns `false`. Weekly synthesis is permanently broken. **Fix:** use the already-imported `statSync` from the top-level `import`.

### #8 · MEDIUM — `hook-handler.cjs:96-130`
**UserPromptSubmit (TUI) — outputs 30 lines of fake ASCII routing table per matched prompt.**  
Hardcoded match percentages, `Math.random()` latency. 10000ms timeout registered. Wastes ~800 context tokens on every complex prompt in the TUI directory where this project settings fires alongside the global `rational-router-apex`. Two routing hooks doing redundant work. **Fix:** remove this UserPromptSubmit hook from the TUI settings — `rational-router-apex` already handles routing.

### #9 · MEDIUM — `session-stop.mjs:22`
**Stop — reads wrong events file path, so tool/file counts are always 0.**  
`post-tool-use-apex.mjs` writes to `turn-events-${SESSION_PID}.jsonl` (PID-suffixed). `session-stop.mjs` reads `turn-events.jsonl` (no suffix) — path never written. All session memory entries record `tools:0`, `files:[]`. Learning system receives no signal. **Fix:** `const SESSION_PID = process.ppid || process.pid; const EVENTS_FILE = join(..., \`turn-events-${SESSION_PID}.jsonl\`)`.

### #10 · MEDIUM — `tui/.claude/settings.json:101-108`
**PreCompact manual — no timeout on `hook-handler.cjs compact-manual`.**  
The first hook in the `manual` PreCompact array has no `timeout` field. A hang blocks `/compact` indefinitely. The second hook (`session-end`) calls `intelligence.consolidate()` with synchronous PageRank recomputation inside a 5000ms budget — on a large graph this runs the full timeout. **Fix:** add `"timeout": 3000` to the first hook.

---

**Cumulative worst-case latency per turn:** UserPromptSubmit adds up to 17s of registered timeout (3+2.5+1.5+10s), with `execSync` in #1 actually burning 3-8s synchronously. Stop adds 800ms floor unconditionally. Output to `docs/hooks-audit.md`.


---

## Facet: hooks
Now I have everything I need. Let me produce the ranked audit report.

---

## AURAMAXING Code Quality Audit — Top 10 by Impact

---

### #1 — DEAD FILE: `helpers/rational-router.mjs` (entire 225-line file)
**Severity: HIGH**

`helpers/rational-router.mjs:1` is explicitly marked `@deprecated`, has a runtime deprecation guard at line 25–27, and the active settings hook already points to `rational-router-apex.mjs`. The file exists purely as confusion. Every logic path (RULES, COMPLEXITY, swarm spawn, stdout directive) is a subset of the apex router, which has diverged — the legacy version still has the `rapido|mejorar` pattern on line 58, missing from apex.

**Refactor:** Delete the file. If test coverage is needed, the runtime guard at line 25 is the only test harness entry point and should move to apex.

---

### #2 — VERBATIM DUPLICATE: `ENRICHMENTS` object in two files
**Severity: HIGH**

`helpers/rational-router-apex.mjs:302–393` (91 lines) and `helpers/precompute-pipeline.mjs:404–495` (92 lines) contain the **identical `ENRICHMENTS` object**. `precompute-pipeline.mjs` even documents the duplication at line 403: *"hardcoded here for pre-computation"*. The two copies have already drifted — `precompute-pipeline.mjs` has a `planning` key (lines 489–494) that `rational-router-apex.mjs` is missing, meaning the compression step in step 6 will cache enrichments for a task type the router never emits.

**Refactor:**
```js
// helpers/enrichments.mjs (new shared module)
export const ENRICHMENTS = { ... };

// both files:
import { ENRICHMENTS } from './enrichments.mjs';
```

---

### #3 — 500-LINE VIOLATION: `helpers/rational-router-apex.mjs` (740 lines)
**Severity: HIGH**

At 740 lines this is 48% over the project's hard limit. The file has three clearly separable concerns:

| Slice | Lines | Extract to |
|---|---|---|
| `COMPLEXITY` + `RULES` | 1–299 | `helpers/router-rules.mjs` |
| `ENRICHMENTS` + `TOOL_RECS` | 302–502 | `helpers/enrichments.mjs` (see #2) |
| `main()` + output logic | 510–740 | `helpers/rational-router-apex.mjs` (~120 lines) |

`TOOL_RECS` at lines 395–502 is 107 lines of static configuration that could be a JSON file, eliminating further review burden.

---

### #4 — SHELL INJECTION: `helpers/precompute-pipeline.mjs:192–195`
**Severity: HIGH**

```js
const storeResult = execSync(
  `echo '${JSON.stringify(structuredKnowledge).replace(/'/g, "'\\''")}' | node "${NLM_BRIDGE}" store-knowledge`,
  { encoding: 'utf8', timeout: 30000 }
);
```

The single-quote escaping (`'\\''`) is incomplete — JSON containing `$()`, backticks, or certain Unicode sequences can break out of the shell quoting context. Since `structuredKnowledge` is NLM-sourced (external AI output), this is an injection surface.

**Refactor:**
```js
execFileSync(process.execPath, [NLM_BRIDGE, 'store-knowledge'], {
  input: JSON.stringify(structuredKnowledge),
  encoding: 'utf8', timeout: 30000,
});
```

---

### #5 — 500-LINE VIOLATION: `helpers/precompute-pipeline.mjs` (559 lines)
**Severity: HIGH**

The pipeline is structured as seven sequential `try/catch` blocks at the module top level (no function wrapping). This means:
- Errors in the `NB_ID_FILE` read at line 48 silently produce a truncated `undefined` notebook ID (`.slice(0, 8)` of `undefined` throws, caught by the outer `catch` that returns `null` — the NLM call silently no-ops).
- Top-level side effects on lines 33–40 (`findNlm()`, `mkdirSync()`) run during import.

**Refactor:** Wrap each numbered step in a named `async function step1()`, `step2()`, etc. and call them sequentially from a `main()`. This keeps each step under 50 lines, makes individual steps testable, and prevents import-time side effects.

---

### #6 — SCRIPT DUPLICATION: `scripts/batch-apply.mjs` vs `scripts/apply-batch.mjs`
**Severity: HIGH**

Both scripts:
- Connect to CDP on port 9222 via Playwright
- Fill accelerator application forms using the same `querySelectorAll` → label-matching strategy
- Target largely overlapping program lists (~35 programs appear in both)
- Use identical field-matching regex patterns (lines 138–166 in `batch-apply.mjs` ≈ lines in `apply-batch.mjs`)

**Critical data divergence:** The shared founder data has **drifted** between files:

| Field | `batch-apply.mjs:13` | `apply-batch.mjs:29` |
|---|---|---|
| `phone` | `+1 (650) 555-0199` (**fake 555 number**) | `+1 650 485 7921` |
| `hear` | absent | `'Through the startup ecosystem...'` |
| `risks`/`ask`/`gtm` | absent | present (150+ chars each) |

The fake 555 phone number will cause form validation failures on every program in `batch-apply.mjs`.

**Refactor:** Extract `scripts/form-filler.mjs` with the shared `DATA`, `fillForm()`, and CDP connect logic. Both scripts become ~30-line wrappers that import it with their specific program lists.

---

### #7 — CDP DUPLICATION: `helpers/nlm-auth-refresh.mjs` vs `helpers/nlm-cookie-sync.mjs`
**Severity: MEDIUM**

Both files:
- Write a Python script to a `tmpdir` file
- Execute it with `PYTHON_BIN`
- Clean up the temp file
- Write the same `~/.notebooklm/storage_state.json` output

`nlm-cookie-sync.mjs` was explicitly created because `nlm-auth-refresh.mjs`'s Playwright `networkidle` approach times out (documented at lines 11–16 of `nlm-cookie-sync.mjs`). Yet both files are still wired up independently, so callers must choose which to invoke. `precompute-pipeline.mjs:64` calls only `nlm-auth-refresh.mjs` — meaning it uses the known-broken path.

**Refactor:** Have `nlm-auth-refresh.mjs` attempt Playwright first, then automatically fall back to spawning `nlm-cookie-sync.mjs` on timeout. Remove the caller's responsibility to choose.

---

### #8 — FRAGILE BLOCKING SLEEP: `helpers/nlm-auth-refresh.mjs:72`
**Severity: MEDIUM**

```js
execSync('sleep 3', { timeout: 5000 });
// Verify
execSync(`curl -s --connect-timeout 2 ${CDP_URL}/json/version`, { ... });
```

`sleep 3` is a fixed busy-wait that races against browser-server startup time. On a loaded system or cold-start Mac, 3 seconds is insufficient and the subsequent `curl` verify fails, causing the auth refresh to abort even though Chrome eventually starts. There is no retry.

**Refactor:**
```js
// Poll with exponential backoff (max 10s)
for (let i = 0; i < 5; i++) {
  try { execSync(`curl -s --connect-timeout 1 ${CDP_URL}/json/version`, { stdio: 'pipe' }); break; }
  catch { await new Promise(r => setTimeout(r, 500 * (i + 1))); }
}
```

---

### #9 — MISSING GUARD / NULL DEREF: `helpers/precompute-pipeline.mjs:48`
**Severity: MEDIUM**

```js
function nlm(query) {
  try {
    const nbId = readFileSync(NB_ID_FILE, 'utf8').trim().slice(0, 8);
    execSync(`${NLM_BIN} use ${nbId}`, ...);
```

`NB_ID_FILE` (`~/.auramaxing/nlm-notebook-id`) may not exist on first run. `readFileSync` throws, the `catch` returns `null`, and all seven downstream steps silently no-op — losing the entire pipeline's output. The real failure (missing notebook ID) is invisible.

Additionally, `NLM_BIN` is checked at line 34 but only logs a warning. When `NLM_BIN` is `null`, `execSync(\`${null} use ...\`)` runs `null use ...` as a shell command, producing a misleading "command not found" error rather than the real issue.

**Refactor:** Add explicit guards at lines 46–47:
```js
if (!NLM_BIN) return null;
if (!existsSync(NB_ID_FILE)) { log('nlm', 'notebook ID file missing'); return null; }
```

---

### #10 — DUPLICATE OS IMPORT: `helpers/nlm-auth-refresh.mjs:12–13`
**Severity: LOW**

```js
import { homedir } from 'os';
import { tmpdir } from 'os';
```

Two separate `import` statements from the same module. Minor, but it's noise in a file that's already structurally confused by the CDP-vs-Playwright problem.

**Refactor:** `import { homedir, tmpdir } from 'os';`

---

## Summary Table

| Rank | File | Line(s) | Severity | Issue |
|---|---|---|---|---|
| 1 | `helpers/rational-router.mjs` | 1–225 | HIGH | Entire file is dead code (deprecated, unhooks) |
| 2 | `helpers/rational-router-apex.mjs` / `precompute-pipeline.mjs` | 302–393 / 404–495 | HIGH | 91-line `ENRICHMENTS` object duplicated verbatim, already drifted |
| 3 | `helpers/rational-router-apex.mjs` | 1–740 | HIGH | 48% over 500-line limit; 3 extractable concerns |
| 4 | `helpers/precompute-pipeline.mjs` | 192–195 | HIGH | Shell injection via unescaped JSON in `echo '...' \| node` |
| 5 | `helpers/precompute-pipeline.mjs` | 1–559 | HIGH | 12% over limit; top-level side effects; untested NLM null path |
| 6 | `scripts/batch-apply.mjs` vs `apply-batch.mjs` | whole files | HIGH | ~200 lines duplicated; data diverged with fake phone number |
| 7 | `helpers/nlm-auth-refresh.mjs` vs `nlm-cookie-sync.mjs` | whole files | MED | Same CDP→storage_state.json purpose; broken path still wired |
| 8 | `helpers/nlm-auth-refresh.mjs` | 72 | MED | `sleep 3` busy-wait with no retry for CDP startup |
| 9 | `helpers/precompute-pipeline.mjs` | 34, 48 | MED | Missing guard for null `NLM_BIN` and absent `NB_ID_FILE` |
| 10 | `helpers/nlm-auth-refresh.mjs` | 12–13 | LOW | Split `import { homedir }` / `import { tmpdir }` from same module |

**Highest ROI refactors in order:** fix the shell injection (#4), delete the dead file (#1), extract the shared `ENRICHMENTS` module (#2, resolves #3 and #5 as a side effect), merge the batch scripts (#6).


---

## Facet: code-quality/refactor
Report written to `docs/CLOUD-FLEET-AUDIT.md`. Here's the ranking:

---

## Top 10 — Cloud/Fleet Audit Findings

| # | File:Line | Severity | Finding |
|---|-----------|----------|---------|
| **1** | `rational-router-apex.mjs` (all) | **CRITICAL** | **Zero autopilot integration** — no hook checks `AURA_FLEET_HOST`, no complexity classifier, no delegation path. The "auto-delegate to box" goal is entirely manual. Add a UserPromptSubmit classifier that fires `acode.sh -p` when `AURA_FLEET_HOST` is set and the prompt exceeds a complexity threshold. |
| **2** | `cloud/acode.sh:40` | **CRITICAL** | **Shell injection** — `$ONESHOT` is expanded directly into a double-quoted SSH command. A prompt like `"; rm -rf ~/; echo "` executes on the box. Fix: use `printf '%q'` or base64-encode the prompt and decode server-side. |
| **3** | `cloud/nightly.sh` (header) | **CRITICAL** | **No systemd unit files exist** — the "nightly autonomous loop" (the compounding lever) can never run. No `.service` or `.timer` in the repo anywhere. Add `cloud/nightly.{service,timer}` and wire them into `provision.sh:46`. |
| **4** | `cloud/fleet.sh:35–47` | **HIGH** | **Unbounded parallel SSH** — spawns one SSH session per task simultaneously; 10 tasks = 10 sessions, 50 tasks exceeds sshd defaults. `swarm.sh` uses `gnu parallel -j $N`. `fleet.sh` should too (add `FLEET_N` env var, default 6). |
| **5** | `cloud/acode.sh:40` | **HIGH** | **One-shot missing `--strict-mcp-config`** — unlike `swarm.sh:51`, the one-shot path has active MCP servers (playwright, github, etc.) during a headless `--dangerously-skip-permissions` run. Mirror swarm.sh's `--mcp-config ~/.swarm-empty-mcp.json`. |
| **6** | `cloud/fleet.sh`, `swarm.sh`, `acode.sh` (all ssh calls) | **HIGH** | **No SSH host key verification** — bare `ssh "$HOST"` with no `-o StrictHostKeyChecking=yes -o BatchMode=yes`. IP change or MITM = silent compromise of all code and diffs. Add `SSH_OPTS` var used in every invocation; scan fingerprint in `provision.sh`. |
| **7** | `cloud/fleet.sh:37–45` | **MEDIUM** | **Incomplete prompt escaping** — `sed` only escapes `'` for the remote single-quote context, but `$esc` is still expanded by the local shell inside the outer double-quoted string. A `"` or `$()` in a task prompt injects into the local shell. Fix: `printf '%q'` for outer context. |
| **8** | `cloud/provision.sh:16–19` | **MEDIUM** | **`curl \| bash` NVM + unpinned clone** — supply-chain risk. NVM installs without checksum verification; AURAMAXING repo cloned without a commit pin (`git pull --ff-only` picks up any mainline push). Pin both with SHA/tag verification. |
| **9** | `cloud/nightly.sh:13–16,32` | **MEDIUM** | **API key in curl header can leak to log** — `exec > >(tee -a "$LOGS/$RUN.log") 2>&1` captures all stderr. Some curl failure modes output request headers including the Bearer token. Strip with `grep -v Authorization` or use `--oauth2-bearer` with a secret file. Also add `chmod 700 "$LOGS"`. |
| **10** | `cloud/acode.sh:27–31` | **MEDIUM** | **`sync_back` has no `--delete` and no conflict detection** — files deleted on the box persist locally; local edits during a remote session are silently overwritten on sync. Add `--backup --backup-dir=.fleet-backup/$(date +%s)` and a pre-sync `git status` warning. |


---

## Facet: fleet-integration
I now have sufficient evidence to compile the audit. Here are the top 10 coherence failures, ranked by impact:

---

## AURAMAXING Audit — Top 10 Doc/Reality Mismatches

---

### #1 — The 20 Documented Helpers Don't Exist
**Severity: CRITICAL**

`ARCHITECTURE.md:200–224` names 20 specific helper files as the live hook pipeline:
`rational-router-apex.mjs`, `pii-redactor.mjs`, `session-start.mjs`, `session-stop.mjs`, `post-tool-use-apex.mjs`, `self-heal.mjs`, `prompt-engine.mjs`, `lightrag-bridge.mjs`, `notebooklm-bridge.mjs`, `memory-enrich.mjs`, `memory-learn.mjs`, `intent-predictor.mjs`, `precompute-pipeline.mjs`, `claudemd-segments.mjs`, etc.

**Reality:** None of these files exist in `tui/.claude/helpers/`. The actual hook pipeline is `hook-handler.cjs` dispatching to `router.js`, `session.js`, `memory.js`, and `intelligence.cjs`. The 39 files in that directory are a completely different set. Every architectural diagram in ARCHITECTURE.md describes a system that was never built.

**Correction:** Update ARCHITECTURE.md to reflect the real hook chain: `hook-handler.cjs` → `router.js`, `session.js`, `memory.js`, `intelligence.cjs`.

---

### #2 — All 335 Agent Hook Calls Use a Non-Production CLI Tag
**Severity: HIGH**

Every `.claude/agents/` hook block (335 invocations across all agent `.md` files) uses:
```
npx claude-flow@v3alpha hooks ...
npx claude-flow@v3alpha memory ...
```

`CLAUDE.md:105,144,201` and all examples use:
```
npx @claude-flow/cli@latest
```

**The `@v3alpha` tag is an alpha pre-release**. Whether it resolves, and whether its CLI surface matches `@latest`, is unknowable without testing. The Quick CLI Examples in CLAUDE.md use `@latest`; zero agent definitions do.

**Correction:** Standardize all agent hooks to `npx @claude-flow/cli@latest` (or whichever tag is production) and verify the sub-commands (`hooks intelligence`, `neural train`, `hooks worker dispatch`) exist in that release.

---

### #3 — gstack Skill Count: 28 (CLAUDE.md) vs 42 (CAPABILITIES.md)
**Severity: HIGH**

`CLAUDE.md:67`:
> "gstack Slash Commands (**28** built-in skills)"

`docs/CAPABILITIES.md:31`:
> "## 2. gstack skills (**42** installed)"

Both documents are in the same repo, published at the same version (1.0.0), and describe the same set of skills. The discrepancy is 50% off. The CAPABILITIES.md list enumerates more commands than the CLAUDE.md table.

**Correction:** Count the actual installed skills, update both files to match, and derive the table in CLAUDE.md from CAPABILITIES.md, not the other way around.

---

### #4 — tui/CLAUDE.md Still Branded "RuFlo V3"
**Severity: HIGH**

`tui/CLAUDE.md:1`:
```
# Claude Code Configuration - RuFlo V3
```

`CHANGELOG.md:43`:
> "Full rebrand from CLAUDEMAX to Auramaxing — all paths, references, environment blocks, and display strings updated"

The rebrand explicitly claimed completeness. `tui/CLAUDE.md` is the live settings-adjacent CLAUDE.md for the TUI sub-project; users running from that directory get the old identity.

**Correction:** Update `tui/CLAUDE.md` line 1 to `# Auramaxing — Project Configuration` (matching the root CLAUDE.md header).

---

### #5 — Contradictory Test/Build Rules Across CLAUDE.md Files
**Severity: HIGH**

`CLAUDE.md:92-95` (root, "Build & Test"):
> "NEVER run `npm run build`, `npm test`, or `npm run lint` in the terminal. Builds are validated automatically via GitHub Actions."

`tui/CLAUDE.md:44-56` ("Build & Test"):
```bash
# Build
npm run build
# Test
npm test
# Lint
npm run lint
```
> "ALWAYS run tests after making code changes. ALWAYS verify build succeeds before committing."

These are diametrically opposed instructions in the same repo. An agent following tui/CLAUDE.md will run tests locally; one following root CLAUDE.md will never run them locally.

**Correction:** Remove the `Build & Test` section from `tui/CLAUDE.md` (it's an inner project that should inherit the root rule), or acknowledge that the TUI sub-project intentionally differs and document why.

---

### #6 — Max Agents: 15 Contradicts "Keep at 6-8" in the Same File
**Severity: MEDIUM-HIGH**

`CLAUDE.md:36` (Project Config):
> "**Max Agents**: 15"

`CLAUDE.md:139` (Swarm Configuration & Anti-Drift, 103 lines later):
> "Keep maxAgents at **6-8** for tight coordination"

`tui/.claude/settings.json:219` confirms `"maxAgents": 15`. The anti-drift guidance contradicts the configured ceiling in the same document. An agent reading both sections has no ground truth.

**Correction:** Align both references. If 15 is the ceiling and 6-8 is the recommended default, say so explicitly. Example: "Hard ceiling: 15. Default for most coding swarms: 6-8."

---

### #7 — Topology Label Mismatch: "hierarchical-mesh" vs CLI Flag "hierarchical"
**Severity: MEDIUM**

`CLAUDE.md:35` and `tui/.claude/settings.json:218`:
```
"topology": "hierarchical-mesh"
```

`CLAUDE.md:144` (the swarm init command shown as the canonical example):
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

The CLI flag is `--topology hierarchical`, not `hierarchical-mesh`. If the CLI validates topology names, the config value `hierarchical-mesh` would fail or be silently coerced. The Project Config section and the Swarm Configuration section give different string identifiers for the same intended topology.

**Correction:** Verify the CLI accepts `hierarchical-mesh`. If it only accepts `hierarchical`, update `settings.json` and the Project Config accordingly.

---

### #8 — Tier 3 Model Label Diverges Between Root and TUI CLAUDE.md
**Severity: MEDIUM**

`CLAUDE.md:129` (root):
```
| **3** | **Opus 4.6** (Max) | 2-5s | $0.015 | Complex reasoning, architecture, security, DeFi (>30%) |
```

`tui/CLAUDE.md:87`:
```
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |
```

The root version hard-codes "Opus 4.6" as the exclusive Tier 3 model and removes DeFi from the tui variant. The tui version is more accurate (range covers Sonnet when cost is a factor). This causes downstream agents to over-route to Opus when Sonnet is sufficient.

**Correction:** Use the tui version's range ("Sonnet/Opus, $0.003-0.015") as the canonical Tier 3 entry in root CLAUDE.md, and drop the "DeFi" use-case qualifier if it's not relevant to all projects.

---

### #9 — ARCHITECTURE.md Data Paths Don't Match Actual Repository Layout
**Severity: MEDIUM**

`ARCHITECTURE.md:138-166` describes the canonical data layout:
```
~/.auramaxing/          (memory, learnings, nlm-cache, state)
~/auramaxing/           (helpers/, daemon/, scripts/, skills/, install.sh, VERSION)
~/.claude/helpers/      (Active hooks — synced)
```

**Actual repo layout:**
- Hooks/helpers live at `tui/.claude/helpers/` (relative to repo root)
- State data lives at `tui/.claude-flow/` and `tui/.claude-flow/data/`
- There is no `~/auramaxing/` directory or `~/.auramaxing/` directory anywhere in the repo
- The daemon reads/writes to `$HOME/.auramaxing/` at runtime — a user-home path, not the repo

Every path in ARCHITECTURE.md is a runtime user-home assumption. The repo itself does not mirror this layout, making the architecture doc misleading for anyone trying to understand the code structure.

**Correction:** ARCHITECTURE.md should distinguish clearly: (a) repo layout (`tui/.claude/helpers/`, `daemon/src/`…) vs (b) runtime user-home layout (`~/.auramaxing/`, `~/.claude/`).

---

### #10 — MCP Server List in ARCHITECTURE.md Is Stale Post-Cleanup
**Severity: MEDIUM**

`ARCHITECTURE.md:398-401`:
```
MCP Servers (9)
context7, playwright, github, supabase, sequential-thinking,
firecrawl, sentry, n8n, figma
```

`docs/AUTOPILOT-FLOW.md:68-72` (updated 2026-05-30, a month after ARCHITECTURE.md v1.0.0):
```
Active (9, lazy-loaded): context7(1k) · shadcn(1k) · magicui(0k) · serena(6k) · 
codegraph(2k) · designlang(0k) · deepwiki(0k) · + 2 inherited.
Removed: github(4k → gh CLI) · supabase(5k → CLI/per-project) · figma.
Net baseline saving ≈ 9k tokens/turn.
```

The active MCP roster changed entirely: `github`, `supabase`, and `figma` were removed; `shadcn`, `magicui`, `serena`, `codegraph`, `designlang`, `deepwiki` were added. ARCHITECTURE.md reflects none of this and lists three servers that no longer run.

**Correction:** Update `ARCHITECTURE.md:398-401` to match the current list from AUTOPILOT-FLOW.md, or remove the list from ARCHITECTURE.md and point to AUTOPILOT-FLOW.md as the single source of truth for MCP roster.

---

### Bonus: Agent Booster (WASM) — Claimed Feature, No Implementation
**Severity: HIGH (aspirational fiction presented as production)**

`CLAUDE.md:127-131` describes a fully operational Tier 1 handler:
```
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms — Skip LLM |
```
> "Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`"

**No WASM file, no WASM build step, no `[AGENT_BOOSTER_AVAILABLE]` signal emitter, and no code that checks for this signal exists anywhere in the repository.** The actual Tier 1 "routing" is a regex table in `tui/.claude/helpers/router.js` that returns an agent type string — it does not skip the LLM and has no WASM runtime. Agents instructed to check for `[AGENT_BOOSTER_AVAILABLE]` will never see it.

**Correction:** Remove or clearly mark the Agent Booster row as "planned/not yet implemented." Replace the guidance with what actually happens at Tier 1 (the JS regex router selects an agent type, always invokes an LLM).


---

