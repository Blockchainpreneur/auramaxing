# AURAMAXING — Autopilot Master Flow (100% automated orchestration)

> How the Aura autopilot turns ANY prompt into the best possible output with zero manual
> tool selection. The router (`rational-router-apex.mjs`, UserPromptSubmit hook) classifies +
> emits directives; the agent then composes the capability registry per the doctrines. This
> doc is the contract for that composition. Designed via the gstack plan-eng lens.
>
> v1.0 · 2026-05-30 · Companion: ORCHESTRATION.md (how to loop), DESIGN-SUPREMACY.md (UI),
> CAPABILITIES.md (what to compose).

## The pipeline (every prompt)

```
USER PROMPT
   │
   ▼
[1] ROUTER (hook, automatic) ── classifies task-type + complexity (0-100)
   │   emits: DISPLAY · task/model/tier · EXECUTE skill-chain · ENRICH · TOOLS · ORCHESTRATE
   │
   ▼
[2] COMPOSE (agent, automatic per ORCHESTRATE directive)
   │   trivial(<30) → answer direct
   │   medium(30-49) → 1 gstack skill + relevant MCP/CLI, verify with evidence
   │   complex(50+)  → full Iron Loop + parallel agents/Workflow + adversarial verify
   │
   ▼
[3] IRON LOOP (complex)  RESEARCH→PLAN→EXECUTE→AUDIT→TEST→SELF-IMPROVE  ↺ until exit bar
   │
   ▼
[4] PROVE + DISTILL ── evidence (tests/screenshots/output) + write a learning
```

## Task-type → automatic tool composition (the routing table)

The router emits these as `TOOLS:`/`ORCHESTRATE:` lines so the agent reaches for them
without being asked. CLI-first; MCP lazy-loaded via Tool Search.

| Task | Auto-composed chain |
|---|---|
| **new-feature** | `/office-hours`→`/plan-eng-review` · **Grep/Glob + Explore agent** (understand code) · **spec-kit** (`specify`) for non-trivial · **deepwiki** (external libs) · build · `/review`+`/cso`+**/codex** · `/qa` (Playwright) · `/ship` |
| **bug-fix** | `/investigate` · **Grep/Glob + Explore agent** (trace refs to root cause) · **deepwiki** (lib behavior) · Playwright repro · `/review` · `/qa` |
| **design / UI** ⭐PRIORITY | **MANDATORY skill stack (all installed, invoke ALL):** frontend-design + emil-design-eng + impeccable + design-taste-frontend + high-end-visual-design + hallmark + ui-ux-pro-max (+ style register: minimalist-ui/gpt-taste/industrial-brutalist-ui/stitch-design-taste per brief). Then: Design Supremacy §0.5 · `/design-consultation`/DESIGN.md SSOT · **designlang** (extract reference→tokens) · Tailwind v4 OKLCH + shadcn(Base UI) + Fontsource + Motion/AutoAnimate · **pqoqubbw/icons** + **@number-flow/react** · react-bits/animate-ui/magicui · **GATE:** hallmark 65 + impeccable + axe + Lighthouse + vision-QA loop · `/design-review`→`/qa`. UX/UI is load-bearing — "looks fine" ≠ done. |
| **marketing / copy / growth** | 43 installed marketing skills (`coreyhaines31`): copywriting · cro · seo · ai-seo · aso · ads · ad-creative · analytics · ab-testing · churn-prevention · launch · pricing · retention. Invoke the matching one(s) for landing copy, SEO, ads, growth. |
| **investigate** | `/investigate` · **Grep/Glob + Explore agent** · **deepwiki** · context7 · ultrathink (native) |
| **research** | `/deep-research` · **deepwiki** (repo Q&A) · context7 · firecrawl CLI · `/browse` |
| **refactor** | **Grep/Glob + Explore agent** (impact/callers) · `/review`→`/qa` · context7 |
| **security** | `/cso` (OWASP+STRIDE) · Grep/Glob + Explore agent (trace trust boundaries) |
| **deploy-ship** | `/review`→`/qa`→`/cso`→`/ship`→`/land-and-deploy`→`/canary` · `gh` CLI |
| **performance** | `/benchmark` · Lighthouse CI · Playwright CWV |

## On-demand auto-install (autopilot self-extension)

When a capability gap blocks the prompt, the autopilot installs FREE tooling automatically
(verify source first), then proceeds — no manual step:

| Trigger in prompt | Auto-install / invoke |
|---|---|
| 3D / video / audio / office-app automation (Blender, FFmpeg, GIMP, OBS…) | `/plugin marketplace add HKUDS/CLI-Anything` → `/cli-anything <app>` |
| Generate real Word/Excel/PPT/PDF | `npx skills add anthropics/skills` (document skills) |
| "make it look like <site>" | **designlang** MCP `/extract <url>` → tokens/DESIGN.md |
| Understand an OSS repo / library internals | **deepwiki** MCP `ask_question` (no clone) |
| Elite UI ship-gate | `nutlope/hallmark` (65-gate slop test) · `@google/design.md lint` in CI |
| Brand SSOT seed | pull a `DESIGN.md` from `VoltAgent/awesome-design-md` |
| Install/manage any skill | `npx skills add <owner/repo>` (vercel-labs/skills standard) |

## MCP roster (post-cleanup, token-audited 2026-05-30)

**Active (9, lazy-loaded via Tool Search):** context7(1k) · shadcn(1k) · magicui(0k) ·
designlang(0k) · deepwiki(0k, remote HTTP) · chrome-devtools · + inherited. (serena/codegraph REMOVED — never installed; code-nav = Grep/Glob + Explore agent.)
**Removed (CLI-replaceable / low-use):** github(4k → `gh` CLI) · supabase(5k → CLI/per-project) ·
figma (user call → designlang replaces). **Net baseline saving ≈ 9k tokens/turn.**

Rule: an MCP earns its slot only if (a) no clean CLI exists AND (b) it's used regularly OR
adds a capability nothing else has. Otherwise prefer CLI (per the TOOLS doctrine) or per-project add.

## Invariants
- The user never hand-picks a tool — the router proposes, the agent composes, the doctrines govern.
- Prefer CLI > skill > MCP on token cost ties. Lazy-load MCP. Cross-model `/codex` on non-trivial code.
- Loop to the exit bar ("a senior eng says this is great"). Prove "done" with evidence. Distill a learning.
