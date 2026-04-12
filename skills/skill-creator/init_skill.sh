#!/bin/bash
# AURAMXING Skill Creator — scaffold a new skill
NAME="${1:?Usage: init_skill.sh <skill-name>}"
DIR="$HOME/auramxing/skills/$NAME"
mkdir -p "$DIR"
cat > "$DIR/SKILL.md" << EOF
---
name: $NAME
description: |
  Custom AURAMXING skill for $NAME
---
# $NAME

## Usage
Describe how this skill works.

## Steps
1. Step one
2. Step two
EOF
echo "Skill created at $DIR/SKILL.md"
