# AURAMAXING — Fleet 10x Plan

> Goal: 10x AURAMAXING's *output* vs today by moving from one throttled 8 GB Mac + one Claude
> session to a **cloud fleet** that (1) drains large task queues in parallel, (2) runs an
> **autonomous nightly loop** (memory consolidation + repo audit → morning suggestions), and
> (3) is **cost-unbounded** via OSS-model fallback when the Claude limit hits.
> Version 1.0 · 2026-06-01 · grounded in 3 verified research passes (see Sources at end).

---

## 0. Where the 10x ACTUALLY comes from (honest thesis)

Not from "200 concurrent agents" (the Max plan rate-limit + 16 GB RAM make that a myth on one box).
The real multiplier is four compounding levers, each evidence-backed:

1. **Capacity offload** — heavy work leaves the 8 GB Mac (thrashing, [[project_mac_thrash_optimization]]) for the cloud. The Mac stays a thin controller. ✅ box already live.
2. **Parallel backlog drain** — a *queue* of up to 200 tasks processed by a bounded worker pool (~4 on the box; burst to ~50 boxes when truly needed). Throughput, not magic.
3. **Compounding while you sleep** — a nightly autonomous loop consolidates memory and audits the codebase, so **morning starts with a prioritized work list already written**. This is the "compound engineering" lever: ~80% of agentic value is in plan+review, and this front-loads it. (300–700% gains reported industry-wide.)
4. **Cost-unbounded bulk** — Claude/Max for high-value reasoning; **Kimi K2.6 / DeepSeek-V4** (≈Claude-class on SWE-bench, 5–10x cheaper) for bulk + when the Claude limit hits. Volume stops being quota-bound.

**The leverage is discipline (spec-driven + adversarial verify loop), not framework surface.**

---

## 1. Three hard constraints (must design around — non-negotiable reality)

1. **16 GB ≠ 200 processes.** A `claude -p` process runs ~1.5–4 GB (fat tail: real reports of 12 GB+ leaks, orphaned MCP children). After ~3 GB OS reserve, **safe steady-state = ~4 concurrent workers** (6 only with MCP disabled; 8 absolute ceiling). "200 sub-agents" = **200-item queue, 4-wide** (~100 min wall-clock), not 200 live processes.
2. **Max subscription CANNOT pass through a proxy.** Anthropic banned third-party subscription-OAuth in tools (Feb 2026) + auth-precedence means `ANTHROPIC_BASE_URL` overrides the Max OAuth. So "Claude-first → OSS on limit" is an **external launcher** that detects the limit and relaunches via a router → OSS — NOT in-proxy failover.
3. **Agent-SDK credit split (June 15 2026).** `claude -p` / SDK on a subscription draws a **separate monthly credit pool**. The fleet uses `claude -p` heavily → reserve Claude for high-value, push bulk to Kimi/DeepSeek API keys.

Plus: 200-way *concurrency* hits the **Max rate limit long before RAM** → genuine 200-wide needs OSS API keys (Kimi/DeepSeek), not one Max seat.

---

## 2. Model roster (verified June 2026)

| Role | Model | Why | Access | $/1M (in/out) |
|---|---|---|---|---|
| **Primary reasoning** | Claude (Max, native) | best agentic/tool-use, already authed on box | native OAuth | Max plan |
| **Claude-Code drop-in fallback** | **Kimi K2.6** | Anthropic-compatible endpoint = 1 env var; 80.2% SWE-bench; closest OSS to Claude tool-use; 300-agent swarm | `api.moonshot.ai/anthropic`, `kimi-k2.6` | $0.95/$4.00 (cache-hit in $0.16) |
| **Cheapest bulk / long-context** | **DeepSeek-V4-Pro** | best open SWE-bench (80.6%), **1M ctx**, MIT, cheapest | OpenRouter `deepseek/deepseek-v4-pro` | **$0.435/$0.87** |
| **Long-context overflow** | Qwen3-Coder-480B | 256K–1M ctx, Apache-2.0 | OpenRouter / DeepInfra | $0.22/$1.80 |
| **Background/small-fast** | Qwen2.5-Coder (Ollama, local on box) OR Kimi | title/token-count calls; free if local | Ollama / Moonshot | ~free / cheap |
| **Nightly memory+audit judgment** | **Kimi K2.6** | reasoning + cache-hit $0.16 (re-feeds big memory cheaply) | Moonshot API | $0.16 cached in |

