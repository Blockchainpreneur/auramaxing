#!/usr/bin/env bash
# AURAMAXING — deploy repo helpers → runtime (single source of truth).
#
# WHY: the hooks execute ~/.claude/helpers/*.mjs, but the EDITED source lives in
# ~/auramaxing/helpers/*.mjs. They are SEPARATE copies, so editing the repo does NOT
# reach the runtime until they are synced — silent repo→runtime drift (the eval's
# drift-* tests assert byte-identical copies and will go red on any drift).
#
# This script makes the repo the source of truth with a SAFE, explicit deploy step
# (chosen over symlinks: symlinks survive box-sync's `rsync -a` but are fragile to
# editor save-semantics and any future `--copy-links`; an explicit rsync matches the
# mental model box-sync-env.sh already uses for ~/.claude/helpers).
#
# SCOPE: copies ONLY helpers that already exist in BOTH dirs. Runtime-only files
# (e.g. nothing today) and repo-only files (nlm-live-recall.mjs, nlm-writer.mjs, …
# not yet wired as live hooks) are NEVER touched — repo-only is not deployed because
# it isn't a live hook, runtime-only would be clobbered.
#
# Run AFTER editing any repo helper:  bash ~/auramaxing/cloud/deploy-helpers.sh
# Verify:                             node ~/auramaxing/evals/run.mjs   (drift-* green)
set -uo pipefail

REPO_H="$HOME/auramaxing/helpers"
RUNTIME_H="$HOME/.claude/helpers"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -d "$REPO_H" ]    || { echo "✗ repo helpers not found: $REPO_H"; exit 1; }
[ -d "$RUNTIME_H" ] || { echo "✗ runtime helpers not found: $RUNTIME_H"; exit 1; }

deployed=0; skipped_repoonly=0; unchanged=0
for f in "$REPO_H"/*.mjs; do
  [ -e "$f" ] || continue
  b="$(basename "$f")"
  dst="$RUNTIME_H/$b"
  if [ ! -e "$dst" ]; then
    # repo-only: not a live hook, do not introduce it into the runtime
    skipped_repoonly=$((skipped_repoonly+1))
    continue
  fi
  if cmp -s "$f" "$dst"; then
    unchanged=$((unchanged+1))
    continue
  fi
  if [ "$DRY" = "1" ]; then
    echo "  would deploy  $b"
  else
    cp "$f" "$dst" && echo "  deployed      $b"
  fi
  deployed=$((deployed+1))
done

if [ "$DRY" = "1" ]; then
  echo "▸ dry-run: $deployed would change, $unchanged identical, $skipped_repoonly repo-only skipped."
else
  echo "▸ deployed $deployed helper(s); $unchanged already identical; $skipped_repoonly repo-only skipped."
  echo "▸ verify:  node ~/auramaxing/evals/run.mjs   (drift-* tests must be green)"
fi
