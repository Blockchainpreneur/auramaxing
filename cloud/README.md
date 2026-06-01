# AURAMAXING — Cloud Fleet (Oracle Always-Free, $0/mo, Max-billed, terminal-operated)

Delegate parallel agent execution to a free 24GB ARM cloud box. **Projects stay local** (synced per
task); you **operate from your terminal** (SSH); billed to your **Claude Max** (no API key).

Why: your Mac is 8GB. The cloud box is 4 cores / 24GB → run agent fleets without melting your laptop.

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

## Notes
- **Sync:** rsync per dispatch (excludes node_modules/.git/build dirs). For live bidirectional sync,
  install `mutagen` later (optional upgrade).
- **Billing:** `claude login` uses Max OAuth on the box (no API key). Heavy non-interactive fleets
  may draw the Agent-SDK credit pool after 2026-06-15 — watch usage.
- **Cost:** Oracle Always-Free = $0/mo as long as you stay on the A1 free shape (≤4 OCPU/24GB).
