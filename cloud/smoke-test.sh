#!/usr/bin/env bash
# AURAMAXING cloud — local smoke test. ZERO box/network/filesystem side effects: it exercises only
# syntax, usage guards, and DRY_RUN planning. Safe to run anywhere (Mac or CI).
#   bash cloud/smoke-test.sh
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)" || exit 1

pass=0; fail=0
check() {  # check "label" "shell-expression"  — expression's exit code is the verdict
  if eval "$2" >/dev/null 2>&1; then echo "  ✓ $1"; pass=$((pass+1));
  else echo "  ✗ $1"; fail=$((fail+1)); fi
}

echo "== syntax: bash -n =="
for f in *.sh; do check "$f parses" "bash -n '$f'"; done
if command -v zsh >/dev/null 2>&1; then
  echo "== syntax: zsh -n =="
  for f in *.zsh; do check "$f parses" "zsh -n '$f'"; done
fi

echo "== usage guards (missing/bad args MUST exit non-zero) =="
check "fleet.sh no-args fails"  "! AURA_FLEET_HOST=x bash fleet.sh"
check "swarm.sh no-args fails"  "! AURA_FLEET_HOST=x bash swarm.sh"
check "fleet.sh bad-dir fails"  "! AURA_FLEET_HOST=x bash fleet.sh /no/such/dir 'task'"
check "swarm.sh bad-file fails" "! AURA_FLEET_HOST=x bash swarm.sh . /no/such/tasks.txt"

echo "== DRY_RUN plans (no side effects) =="
tmp="$(mktemp -d)"; printf 'task one\n# comment\n\ntask two\n' > "$tmp/tasks.txt"
check "fleet.sh DRY_RUN exits 0" "DRY_RUN=1 AURA_FLEET_HOST=x bash fleet.sh '$tmp' 'a task'"
check "swarm.sh DRY_RUN exits 0" "DRY_RUN=1 AURA_FLEET_HOST=x bash swarm.sh '$tmp' '$tmp/tasks.txt'"
printf '# only comments\n\n' > "$tmp/allcomments.txt"
check "swarm.sh DRY_RUN all-comment file" "DRY_RUN=1 AURA_FLEET_HOST=x bash swarm.sh '$tmp' '$tmp/allcomments.txt'"
check "fleet.sh --file branch (no mapfile)" "DRY_RUN=1 AURA_FLEET_HOST=x bash fleet.sh '$tmp' --file '$tmp/tasks.txt'"
# portability: the --file branch must ALSO work on macOS system bash 3.2 (not just brew bash 5) — guards the mapfile regression
[ -x /bin/bash ] && check "fleet.sh --file on /bin/bash (3.2)" "DRY_RUN=1 AURA_FLEET_HOST=x /bin/bash fleet.sh '$tmp' --file '$tmp/tasks.txt'"
check "swarm rejects non-int SWARM_N" "! SWARM_N=evil DRY_RUN=1 AURA_FLEET_HOST=x bash swarm.sh '$tmp' '$tmp/tasks.txt'"

echo "== acode.sh behavioral (DRY_RUN — zero box contact) =="
check "acode.sh DRY_RUN no-args (CWD)"   "DRY_RUN=1 AURA_FLEET_HOST=x bash acode.sh"
check "acode.sh DRY_RUN -p prompt"        "DRY_RUN=1 AURA_FLEET_HOST=x bash acode.sh -p 'do X'"
check "acode.sh DRY_RUN dir arg"          "DRY_RUN=1 AURA_FLEET_HOST=x bash acode.sh '$tmp'"
check "acode.sh DRY_RUN HOME→skip-sync"   "DRY_RUN=1 AURA_FLEET_HOST=x bash acode.sh \"\$HOME\" 2>&1 | grep -q SKIP_SYNC=1"
check "acode.sh -p with no prompt rejects" "! DRY_RUN=1 AURA_FLEET_HOST=x bash acode.sh -p"
check "acode.sh rejects unsafe HOST (-o…)" "! DRY_RUN=1 AURA_FLEET_HOST=-oProxyCommand=id bash acode.sh"

echo "== validators (subshell so exit stays local) =="
check "ccr-launch.sh no-args fails"       "! bash ccr-launch.sh"
check "aura_require_mem rejects 1G2M"     "! ( . ./lib.sh; aura_require_mem M '1G2M' )"
check "aura_require_mem rejects GGGG"     "! ( . ./lib.sh; aura_require_mem M 'GGGG' )"
check "aura_require_posint rejects 0"     "! ( . ./lib.sh; aura_require_posint FLEET_N 0 )"
check "aura_require_host rejects -o…"     "! ( . ./lib.sh; aura_require_host '-oProxyCommand=id' )"
rm -rf "$tmp"

echo "== lib.sh helpers (pure, no network) =="
check "aura_safe_name strips spaces" \
  ". ./lib.sh; case \"\$(aura_safe_name '/a b/c d')\" in *' '*) false ;; *) true ;; esac"
check "aura_mutagen_name has no _ or ." \
  ". ./lib.sh; case \"\$(aura_mutagen_name acode '/x_y/z.q')\" in *[._]*) false ;; *) true ;; esac"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