---

## 3. Target architecture

```
  ┌─ Mac (8 GB, thin controller) ─────────────────────────────┐
  │  fleet.sh / queue-enqueue · git (memory SoT) · review UI   │
  └───────────────┬───────────────────────────────────────────┘
                  │ ssh / rsync / git
  ┌───────────────▼ Hetzner cpx42 (8 vCPU/16 GB) — CONTROL+WORKER ┐
  │  • Redis (BullMQ queue, durable)   • claude-code-router (CCR) │
  │  • worker pool N=4  (claude -p, mem-capped, MCP off, reaped)  │
  │  • systemd --user timer 03:00 → nightly.sh (Kimi judgment)    │
  │  • OSS fallback: CCR → Kimi K2.6 → DeepSeek-V4 → Qwen         │
  └───────────────┬──────────────────────────────────────────────┘
                  │ hcloud API (burst only when needed)
        ┌─────────▼─────────┐   ...  spin ~50× CPX31 from a snapshot,
        │ burst worker boxes │        shared Redis queue, tear down on
        │ conc=4 each        │        empty (~€4 for 2h). Raise Hetzner
        └────────────────────┘        per-project limit (~10 default) first.
```

---

## 4. Phased rollout (each phase ends with an evidence gate)

### Phase 1 — Worker pool + queue (the "200 backlog" core)  ·  ~1 session
- Install Redis + a tiny enqueue CLI; OR ship-first with **GNU `parallel -j 4 --retries 2 --resume-failed`** draining a task file.
- Each worker: `systemd-run --scope -p MemoryMax=3G timeout 600 claude -p "$task" --strict-mcp-config --mcp-config /dev/null --output-format json`; **reap orphan MCP/headless children** after each task.
- Extend `fleet.sh` → `swarm.sh <project> tasks.txt` (queue mode, dedup results).
- **Gate:** enqueue 20 real tasks, drain 4-wide, RSS never exceeds ~13 GB (watchdog), 0 orphans after, results deduped. Quote `joblog`.

### Phase 2 — OSS fallback router (cost-unbounded)  ·  ~1 session
- Install `claude-code-router`; `config.json` with providers Kimi K2.6 / DeepSeek-V4 / Qwen + `Router.fallback` chains; daemonize via systemd.
- **External limit-detector launcher**: wrapper parses `claude -p` for "limit reached"/429 → relaunch task via `ccr code` (OSS path). Bulk/low-value workers default straight to Kimi/DeepSeek to spare Max + Agent-SDK credits.
- **Gate:** force a Claude failure → task completes on Kimi; force Kimi error → CCR falls back to DeepSeek. Quote both transcripts. Verify tool-use isn't broken (run a 3-step agentic task on Kimi).

### Phase 3 — Nightly autonomous loop (compounding)  ·  ~1 session
- `systemd --user` timer 03:00 (`Persistent=true`, `RandomizedDelaySec`, `loginctl enable-linger`).
- `nightly.sh` (`flock`-guarded, idempotent, dated outputs):
  - **A. Memory consolidation** — digest `~/.claude/.../memory/*.md` → Kimi K2.6 (dedupe/cluster/drop-stale, preserve every unique decision) → atomic swap with `.bak` → `git commit && push`.
  - **B. Repo audit** — deterministic collectors (grep TODO/FIXME, `git log` churn, `osv-scanner`/`npm audit`, `knip` dead-code, coverage gaps) → Kimi K2.6 prioritizes → `MORNING-SUGGESTIONS.md` (P0 security / P1 correctness / P2 cleanup, each with file:line + fix + effort).
  - **C. Sync back** — git for memory, `rsync` report to Mac (staged if Mac offline).
