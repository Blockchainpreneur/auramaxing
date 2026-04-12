#!/usr/bin/env node
/**
 * AURAMAXING — Task-specific CLAUDE.md segment generator
 *
 * Reads ~/.claude/CLAUDE.md, splits by ## headers, maps sections to task types,
 * and writes compressed subsets to ~/.auramaxing/prompt-cache/claudemd-{taskType}.txt
 *
 * Each segment is ~500-1500 tokens (vs ~6000 full), containing ONLY the sections
 * relevant to the current task type. The router injects the matching segment
 * as a lightweight CONTEXT directive.
 *
 * Called by: precompute-pipeline.mjs (Step 6)
 * Output: ~/.auramaxing/prompt-cache/claudemd-{taskType}.txt
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const CLAUDE_MD = join(HOME, '.claude', 'CLAUDE.md');
const CACHE_DIR = join(HOME, '.auramaxing', 'prompt-cache');

mkdirSync(CACHE_DIR, { recursive: true });

// ── Step 1: Read and parse CLAUDE.md into sections ──────────────────────────

if (!existsSync(CLAUDE_MD)) {
  process.stderr.write('[claudemd-segments] CLAUDE.md not found, skipping\n');
  process.exit(0);
}

const raw = readFileSync(CLAUDE_MD, 'utf8');

/**
 * Split the file by ## headers. Each section gets a key (slug of the header)
 * and the full content including the header line.
 */
function parseSections(content) {
  const sections = [];
  const lines = content.split('\n');
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## (.+)/);
    if (match) {
      if (current) sections.push(current);
      const title = match[1].trim();
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      current = { title, slug, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before first ## are preamble — skip them (identity block, not task-relevant)
  }
  if (current) sections.push(current);

  // Build final section objects with content
  return sections.map(s => ({
    title: s.title,
    slug: s.slug,
    content: s.lines.join('\n').trim(),
  }));
}

const sections = parseSections(raw);

// Build a lookup by slug
const sectionMap = {};
for (const s of sections) {
  sectionMap[s.slug] = s;
}

// ── Step 2: Define task-type → section mappings ─────────────────────────────

// Section slugs found in CLAUDE.md:
//   visual-protocol-non-negotiable-always-on
//   session-memory-persistent-across-sessions
//   prompt-engine-anti-laziness-memory-retrieval
//   self-healing-workflows
//   global-approach
//   permissions-all-bypassed-autopilot-mode
//   global-behavioral-rules
//   security-rules
//   aura-autopilot-engine-always-on
//   agent-teams-swarm
//   browser-automation-native-auramaxing-skill-cdp
//   ui-design-activate-only-when-building-ui
//   gstack-ai-software-factory-global

const ALWAYS_INCLUDE = [
  'global-behavioral-rules',
  'security-rules',
];

const TASK_SECTIONS = {
  'bug-fix': [
    ...ALWAYS_INCLUDE,
    'self-healing-workflows',
    'aura-autopilot-engine-always-on',  // TOOLS protocol for tool selection
  ],
  'new-feature': [
    ...ALWAYS_INCLUDE,
    'ui-design-activate-only-when-building-ui',
    'aura-autopilot-engine-always-on',
    'gstack-ai-software-factory-global',
  ],
  'deploy-ship': [
    ...ALWAYS_INCLUDE,
    'gstack-ai-software-factory-global',
  ],
  design: [
    ...ALWAYS_INCLUDE,
    'ui-design-activate-only-when-building-ui',
    'aura-autopilot-engine-always-on',
  ],
  'e2e-testing': [
    ...ALWAYS_INCLUDE,
    'browser-automation-native-auramaxing-skill-cdp',
  ],
  security: [
    ...ALWAYS_INCLUDE,
    'aura-autopilot-engine-always-on',
    'gstack-ai-software-factory-global',
  ],
  'code-review': [
    ...ALWAYS_INCLUDE,
    'aura-autopilot-engine-always-on',
  ],
  refactor: [
    ...ALWAYS_INCLUDE,
    'self-healing-workflows',
  ],
  planning: [
    ...ALWAYS_INCLUDE,
    'gstack-ai-software-factory-global',
  ],
  investigate: [
    ...ALWAYS_INCLUDE,
    'self-healing-workflows',
    'aura-autopilot-engine-always-on',
  ],
  performance: [
    ...ALWAYS_INCLUDE,
    'aura-autopilot-engine-always-on',
  ],
  'brain-dump': [
    ...ALWAYS_INCLUDE,
  ],
  strategy: [
    ...ALWAYS_INCLUDE,
    'gstack-ai-software-factory-global',
  ],
  pitch: [
    ...ALWAYS_INCLUDE,
    'gstack-ai-software-factory-global',
  ],
  research: [
    ...ALWAYS_INCLUDE,
    'aura-autopilot-engine-always-on',
  ],
};

// ── Step 3: Compress sections for each task type ────────────────────────────

/**
 * Compress a section: strip code blocks, collapse whitespace, trim to essential content.
 * Goal: convey the rules in minimal tokens without losing meaning.
 */
function compressSection(section) {
  let text = section.content;

  // Remove code blocks (examples, not rules)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove markdown table formatting but keep content
  text = text.replace(/\|[-:]+\|[-:| ]+\|/g, '');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Remove trailing whitespace per line
  text = text.replace(/[ \t]+$/gm, '');

  return text.trim();
}

let generated = 0;

for (const [taskType, slugs] of Object.entries(TASK_SECTIONS)) {
  // Deduplicate slugs
  const uniqueSlugs = [...new Set(slugs)];
  const parts = [];

  for (const slug of uniqueSlugs) {
    const section = sectionMap[slug];
    if (section) {
      parts.push(compressSection(section));
    }
  }

  if (parts.length === 0) continue;

  let segment = parts.join('\n\n---\n\n');

  // Hard cap at ~2000 chars (~500 tokens) to keep segments lean
  if (segment.length > 2000) {
    segment = segment.slice(0, 2000).replace(/\n[^\n]*$/, '');
  }

  const outPath = join(CACHE_DIR, `claudemd-${taskType}.txt`);
  writeFileSync(outPath, segment);
  generated++;
}

// Also generate default segment (behavioral + security only, minimal)
{
  const defaultParts = ALWAYS_INCLUDE
    .map(slug => sectionMap[slug])
    .filter(Boolean)
    .map(compressSection);

  if (defaultParts.length > 0) {
    let segment = defaultParts.join('\n\n---\n\n');
    if (segment.length > 1000) {
      segment = segment.slice(0, 1000).replace(/\n[^\n]*$/, '');
    }
    writeFileSync(join(CACHE_DIR, 'claudemd-default.txt'), segment);
    generated++;
  }
}

process.stderr.write(`[claudemd-segments] Generated ${generated} task-specific segments\n`);
process.exit(0);
