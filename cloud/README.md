# AURAMAXING — Cloud Fleet (Max-billed, terminal-operated)

Delegate **heavy compute** (parallel agent fleets / batch refactors) to a cloud box. Your interactive
Claude Code session stays **LOCAL on the Mac** (full files + CDP browser + MAXING statusline, native);
**projects stay local** (synced per job); billed to your **Claude Max** (no API key).

Why: your Mac is 8GB. The box absorbs the RAM-heavy parallel sub-work so the laptop never thrashes.

> **Current production box:** Hetzner **cpx42** (8 vCPU / 16 GB x86, Ubuntu 24.04) at
> `AURA_FLEET_HOST=root@<ip>` — **paid (~€29.99/mo)**, already provisioned. Power it off when idle.
> (The provisioner is vendor-neutral — any Ubuntu x86/ARM box works, incl. Oracle's free A1 shape.)

---

## YOUR 2 one-time steps (the only things I can't do for you)

### Step 1 — Create the free Oracle box (~5 min)
1. Sign up: https://www.oracle.com/cloud/free/ → "Start for free" (asks for a card to verify; **Always-Free is $0, not charged**).
2. Console → **Compute → Instances → Create instance**:
   - **Image:** Ubuntu 22.04 (or 24.04).
   - **Shape:** *Ampere* → **VM.Standard.A1.Flex**, set **4 OCPU / 24 GB** (all within Always-Free).
   - **SSH keys:** upload your Mac's public key — get it with `cat ~/.ssh/id_ed25519.pub` (if none: `ssh-keygen -t ed25519`).
   - Create. Note the **public IP**.
3. Networking → the instance's subnet → Security List → add an **Ingress rule** for TCP **22** from `0.0.0.0/0` (SSH). (Egress is open by default.)

### Step 2 — Provision + authenticate (one paste each)
From your Mac terminal (copies the local provisioner up — no GitHub push needed):
```bash
scp ~/auramaxing/cloud/provision.sh ubuntu@<PUBLIC_IP>:~/      # send the setup script
ssh ubuntu@<PUBLIC_IP> 'bash ~/provision.sh'                   # one command sets up everything
ssh ubuntu@<PUBLIC_IP>                                         # connect, then:
claude login                                                   # paste the device code in your laptop browser
```
That's it. The box is now an AURAMAXING agent-fleet node.

> **Note:** `provision.sh` clones AURAMAXING from GitHub `main`. To mirror THIS machine's current
> setup (phased-loop, gatekeeper, eval system, /fleet, design-kit, etc.), those changes must be
> **committed + pushed** to the repo first — otherwise the box gets an older AURAMAXING. The box still
> works as a full cloud Claude Code node without it; the push just makes it a 1:1 mirror.

---

## Using it (from your Mac terminal, projects stay local)

**Option A — just work on the big box** (simplest; solves the RAM ceiling):
```bash
ssh ubuntu@<PUBLIC_IP>
cd ~/fleet && claude            # full Claude Code TUI, 24GB, same UX as your Mac
```

**Option B — `/fleet`: dispatch a parallel fleet, keep editing locally:**
```bash
export AURA_FLEET_HOST="ubuntu@<PUBLIC_IP>"          # add to ~/.zshrc
~/auramaxing/cloud/fleet.sh ~/code/polymaxxing \
  "add unit tests for the scoring module" \
  "refactor the CLI arg parser" \
  "write a README usage section"
# → 3 agents run in parallel on the box; diffs land in ~/code/polymaxxing/fleet-results/
# apply a winner:  git apply fleet-results/agent-2.diff
```
Your local repo is the source of truth; `fleet.sh` rsyncs it up, runs N agents on the box, brings
diffs back. No GitHub remote required (works for local-only projects like polymaxxing/econ-funnel).

**Option C — `acode`: a full Claude Code session ON the box** (Path A — box-resident orchestration).
The Mac stays a thin client; the box runs the whole session (hooks + MCP + subagents/Workflows) in its
RAM, files live-mirrored, resilient tmux (survives SSH drops). `acode` / `acode <proj>` / `acode -p "…"`.

**Option D — `orchestra.sh`: role-based research/analysis fleet** (Path B — fan-out → judges → synthesis):
```bash
export AURA_FLEET_HOST="root@<ip>"
~/auramaxing/cloud/orchestra.sh "What's the best X for Y? Be skeptical, cite sources."   # 5-role preset + 3 judges
~/auramaxing/cloud/orchestra.sh "Redesign the dashboard" cloud/roles/frontend.roles      # curated role panel
# → ~/orchestra-results/<run>/SYNTHESIS.md  (+ role-*.txt, judge-*.txt, findings.md, critiques.md)
```
N specialists (each a `Role :: angle`) investigate in parallel → J adversarial judges refute/rank →
1 synthesizer merges into a decision-ready report. Concurrency AUTO-scales to the box's free RAM (never
thrashes). Knobs: `ORCH_JUDGES=3 ORCH_LIGHT=1 ORCH_TIMEOUT=900 ORCH_N=<auto>`. Presets: `cloud/roles/`
(`research` · `frontend` = impeccable/ui-ux-pro-max lenses · `code` = investigate/cso/perf).

**Option E — `swarm.sh`: drain a backlog of up to ~200 tasks** through a bounded, mem-capped worker pool
(`swarm.sh <project> <tasks-file>`; `SWARM_N=4 SWARM_MEM=3G`). Best for many independent code tasks.

### Lean workers (why the fleets are fast + never OOM) — load-bearing detail
Every fleet worker (`fleet`/`swarm`/`orchestra`) runs `claude` with the AURAMAXING **autopilot hooks OFF**
via `--settings '{"hooks":{}}'`. The full hook stack (prompt-engine + LightRAG embeddings ~1-2GB +
daemons) otherwise adds ~70s/agent and OOM-kills mem-capped workers. `--bare` also disables hooks but
**breaks OAuth** — `--settings` is the one that keeps Max auth. Result: ~0.5GB/lean agent, so a 16GB box
fits ~10 light agents; upsize (32-64GB) only for heavy agents that each load MCP/browser. RAM is governed
by **concurrency**, not a hard cgroup cap (the cap caused SIGKILL under pressure). Verified end-to-end.

## Notes
- **Sync:** rsync per dispatch (excludes node_modules/.git/build dirs). For live bidirectional sync,
  install `mutagen` later (optional upgrade).
- **Billing:** `claude login` uses Max OAuth on the box (no API key). Heavy non-interactive fleets
  may draw the Agent-SDK credit pool after 2026-06-15 — watch usage.
- **Cost:** current box is Hetzner cpx42 (~€29.99/mo, ~€0.049/hr) — **power it off when idle** to save.
  For $0/mo, re-provision on Oracle's Always-Free A1 shape (≤4 OCPU/24 GB) instead; `provision.sh` is
  vendor-neutral. Either way the interactive session runs locally — the box only does compute jobs.