- **Gate:** run it once manually; verify memory rebuilt losslessly (diff decisions in vs out), suggestions cite real file:line, cost < cap, re-run is idempotent. Quote `journalctl`.

### Phase 4 — Horizontal burst (only when a job truly needs 200-wide)  ·  optional
- Bake a Hetzner **snapshot** (CLI+auth+worker preinstalled, ~60–90 s boot).
- BullMQ+Redis on control box; `hcloud server create` N workers → drain shared queue → `hcloud server delete` on empty.
- **Pre-req:** raise Hetzner per-project server limit (default ~10; manual review ~1–3 business days) BEFORE the night you need 50.
- **Gate:** burst 10 boxes, drain 200 tasks, auto-teardown, cost reconciled (~€4/2h target).

---

## 5. Swarm best-practices (baked into every phase)
Idempotent tasks · durable queue as SoT · concurrency capped to *physical* budget (not framework's claimed 16) · retries+backoff+DLQ · result dedup before it reaches you · hard cost caps (max tokens/task, $/night, kill-switch) · orphan/zombie reaping · `MemoryMax` per worker · timeouts everywhere · `flock` no-overlap · deterministic collection + LLM only for judgment.

Inner fan-out note: keep subagents per session to **2–3** (not 16) — 4 outer × 3 inner ≈ RAM ceiling. Nightly batch: **don't nest**, single-shot per task.

---

## 6. Cost model
- **Box:** cpx42 €29.99/mo, or **€0.049/hr** (power off when idle → ~$1–3/mo real).
- **Nightly Kimi:** memory+audit ≈ a few hundred K tokens/night, cache-hit input $0.16 → **cents/night**.
- **Bulk OSS drain:** DeepSeek-V4 $0.435/$0.87 → a 200-task batch ≈ low single-digit $.
- **Burst:** ~€4 per 2h true-200-wide event.
- **Claude/Max:** reserved for high-value → stays within plan + Agent-SDK credits.

---

## 7. Decisions needed from you (the only blockers)
1. **API keys to provision** (bulk + fallback): **Moonshot/Kimi** (required for nightly + Claude-drop-in fallback) and **OpenRouter** (gives DeepSeek-V4 + Qwen in one key). DeepSeek-direct optional.
2. **Monthly spend cap** for OSS bulk (e.g. $20/mo) → sets the kill-switch.
3. **Target repo(s)** for the nightly audit (polymaxxing? econ-funnel? saas-main?).
4. **Burst now or later** — Phase 4 only if you foresee true 200-wide jobs soon (else skip; the pool+OSS covers normal load).

## 8. Recommended sequence
Phase 1 → 2 → 3 now (each ~1 session, each gated). Phase 4 only on demand. I execute autonomously, verifying each gate with quoted evidence before advancing.

---

## Sources (verified, June 2026)
Models: kimi.com/blog/kimi-k2-6 · platform.kimi.ai/docs/models · llm-stats.com/benchmarks/swe-bench-verified · openrouter.ai/deepseek/deepseek-v4-pro · qwenlm.github.io/blog/qwen3-coder.
Routing: code.claude.com/docs/en/llm-gateway · code.claude.com/docs/en/authentication · github.com/musistudio/claude-code-router · deepwiki claude-code-router 6.8 fallback · docs.litellm.ai/docs/tutorials/claude_non_anthropic_models · winbuzzer OAuth-ban 2026-02.
Orchestration: github.com/anthropics/claude-code issues #23252/#42962/#30470/#34568 (RAM/leaks) · code.claude.com/docs/en/sub-agents · Hetzner docs FAQ/limits + pricing · tokenmix Kimi pricing.
Strategy: every.to compound-engineering · addyosmani.com/blog/code-agent-orchestra · venturebeat spec-driven agentic coding.
