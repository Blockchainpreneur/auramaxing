# AURAMAXING — Capability Registry (what the autopilot composes)

> Single source of truth of every element the Aura autopilot can combine. The router
> (`rational-router-apex.mjs`) points here; the doctrines (`ORCHESTRATION.md`,
> `DESIGN-SUPREMACY.md`) govern HOW to combine them. Goal: intelligently compose ANY
> subset, adjusted to the prompt, for the best achievable output quality per token.
>
> v1.0 · 2026-05-29 · All entries below are FREE (no paid API). Key-gated items live at
> the bottom, clearly flagged.

**Master flow:** `~/auramaxing/docs/AUTOPILOT-FLOW.md` — the task-type→tool-composition table +
on-demand auto-install triggers. This registry is the WHAT; AUTOPILOT-FLOW is the WHEN/HOW-wired.

## How composition works (the autopilot's job)
On every prompt the router scores task-type + complexity and the agent then **composes**
the smallest sufficient set from the registry — escalating with complexity:
- **trivial** → answer directly (no ceremony).
- **medium** → 1 gstack skill + relevant MCP/CLI + targeted ENRICH.
- **complex** → full Iron Loop (research→plan→execute→audit→test→self-improve) + parallel
  subagents/Agent Teams (cap 3–5) or a Workflow + adversarial verify + loop to the exit bar.
Pick by FIT, not habit. Prefer CLI/skill over MCP (token cost). Lazy-load MCP (Tool Search).

## 1. Orchestration & reasoning
- **Native subagents / Agent Teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) — parallel streams, worktree isolation (cap 3–5).
- **Workflow tool** — decompose→verify→synthesize at scale; pipeline by default; adversarial verify.
- **Goals / TaskCreate / `/checkpoint`** — auto-activate for large/multi-session work.
- **`/loop`** (recurring), **`/schedule`** (dated future runs), **sequential-thinking** (structured reasoning).
- **`/codex`** — cross-model adversarial review (different model family).
- **Cloud fleet** (`~/auramaxing/cloud/`, when `AURA_FLEET_HOST` set) — delegate RAM-heavy parallel work to the box; the Mac stays a thin client. **`acode`** = full box-resident session (Path A); **`orchestra.sh "<goal>" [cloud/roles/{research,frontend,code}.roles]`** = role fan-out → adversarial judges → synthesis (Path B); **`swarm.sh`** = drain ≤200 tasks (mem-capped); **`fleet.sh`** = N agents, one per subtask. All workers run hooks-OFF + RAM-aware concurrency. Reach for it on big research/audits/batch refactors that would thrash the 8 GB Mac.

## 2. gstack skills (33 installed) — the lifecycle
Plan: `/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/autoplan`
Build: `/investigate` `/review` `/ship` `/land-and-deploy`
QA: `/qa` `/qa-only` `/benchmark` `/canary` `/health`
Security: `/cso` · Design: `/design-consultation` `/design-review` `/design-shotgun` `/design-html`
Browser: `/browse` `/connect-chrome` · Safety: `/careful` `/freeze` `/guard` · Meta: `/retro` `/learn` `/checkpoint`
Native: `/code-review` (incl. `ultra`), `/simplify`, `/verify`, `/security-review`, `/deep-research`.

## 3. Code intelligence (MCP/CLI)
- **Serena** (NOT INSTALLED — do not route; use Grep/Glob + Explore) — LSP `find_symbol`/`find_references`/atomic edits, 40+ langs.
- **codegraph** (NOT INSTALLED — do not route; use Grep/Glob + Explore) — pre-indexed local code graph; token-cheap repo queries. Per-project: run `codegraph init` + `codegraph index` in a repo before its MCP tools return data (A/B vs Serena per task).
- **spec-kit** (`specify` CLI) — spec-driven dev; run `specify init` in a project → `/speckit.*`.

## 4. Memory & knowledge
- **NLM** (`python3 -m notebooklm`) + **LightRAG** — deep/temporal memory (auto via hooks).
- **File memory** (`~/.claude/projects/.../memory/`) + **learnings** (ReasoningBank distillation).
- **DeepWiki** (MCP, remote SSE `https://mcp.deepwiki.com/sse`, free) — grounded comprehension of
  ANY public/OSS repo you haven't cloned (`ask_question`/`read_wiki_contents`/`read_wiki_structure`).
  Fills the one real gap: NLM/LightRAG/codegraph/serena understand YOUR code; DeepWiki understands
  the library you're integrating. Or query the hosted wiki by swapping github.com→deepwiki.com on any repo URL.
- Retrieve before acting; distill after.

## 5. Web & research
- **`/deep-research`**, **`/browse`**, **firecrawl** (scrape), **WebSearch/WebFetch**, **context7** (lib docs).

