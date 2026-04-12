#!/usr/bin/env node
// SessionStart daemon ping — writes context for current project
// Always exits 0.
import { request } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();

async function run() {
  try {
    const result = await fetch(`http://localhost:57821/context?cwd=${encodeURIComponent(cwd)}`);
    if (result.ok) {
      const data = await result.json();
      if (data.context) {
        mkdirSync(join(cwd, '.claude'), { recursive: true });
        writeFileSync(join(cwd, '.claude', 'context.md'), data.context);
      }
    }
  } catch {}
}

run().catch(() => {}).finally(() => process.exit(0));
