#!/usr/bin/env node
/**
 * Aura — AURAMXING Autopilot Engine
 * For visionaries, entrepreneurs, and builders shipping real products.
 *
 * Extends the dev-focused router with:
 * - Entrepreneur cognitive layer (brain-dumps, strategy, pitches, hiring)
 * - Prompt enrichment engine (adds production context users don't ask for)
 * - gstack-first routing (~95% of tasks flow through gstack skills)
 *
 * Output tiers:
 *  - Trivial  (<3%): silent (only greetings, no real task)
 *  - Medium  (3-49%): compact routing + ENRICH context
 *  - Complex (50%+): full Aura panel + EXECUTE/SPAWN/ENRICH directives
 *
 * Non-blocking: always exits 0.
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ── Task complexity scores ──────────────────────────────────────────────────
const COMPLEXITY = {
  // Entrepreneur tasks
  'brain-dump':     30,
  'write-content':  25,
  brainstorm:       35,
  decide:           45,
  research:         50,
  hire:             50,
  strategy:         70,
  pitch:            75,
  fundraise:        80,

  // Dev tasks
  documentation:    5,  retro:      5,   monitor:       10,  memory:   10,
  'web-browse':     15, 'bug-fix':  35,  'code-review': 40,
  refactor:         45, design:     45,  investigate:   50,
  'deploy-ship':    55, performance:60,  planning:      65,
  'new-feature':    70, swarm:      75,  security:      80,  autoplan: 85,
};

// ── Rule definitions ────────────────────────────────────────────────────────
// Entrepreneur rules are listed first so they score higher on entrepreneur language.
const RULES = [

  // ── ENTREPRENEUR LAYER ───────────────────────────────────────────────────

  {
    id: 'brain-dump',
    patterns: [
      /\b(brain.?dump|i've been thinking|let me think out loud|rambling|messy thoughts|wall of text|too many thoughts|a lot on my mind|stream of consciousness)\b/,
      /^(ok so,?|so i|here'?s what i'?m thinking|i have a lot|i don'?t know where to start)/,
    ],
    skill: 'extract-decisions → prioritize → structure → SAVE key decisions + action items to ~/.auramxing/decisions.md',
    label: 'Processing your thoughts',
  },

  {
    id: 'write-content',
    patterns: [
      /\b(write|draft|create).{0,40}\b(email|post|thread|blog|memo|announcement|newsletter|copy|tweet|linkedin|message|letter|update|doc)\b/,
      /\b(write me|draft me|help me write|can you write)\b/,
    ],
    skill: 'draft → /review',
    label: 'Writing for you',
  },

  {
    id: 'brainstorm',
    patterns: [
      /\b(brainstorm|think through|explore.{0,15}idea|what if we|what if i|help me think|possibilities for|options for|how might we|how could we)\b/,
      /\b(riff on|expand on|build on the idea)\b/,
    ],
    skill: '/office-hours → capture',
    label: 'Thinking this through with you',
  },

  {
    id: 'decide',
    patterns: [
      /\b(should i|should we|decision|decide|pros.{0,5}cons|tradeoffs?|choose between|which (is|are|would|should) (be )?better|versus|vs\.)\b/,
      /\b(help me decide|what would you do|what.s the right call|which path)\b/,
    ],
    skill: '/office-hours → framework → recommend',
    label: 'Making the call with you',
    agents: ['advisor', 'researcher'],
  },

  {
    id: 'research',
    patterns: [
      /\b(research|look into|investigate.{0,20}(market|space|company|product)|find out (about|how)|what do (people|users|customers)|market size|landscape|competitors?)\b/,
      /\b(who (is|are|does)|what (is|are) the (best|top|leading)|how does .+ work)\b/,
    ],
    skill: '/browse → analyze → synthesize',
    label: 'Researching the market',
    agents: ['researcher'],
  },

  {
    id: 'strategy',
    patterns: [
      /\b(strategy|strategic|positioning|go.?to.?market|gtm|market fit|product.?market fit|competitive advantage|moat|differentiat|business model|revenue model|pricing strategy)\b/,
      /\b(how do we win|how do we grow|what.s the play|the right move|big picture|long term)\b/,
    ],
    skill: '/plan-ceo-review → /office-hours',
    label: 'Thinking through the strategy',
    agents: ['advisor', 'strategist', 'researcher'],
  },

  {
    id: 'pitch',
    patterns: [
      /\b(pitch|investor|pitch deck|demo day|cold email.{0,20}(investor|vc|fund)|fundraising deck|one.?pager)\b/,
      /\b(tell the story of|narrative for|how do we sell this)\b/,
    ],
    skill: '/office-hours → /design-consultation → build → /review',
    label: 'Building your pitch',
    agents: ['advisor', 'researcher', 'writer'],
  },

  {
    id: 'fundraise',
    patterns: [
      /\b(fundraise|raise (money|a round|seed|series [abcd]|pre.?seed)|term sheet|valuation|dilution|cap table|safe note|convertible)\b/,
      /\b(talking to vcs?|investor (meeting|call|outreach)|how to raise)\b/,
    ],
    skill: '/office-hours → research → draft → /review',
    label: 'Preparing to raise',
    agents: ['advisor', 'researcher', 'writer'],
  },

  {
    id: 'hire',
    patterns: [
      /\b(hire|hiring|first (hire|employee|eng|designer)|job description|interview (process|question)|equity (split|offer)|cofounder|co.?founder|who should (i|we) hire|build.{0,10}team)\b/,
    ],
    skill: '/office-hours → draft → /review',
    label: 'Helping you build the team',
    agents: ['advisor', 'researcher'],
  },

  // ── DEV LAYER (unchanged from v1) ────────────────────────────────────────

  {
    id: 'web-browse',
    patterns: [/\bgo to\b/, /\bbrowse\b/, /https?:\/\//, /\bnavigate to\b/],
    skill: '/browse [url]',
    label: 'Opening the page',
  },

  {
    id: 'e2e-testing',
    patterns: [
      /\bplaywright\b/i,
      /\b(e2e|end.to.end|browser test|ui test|integration test)\b/i,
      /\b(automate.{0,15}browser|open.{0,10}browser|take screenshot)\b/i,
      /\b(test.{0,20}(app|page|ui|flow|site|form))\b/i,
      /\b(write.{0,10}test|run.{0,10}test|add.{0,10}test|spec\.ts|\.spec\.)\b/i,
      /\b(click.{0,20}button|fill.{0,20}form|screenshot|visual check)\b/i,
    ],
    skill: 'npx playwright test → agent-browser for long flows',
    label: 'Testing with Playwright',
    agents: ['tester', 'coder', 'reviewer'],
  },

  {
    id: 'new-feature',
    patterns: [
      /\b(build|create|make|implement|add|develop)\b.{0,30}\b(feature|component|page|api|endpoint|module|system)\b/,
      /\bnew feature\b/,
    ],
    skill: '/office-hours → /plan-eng-review → build → /review → /qa → /cso → /ship',
    label: 'Building something new',
    agents: ['planner', 'coder', 'reviewer', 'tester'],
  },

  {
    id: 'refactor',
    patterns: [/\b(refactor|rewrite|cleanup|clean up|restructure|modernize)\b/],
    skill: '/investigate → refactor → /review → /qa',
    label: 'Cleaning up the code',
    agents: ['researcher', 'coder', 'reviewer', 'tester'],
  },

  {
    id: 'bug-fix',
    patterns: [/\b(fix|debug|broken|crash|error|fail|issue|bug|not working|doesn.t work)\b/],
    skill: '/investigate → fix → /review → /qa',
    label: 'Fixing the problem',
    agents: ['researcher', 'coder', 'tester'],
  },

  {
    id: 'code-review',
    patterns: [/\b(review|audit|check|inspect).{0,20}\bcode\b/, /\bcode review\b/],
    skill: '/review → /cso',
    label: 'Reviewing the code',
    agents: ['reviewer', 'security-auditor'],
  },

  {
    id: 'security',
    patterns: [/\b(security|vulnerability|owasp|threat|exploit|xss|csrf|pentest)\b/],
    skill: '/cso',
    label: 'Security check',
    agents: ['security-auditor', 'reviewer', 'researcher'],
  },

  {
    id: 'deploy-ship',
    patterns: [/\b(deploy|ship|release|push to prod|go live|pull request)\b/],
    skill: '/review → /qa → /cso → /ship → /land-and-deploy → /canary',
    label: 'Deploying',
    agents: ['coder', 'tester', 'reviewer'],
  },

  {
    id: 'performance',
    patterns: [/\b(performance|slow|optimize|benchmark|speed|latency|bottleneck|faster)\b/],
    skill: '/benchmark → optimize → /review',
    label: 'Making it faster',
    agents: ['performance-engineer', 'coder', 'reviewer'],
  },

  {
    id: 'design',
    patterns: [/\b(design|ui|ux|component|css|layout|figma|tailwind|shadcn|dark mode|theme|dashboard)\b/],
    skill: '/design-consultation → build → /design-review → /qa → /ship',
    label: 'Designing the UI',
    agents: ['coder', 'reviewer'],
  },

  {
    id: 'documentation',
    patterns: [/\b(docs|document|readme|changelog|api docs)\b/],
    skill: '/document-release',
    label: 'Writing the docs',
  },

  {
    id: 'swarm',
    patterns: [/\b(swarm|parallel|multiple agents|concurrent|spawn agents)\b/],
    skill: 'swarm init --topology hierarchical',
    label: 'Big parallel task',
    agents: ['planner', 'coder', 'reviewer', 'tester', 'researcher'],
  },

  {
    id: 'memory',
    patterns: [/\b(remember|past|history|previous session|last time|we built)\b/],
    skill: 'memory search',
    label: 'Pulling up past context',
  },

  {
    id: 'planning',
    patterns: [/\b(plan|sprint|roadmap|architecture decision)\b/],
    skill: '/office-hours → /plan-ceo-review → /plan-eng-review',
    label: 'Planning the work',
    agents: ['planner', 'researcher'],
  },

  {
    id: 'monitor',
    patterns: [/\b(monitor|canary|post.deploy|health check|is it up)\b/],
    skill: '/canary',
    label: 'Monitoring',
  },

  {
    id: 'retro',
    patterns: [/\b(retro|retrospective|reflect|lessons learned|review sprint)\b/],
    skill: '/retro',
    label: 'Running the retro',
  },

  {
    id: 'autoplan',
    patterns: [/\b(autoplan|full pipeline|run everything|automated review)\b/],
    skill: '/autoplan',
    label: 'Full automated pipeline',
    agents: ['planner', 'coder', 'reviewer', 'tester', 'security-auditor'],
  },

  {
    id: 'investigate',
    patterns: [
      /\b(why|how does|explain|understand|investigate|diagnose|figure out|isn.t working|aren.t working)\b/,
      /\b(how (does|do|is|are)|what causes|root cause)\b/,
    ],
    skill: '/investigate → explain + fix',
    label: 'Investigating the issue',
    agents: ['researcher', 'coder'],
  },
];

// ── Prompt enrichment — production context the user didn't ask for ─────────
const ENRICHMENTS = {
  'new-feature': [
    'input validation at all boundaries',
    'error states (network failure, invalid input, timeout, empty)',
    'loading/skeleton states',
    'responsive design (mobile-first)',
    'accessibility (ARIA, keyboard nav)',
    'E2E tests with Playwright',
    'edge cases and overflow handling',
  ],
  'bug-fix': [
    'root cause analysis before patching',
    'regression test that catches this exact bug',
    'check for same pattern in related code',
    'verify fix handles edge cases',
  ],
  'deploy-ship': [
    'pre-deploy smoke test',
    'rollback plan if deploy fails',
    'post-deploy canary monitoring',
    'verify zero-downtime',
  ],
  design: [
    'mobile-first responsive',
    'dark mode support',
    'loading/empty/error/overflow states',
    'accessibility (WCAG 2.1 AA)',
    'visual regression test',
  ],
  'e2e-testing': [
    'happy path + error paths + edge cases',
    'mobile viewport testing',
    'form validation testing',
    'cross-browser (chromium + firefox)',
  ],
  refactor: [
    'preserve all existing behavior',
    'add/update tests to cover refactored code',
    'benchmark before and after for performance',
  ],
  security: [
    'OWASP Top 10 check',
    'STRIDE threat model',
    'input sanitization audit',
    'auth/session handling review',
  ],
  'code-review': [
    'security implications',
    'performance impact',
    'test coverage gaps',
    'edge cases missed',
  ],
  performance: [
    'baseline measurement before changes',
    'identify actual bottleneck (profile, don\'t guess)',
    'test with realistic data volume',
    'check for N+1 queries and memory leaks',
  ],
  investigate: [
    'reproduce the issue first',
    'check logs and error traces',
    'narrow scope before patching',
    'verify the fix doesn\'t mask the real problem',
  ],
  'brain-dump': [
    'extract actionable decisions',
    'identify blockers and dependencies',
    'prioritize by impact vs effort',
  ],
  strategy: [
    'competitive landscape',
    'distribution channel strategy',
    'unit economics check',
    'go-to-market timeline',
  ],
  pitch: [
    'problem/solution clarity',
    'market size evidence',
    'traction metrics',
    'why now, why you',
  ],
  fundraise: [
    'round size and use of funds',
    'key metrics investors will ask about',
    'comparable raises in this space',
  ],
  research: [
    'primary vs secondary sources',
    'verify claims with data',
    'identify conflicting evidence',
  ],
};

// ── Tool recommendations — CLI first, MCP only when necessary ────────────────
// Priority: 1) gstack skill  2) CLI tool via Bash  3) Playwright CLI  4) MCP (last resort)
const TOOL_RECS = {
  'new-feature': [
    'gstack: /office-hours → /plan-eng-review → build → /review → /qa → /cso → /ship',
    'playwright CLI: npx playwright test for E2E tests',
    'mcp__supabase__: backend, auth, storage, RLS policies',
    'mcp__shadcn__: UI component library (check registry first)',
    'mcp__context7__: latest framework docs before coding',
    'mcp__figma__: read Figma designs if mockups exist',
    'sequential-thinking: plan complex architecture step-by-step',
  ],
  'bug-fix': [
    'gstack: /investigate → fix → /review → /qa',
    'playwright CLI: npx playwright test to reproduce in real browser',
    'mcp__sentry__: pull error traces, stack traces, affected users',
    'mcp__context7__: check if it is a known framework issue',
  ],
  design: [
    'gstack: /design-consultation → build → /design-review → /qa → /ship',
    'mcp__figma__: read Figma designs → generate matching code',
    'mcp__shadcn__: component library + audit checklist',
    'mcp__magicuidesign-mcp__: animated/interactive components',
    'playwright CLI: npx playwright test for visual regression + responsive',
  ],
  'deploy-ship': [
    'gstack: /review → /qa → /cso → /ship → /land-and-deploy → /canary',
    'mcp__github__: PR creation, branch management, release',
    'mcp__sentry__: verify no new errors after deploy',
  ],
  'e2e-testing': [
    'playwright CLI: npx playwright test for all browser testing',
    'agent-browser: for long automation chains (10+ steps, 5.7x token savings)',
    'gstack: /qa for full QA workflow with bug fixes',
  ],
  security: [
    'gstack: /cso for OWASP Top 10 + STRIDE audit',
    'mcp__supabase__: check RLS policies, auth config, exposed keys',
    'sequential-thinking: systematic threat model analysis',
  ],
  performance: [
    'gstack: /benchmark for baseline measurement',
    'playwright CLI: npx playwright test for Core Web Vitals + profiling',
  ],
  'code-review': [
    'gstack: /review for comprehensive code review',
    'gstack: /cso for security implications',
    'mcp__sentry__: check if reviewed code has prior error history',
  ],
  refactor: [
    'gstack: /review → /qa after refactoring',
    'playwright CLI: npx playwright test for regression verification',
    'mcp__context7__: check framework best practices',
    'sequential-thinking: plan refactoring steps to avoid breakage',
  ],
  investigate: [
    'gstack: /investigate for systematic root-cause debugging',
    'mcp__sentry__: pull error traces, spans, breadcrumbs',
    'playwright CLI: npx playwright test to reproduce if UI-related',
    'mcp__context7__: check framework docs for known issues',
    'sequential-thinking: structured reasoning for complex bugs',
  ],
  'web-browse': [
    'gstack: /browse for fast web research',
    'agent-browser: for interactive browsing with low token cost',
    'mcp__firecrawl__: extract clean data from any URL',
  ],
  'brain-dump': [
    'gstack: extract decisions → prioritize → structure',
    'sequential-thinking: organize thoughts step-by-step',
  ],
  strategy: [
    'gstack: /office-hours for strategic review',
    'mcp__firecrawl__: scrape competitor pages, market data',
    'mcp__context7__: technology landscape research',
  ],
  pitch: [
    'gstack: /office-hours for pitch structure and feedback',
    'mcp__firecrawl__: pull market data, comparable companies',
  ],
  research: [
    'mcp__context7__: technical docs and framework references',
    'mcp__firecrawl__: extract structured data from any source',
    'gstack: /browse for web research',
  ],
  // Automation tasks route to n8n
  planning: [
    'gstack: /office-hours → /plan-ceo-review → /plan-eng-review',
    'sequential-thinking: structured planning with revision',
    'mcp__n8n__: automate recurring workflows',
  ],
};

// Entrepreneur tasks get a cleaner label style
const ENTREPRENEUR_TASKS = new Set([
  'brain-dump', 'write-content', 'brainstorm', 'decide',
  'research', 'strategy', 'pitch', 'fundraise', 'hire',
]);

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  let promptText = '';
  try {
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString().trim();
      if (raw) {
        try { const p = JSON.parse(raw); promptText = p.prompt || p.user_prompt || ''; }
        catch { promptText = raw; }
      }
    }
  } catch { /* non-blocking */ }

  if (!promptText) promptText = process.argv[2] || '';
  const prompt = promptText.toLowerCase().trim();
  if (!prompt || prompt.length < 3) process.exit(0);

  // Pure questions (no action verb) pass through silently
  const normalized = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ACTION_VERBS = /\b(fix|build|create|implement|refactor|deploy|review|audit|investigate|optimize|add|make|write|run|install|update|delete|remove|research|hire|draft|pitch|brainstorm|decide|strategize)\b/;
  // Entrepreneur questions are action-requests even when phrased as "what/how/should"
  const ENTREPRENEUR_INTENT = /\b(strategy|go.?to.?market|gtm|positioning|competitive|business model|revenue|pricing|fundrais|pitch|investor|market fit|roadmap|prioritize|should (we|i) (build|launch|raise|hire|pivot|focus)|what.s the (best|right) (way|move|approach)|how (do|should) (we|i) (grow|scale|win|differentiate))\b/i;
  const isQuestion =
    /^(is |are |was |were |has |have |does |do |did |can |could |would |should |what |why |how |when |where |who |describe |explain |tell me|give me)/i.test(normalized.trim()) &&
    !ACTION_VERBS.test(normalized) &&
    !ENTREPRENEUR_INTENT.test(prompt);
  const INVESTIGATION_INTENT = /\b(how does|how do|how is|how are|what causes|what happens|why does|why is|why are|where is|where does)\b.*\b(work|fail|break|crash|error|happen|run|execute|function|behave|connect|interact)\b/i;
  if (isQuestion && !INVESTIGATION_INTENT.test(prompt)) process.exit(0);

  // Match rules
  const matches = RULES
    .map(r => ({ ...r, hits: r.patterns.filter(p => p.test(prompt)).length }))
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (matches.length === 0) process.exit(0);

  const primary         = matches[0];
  let   complexity      = matches.reduce((max, m) => Math.max(max, COMPLEXITY[m.id] || 50), 0);

  // Gap 3: context-aware complexity boost ─────────────────────────────────
  try {
    const slug    = process.cwd().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(-50);
    const ctxFile = join(homedir(), '.auramxing', 'contexts', `${slug}.md`);
    if (existsSync(ctxFile)) {
      const { size } = statSync(ctxFile);
      if (size < 512 * 1024) { // skip files > 512 KB to avoid memory/perf issues
        const ctx = readFileSync(ctxFile, 'utf8').toLowerCase();
        if (ctx.includes(primary.id))  complexity = Math.min(85, complexity + 15); // seen before
        if (ctx.length > 2000)         complexity = Math.min(85, complexity + 5);  // big project
      }
    }
  } catch {}

  if (complexity < 3) process.exit(0);  // only truly empty tasks skip — Aura routes everything

  const tier           = complexity < 30 ? 'HAIKU' : complexity < 65 ? 'SONNET' : 'OPUS';
  const isEntrepreneur = ENTREPRENEUR_TASKS.has(primary.id);

  // Gap 1: write current-task.json for completion diagram ──────────────────
  try {
    const taskDir = join(homedir(), '.auramxing');
    if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'current-task.json'),
      JSON.stringify({ id: primary.id, label: primary.label, ts: new Date().toISOString() }));
  } catch {}

  // Version check — synchronous, BLOCKS before routing (same pattern as gstack preamble)
  // Cache-backed: 60min TTL for UP_TO_DATE, so this is instant after first check
  try {
    const checkScript = join(homedir(), 'auramxing', 'scripts', 'update-check.sh');
    if (existsSync(checkScript)) {
      const result = execSync(`bash "${checkScript}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
      if (result.startsWith('UPGRADE_AVAILABLE')) {
        const [, local, remote] = result.split(' ');
        // Inject blocking update directive — Claude MUST use AskUserQuestion before proceeding
        process.stdout.write([
          `[AURAMXING UPDATE]`,
          `AURAMXING v${remote} is available (you are on v${local}).`,
          `BEFORE doing anything else — before routing, before answering — use the AskUserQuestion tool:`,
          `  question: "AURAMXING v${remote} is available (you're on v${local}). Update now?"`,
          `  options: ["Yes, upgrade now (recommended)", "Not now"]`,
          `If "Yes": run this via Bash tool: cd ~/auramxing && git pull && bash install.sh`,
          `  Then say "AURAMXING updated to v${remote}" and continue with the user's original request.`,
          `If "Not now": write snooze: echo "${remote} 1 $(date +%s)" > ~/.auramxing/update-snoozed`,
          `  Then continue with the user's request normally.`,
          `DO NOT skip this. DO NOT proceed without asking. This is a blocking update check.`,
          `[/AURAMXING UPDATE]`,
        ].join('\n') + '\n');
      }
    }
  } catch {}

  // Spin up Ruflo swarm for complex tasks
  if (complexity >= 50 && primary.agents?.length) {
    try {
      const nodeBin = dirname(process.execPath);
      let nvmBin = '';
      try { const v = readFileSync(join(homedir(), '.nvm', 'alias', 'default'), 'utf8').trim().replace(/^v/, ''); nvmBin = join(homedir(), '.nvm', 'versions', 'node', `v${v}`, 'bin'); } catch {}
      const PATH = [nodeBin, nvmBin, '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].filter(Boolean).join(':');
      spawn('npx', ['ruflo@latest', 'swarm', 'init', '--topology', 'hierarchical', '--max-agents', '8', '--strategy', 'specialized'],
        { cwd: process.cwd(), detached: true, stdio: 'ignore', env: { ...process.env, PATH } }).unref();
      try {
        const metricsDir = join(process.cwd(), '.claude-flow', 'metrics');
        if (!existsSync(metricsDir)) mkdirSync(metricsDir, { recursive: true });
        const agents = (primary.agents || []).map((type, i) => ({
          id: `${type}-${Date.now()}-${i}`, type, status: 'spawning', startedAt: new Date().toISOString(),
        }));
        writeFileSync(join(metricsDir, 'swarm-activity.json'), JSON.stringify({
          swarm: { active: true, agent_count: agents.length, topology: 'hierarchical', task: promptText.slice(0, 80), agents },
          ts: new Date().toISOString(),
        }, null, 2));
      } catch { /* non-blocking */ }
    } catch { /* non-blocking */ }
  }

  // ── Prompt Engine: enrich via NotebookLM-style structuring + LightRAG memory
  try {
    const engineScript = join(homedir(), 'auramxing', 'helpers', 'prompt-engine.mjs');
    if (existsSync(engineScript)) {
      const enriched = execSync(`node "${engineScript}" 2>/dev/null`, {
        input: JSON.stringify({ prompt: promptText, cwd: process.cwd() }),
        encoding: 'utf8', timeout: 3000,
      }).trim();
      if (enriched) process.stdout.write(enriched + '\n');
    }
  } catch {}

  // ── Compact loading bar → user sees this in chat ─────────────────────────
  const C  = isEntrepreneur ? '\x1b[35m' : '\x1b[36m';
  const R  = '\x1b[0m';
  const D  = '\x1b[2m';
  const B  = '\x1b[1m';

  // Terminal display (stderr — always visible in terminal)
  process.stderr.write(`\n ${C}▸ Aura${R}  ${B}${primary.label}${R}  ${D}· ${tier} · ${complexity}%${R}\n\n`);

  // Chat display — compact loading bar (Claude renders this verbatim)
  const loadBar = [
    `▸ Aura · ${primary.label} · ${tier}`,
  ].join('\n');
  process.stdout.write(`[AURAMXING DISPLAY]\n${loadBar}\n[/AURAMXING DISPLAY]\n`);

  // ── Directives → Claude reads but does NOT render ─────────────────────────
  // Try compressed enrichments first (pre-computed by pipeline), fall back to static
  const enrichItems = ENRICHMENTS[primary.id] || [];
  let enrichLine = '';
  try {
    const compressedPath = join(homedir(), '.auramxing', 'prompt-cache', 'enrichments-compressed.json');
    if (existsSync(compressedPath)) {
      const age = Date.now() - statSync(compressedPath).mtimeMs;
      if (age < 86400000) { // 24hr TTL
        const compressed = JSON.parse(readFileSync(compressedPath, 'utf8'));
        if (compressed[primary.id]) {
          enrichLine = `ENRICH: ${compressed[primary.id]}`;
        }
      }
    }
  } catch {}
  if (!enrichLine && enrichItems.length) {
    enrichLine = `ENRICH: production-ready — ${enrichItems.join(', ')}`;
  }

  const toolItems = TOOL_RECS[primary.id] || [];
  const toolsLine = toolItems.length
    ? `TOOLS: ${toolItems.join(' | ')}`
    : '';

  const directives = [];
  if (complexity >= 50 && primary.agents?.length) {
    const agentList = (primary.agents || []).join(', ');
    directives.push(`task:${primary.id} model:${tier} complexity:${complexity}%`);
    directives.push(`EXECUTE: ${primary.skill}`);
    directives.push(`SPAWN: ${agentList} — parallel via Task tool, run_in_background:true, ALL in ONE message`);
    // Full autopilot: chain all steps without waiting for user input
    const steps = primary.skill.split('→').map(s => s.trim()).filter(Boolean);
    if (steps.length >= 2) {
      directives.push(`AUTOCHAIN: Execute ALL steps in sequence automatically. Do NOT wait for user input between steps. Complete the full chain: ${steps.join(' → ')}. Report results only after ALL steps finish.`);
    }
    // Deep thinking mode: delegate complex reasoning to structured approach
    if (complexity >= 50) {
      directives.push(`THINK: This is a ${complexity}% complexity task. Before writing ANY code: 1) Read all relevant files completely 2) Map the full dependency chain 3) Identify every edge case 4) Plan the minimal change set. Do NOT start coding until you can explain the full approach.`);
    }
  } else {
    directives.push(`task:${primary.id} model:${tier} → ${primary.skill}`);
  }
  if (enrichLine) directives.push(enrichLine);
  if (toolsLine)  directives.push(toolsLine);

  // Inject task-specific CLAUDE.md segment if available
  let claudemdSegment = '';
  try {
    const segPath = join(homedir(), '.auramxing', 'prompt-cache', `claudemd-${primary.id}.txt`);
    if (existsSync(segPath)) {
      const age = Date.now() - statSync(segPath).mtimeMs;
      if (age < 86400000) {
        claudemdSegment = readFileSync(segPath, 'utf8').trim();
      }
    }
  } catch {}
  if (claudemdSegment) {
    directives.push(`CONTEXT: ${claudemdSegment.slice(0, 500)}`);
  }

  process.stdout.write(`[AURAMXING DIRECTIVE]\n${directives.join('\n')}\n[/AURAMXING DIRECTIVE]\n`);

  process.exit(0);
}

main().catch(() => process.exit(0));