## 6. Browser & QA (CLI-first, never Playwright MCP)
- **Playwright CDP** (`browser-server.mjs` + `npx playwright test`) — automation, E2E, screenshots, visual regression.
- **Vision-QA loop** — screenshot → vision critique vs Elite UI Checklist → fix.
- **axe-core** (a11y), **Lighthouse CI** (perf/CWV), **Argos** (visual regression).
- **cdp-lite** (`helpers/cdp-lite.mjs`) — raw CDP client, no deps. Use it (NOT playwright's
  `connectOverCDP`, which hangs on the user's 30+-target Chrome) whenever a script must drive
  the user's live browser; its `Input.*` path also produces TRUSTED events (user activation).

## 6b. ChatGPT Council (second opinion, always-on)
Fires automatically when **2+ Claude Code terminals are mid-task**: pushes the live project
context (prompt, git, open ledger, peer terminals, steering doc — secret-scrubbed) to ChatGPT
in a new tab, archives the answer, reads it aloud and opens the voice call on that thread.
- `helpers/gpt-council.mjs` (UserPromptSubmit + `--stop`; `--status`/`--force`/`--dry`)
- `helpers/council-brief.mjs` (brief + anti-generality contract) · `scripts/chatgpt-call.mjs` (driver)
- **Exactly one dispatch per prompt.** The same prompt never opens a second tab, so a tab the
  user closes stays closed until their NEXT prompt; a live call is never interrupted.
- Knobs: `AURA_COUNCIL_OFF=1` · `AURA_COUNCIL_MODE=call|speak|text` · `AURA_COUNCIL_MIN_SESSIONS`
  · `AURA_COUNCIL_COOLDOWN_MIN` (0 = per-prompt only) · `AURA_COUNCIL_FOCUS=1`.
  State: `~/.auramaxing/council/`.

## 7. Design stack (free; per-project — see DESIGN-STACK-SETUP.md)
Tailwind v4 + shadcn (Base UI backend) · **Geist/Inter via Fontsource** (`@fontsource-variable/*`) ·
**Monaspace** (code font) · OKLCH + **Radix Colors** + **tweakcn** + **culori/apcach** ·
**Motion** + **AutoAnimate** + **Lenis/GSAP** + **anime.js v4** + **View Transitions** ·
**pqoqubbw/icons** (animated icons) · **@number-flow/react** (animated numbers) ·
**react-bits** / **animate-ui** / **Magic UI**(MCP) / **Aceternity** (animated blocks) ·
**Kibo UI / Tremor / Origin UI** (breadth/data) · **motion-primitives / Cult UI** (taste) · **Rive** (vector) ·
**DESIGN.md** convention (DTCG tokens as brand SSOT — the #1 anti-AI-slop lever).

## 8. Config health / self-validation
- **agnix** (`npx agnix@latest <file>`) — lints CLAUDE.md / SKILL.md / MCP / hooks (420 rules). Scope to AURAMAXING's OWN files (`~/.claude/CLAUDE.md`, `~/.claude/settings.json`) — running on all of `~/.claude` floods with third-party-plugin findings. Baseline (2026-05-29): **0 errors** on own configs; warnings are style-level false-positives in our context (deliberate "NEVER" doctrine; agnix misreads hook timeout ms as seconds).

## 9. Self-extension
- The autopilot MAY search + install new skills/repos when a capability gap blocks the prompt:
  `npx skills add <gh>` (skills — `vercel-labs/skills` is the standard manager), `claude mcp add` (MCP),
  `npx shadcn add <url>` (components), `specify init` (spec-kit). Verify source, prefer free + maintained, register here.
- **On-demand alphas (install when the task needs them, free):**
  - `HKUDS/CLI-Anything` (`/plugin marketplace add HKUDS/CLI-Anything`) — turns GUI/creative/dev apps
    (Blender, FFmpeg, GIMP, LibreOffice, OBS…) into agent-callable CLIs. The unlock for 3D/video/audio/office tasks.
  - `anthropics/skills` document skills (pdf/docx/pptx/xlsx) — native Office-doc generation (a real gap).
  - `multica-ai/andrej-karpathy-skills` — anti-mistake CLAUDE.md guardrails (cheap, orthogonal).
- **Prompt-engineering references (read, don't install):** `asgeirtj/system_prompts_leaks` (freshest leaked
  system prompts incl. Claude Code) · `anthropics/claude-cookbooks` + `prompt-eng-interactive-tutorial` (caching/tool-use patterns).
- **ADOPTED — superpowers = LAYER 1 / base method (highest precedence; user directive 2026-06-26):** installed
  (`superpowers@claude-plugins-official` v6.0.3, user-scope) and is the model's DEFAULT working method. NOT a gstack
  duplicate — it fills disciplines auramaxing/gstack lack (TDD red-green, git-worktrees, verification-before-completion).
  Precedence: superpowers (HOW) ▸ AURAMAXING (WHEN/WHAT + evidence-gatekeeper enforcement) ▸ gstack (domain tools).
  Overlaps NEST: method invokes tool (`systematic-debugging`→`/investigate`, `requesting-code-review`→`/review`+`/cso`).
- **Skip (verified heavy overlap / counter to setup):** ECC / GSD (parallel lifecycles = gstack);
  free-claude-code (counter to max-Opus); steel-browser / browser-use (= your CDP); graphify / mem0 / supermemory /
  cognee (= LightRAG+codegraph); claude-mem (parallel memory system, only if granular action-replay is a pain).

---
## Key-gated (need user API keys — DO NOT assume; ask first)
Exa (neural search) · v0 API · Mobbin MCP · E2B/Vercel sandbox ·
Magic Patterns · Builder.io/Subframe · Paper MCP. When one would materially improve the task, name it and ask for the key.
(Figma deliberately excluded — user's call; design-EXTRACT from reference sites + DESIGN.md tokens replace it.)
