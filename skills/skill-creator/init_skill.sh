#!/bin/bash
# AURAMAXING Skill Creator — scaffold a new skill
NAME="${1:?Usage: init_skill.sh <skill-name>}"
DIR="$HOME/auramaxing/skills/$NAME"
mkdir -p "$DIR"
cat > "$DIR/SKILL.md" << EOF
---
name: $NAME
description: |
  Custom AURAMAXING skill for $NAME
---
# $NAME

## Usage
Describe how this skill works.

## Steps
1. Step one
2. Step two
EOF
echo "Skill created at $DIR/SKILL.md"
