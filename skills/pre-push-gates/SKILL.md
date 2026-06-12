---
name: pre-push-gates
description: Run the local quality-gate pipeline BEFORE any push, and triage its classic failures. Use before pushing to any TS/Next.js repo, when CI fails after a push, when seeing "Module not found: Can't resolve 'fs'/'net'/'tls'" in a Next build, "Property X does not exist on type 'PrismaClient'", "tests pass locally but fail in CI", or React rules-of-hooks errors. Distilled from the MyGMV/saas-main CI guide (~/Downloads/code-quality.md) and generalized for all AURAMAXING Next.js/TS projects (econ, funnel, expert, trendlab, polymaxxing).
---

# Pre-push gates — local pipeline + failure recipes

**Principle:** CI is the slow safety net (4-7 min); the local pipeline is the fast one
(<2 min). Run gates **fast → slow** and stop at the first red:

```bash
<pm> lint          # ~10s — syntax/hooks/a11y
<pm> typecheck     # ~30s — tsc --noEmit, whole-graph types
<pm> test:unit     # ~15s — vitest/node:test unit+route tests
<pm> build         # ~60s — the ONLY gate that catches server/client import leaks
```

(`<pm>` = the repo's package manager: `corepack yarn` / `pnpm` / `npm run` / `bun run`.
Check `package.json` scripts first — never guess script names.) All 4 must exit 0
before pushing. Lint+typecheck catch most; **build is NOT optional in Next.js**.

## Recipe 1 — "Module not found: Can't resolve 'fs'" (or net/tls/crypto) in next build

Server-only module imported **transitively** from a client component. Lint and tsc
CANNOT see this — only the build can. Walk the trace from the client component upward;
one library in the chain imports prisma/fs/bcrypt/etc.

Fixes (in order of preference): delete the dead server-only export if unused → split
the library (`time.ts` keeps pure helpers, `time-server.ts` gets the DB/fs code) →
remove the import from the chain.

**Habit:** run `build` before pushing ANY change touching `src/lib/*` or adding an
import to a file reachable from a `"use client"` page.

## Recipe 2 — "Property 'X' does not exist on type 'PrismaClient'"

Stale generated client. Run the repo's `prisma:generate` script after every schema
change, then re-typecheck. Still broken → the model isn't in `prisma/schema.prisma`.
Gotcha: compound unique keys get awkward names (`creator_username_date`) — look up the
real `WhereUniqueInput` key in `node_modules/.prisma/client/index.d.ts`, don't guess.

## Recipe 3 — Vitest mocking modules imported by the file under test

`vi.hoisted()` + top-level `vi.mock()` is the ONLY pattern that works (mocks inside
`beforeEach` do NOT):

```ts
const { getServerSession, fooFindUnique } = vi.hoisted(() => ({
  getServerSession: vi.fn(), fooFindUnique: vi.fn(),
}));
vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: { foo: { findUnique: fooFindUnique } } }));
import { GET } from "@/app/api/foo/route";   // import AFTER the mocks
```

Iterate on one file with `vitest run <path>` directly (yarn `--` passthrough is flaky).

## Recipe 4 — Tests pass locally but fail in CI (the triage triad)

Almost always one of, in this order:
1. **Env var** read locally but unset in CI → mock/pin it at the top of the test.
2. **Wall-clock dependence** → inject `now` as a parameter instead of calling Date
   inside the logic.
3. **Timezone assumption** → pin it: `process.env.TZ = "Europe/Madrid"` (or the repo's
   TZ) at the top of the test.

## Recipe 5 — Lint hygiene conventions

- Rules-of-hooks error: a hook after an early `return` — hoist it above; it runs every
  render, that's the rule.
- Targeted disables MUST carry the reason after `--`:
  `// eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time init from URL param; refactor later`
- Unused `eslint-disable` directives → delete them (lint flags them).
- Next.js route params are now `Promise<{ slug: string }>` — `await` them.

## Integration with the loop

This skill IS Phase 05 (TEST) discipline for TS/Next repos: the gatekeeper requires a
PASSING verification — this pipeline is what you run to produce it. Quote the real
output (zero-tolerance: a claim without run output is false). A failed local gate
costs ~30s; a failed CI push costs ~5 min — never push red.
