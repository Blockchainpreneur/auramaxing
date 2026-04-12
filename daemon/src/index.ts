import { serve } from "bun";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME || "/Users/macbook";
const STATE_DIR = join(HOME, ".auramaxing");
const STATE_FILE = join(STATE_DIR, "state.json");
const CONTEXTS_DIR = join(STATE_DIR, "contexts");
const CODE_DIR = join(HOME, "code");
const PORT = 57821;

interface Project {
  name: string;
  stack: string;
  path: string;
  cost_today: number;
  last_active: string;
}

interface Session {
  projectPath: string;
  start: string;
  end?: string;
  summary?: string;
}

interface ToolEvent {
  tool: string;
  cwd: string;
  success?: boolean;
  timestamp: string;
}

interface State {
  projects: Project[];
  sessions: Session[];
  toolEvents: ToolEvent[];
}

// Ensure directories exist
mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(CONTEXTS_DIR, { recursive: true });

function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    return { projects: [], sessions: [], toolEvents: [] };
  }
  try {
    const raw = Bun.file(STATE_FILE).textSync();
    return JSON.parse(raw) as State;
  } catch {
    return { projects: [], sessions: [], toolEvents: [] };
  }
}

async function saveState(state: State): Promise<void> {
  const tmp = STATE_FILE + ".tmp." + Date.now();
  await Bun.write(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function parseStackFromClaude(content: string): string {
  const match = content.match(/## Stack\s*\n([^\n#]+)/);
  if (match) return match[1].trim();
  return "Unknown";
}

async function discoverProjects(state: State): Promise<Project[]> {
  const existing = new Set(state.projects.map((p) => p.path));
  const discovered: Project[] = [];

  try {
    const glob = new Bun.Glob("*/CLAUDE.md");
    for await (const file of glob.scan({ cwd: CODE_DIR, onlyFiles: true })) {
      const fullPath = join(CODE_DIR, file.replace("/CLAUDE.md", ""));
      if (existing.has(fullPath)) continue;
      try {
        const content = await Bun.file(join(CODE_DIR, file)).text();
        const stack = parseStackFromClaude(content);
        const name = fullPath.split("/").pop() || fullPath;
        discovered.push({
          name,
          stack,
          path: fullPath,
          cost_today: 0,
          last_active: new Date().toISOString(),
        });
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // CODE_DIR may not exist
  }

  return discovered;
}

function countActiveSessions(state: State): number {
  return state.sessions.filter((s) => !s.end).length;
}

function findProjectByPath(state: State, cwd: string): Project | undefined {
  return state.projects.find((p) => p.path === cwd);
}

function getLastSessionSummary(state: State, projectPath: string): string | undefined {
  const sessions = state.sessions
    .filter((s) => s.projectPath === projectPath && s.summary)
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  return sessions[0]?.summary;
}

async function writeContextFile(project: Project, summary: string | undefined): Promise<void> {
  const slug = slugify(project.name);
  const contextPath = join(CONTEXTS_DIR, `${slug}.md`);
  const lastSession = summary || "First session — no prior context.";
  const content = `# AURAMAXING Context — ${project.name}
Last session: ${new Date().toISOString().split("T")[0]}
${lastSession}
`;
  await Bun.write(contextPath, content);
}

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        return Response.json({ ok: true }, { headers });
      }

      // GET /status
      if (method === "GET" && path === "/status") {
        const state = loadState();
        const rufloCheck = Bun.spawnSync(["pgrep", "-f", "ruflo"], { stdout: "pipe", stderr: "pipe" });
        return Response.json(
          {
            ok: true,
            projects: state.projects.length,
            activeSessions: countActiveSessions(state),
            rufloRunning: rufloCheck.exitCode === 0,
          },
          { headers }
        );
      }

      // GET /projects
      if (method === "GET" && path === "/projects") {
        const state = loadState();
        const discovered = await discoverProjects(state);
        const all = [...state.projects, ...discovered];
        return Response.json(all, { headers });
      }

      // POST /projects
      if (method === "POST" && path === "/projects") {
        const body = (await req.json()) as { name: string; stack: string; path: string };
        if (!body.name || !body.path) {
          return Response.json({ error: "name and path required" }, { status: 400, headers });
        }
        const state = loadState();
        const existing = state.projects.findIndex((p) => p.path === body.path);
        const project: Project = {
          name: body.name,
          stack: body.stack || "TypeScript",
          path: body.path,
          cost_today: 0,
          last_active: new Date().toISOString(),
        };
        if (existing >= 0) {
          state.projects[existing] = { ...state.projects[existing], ...project };
        } else {
          state.projects.push(project);
        }
        await saveState(state);
        return Response.json({ ok: true, project }, { headers });
      }

      // POST /session/start
      if (method === "POST" && path === "/session/start") {
        const body = (await req.json()) as { cwd: string };
        if (!body.cwd) {
          return Response.json({ error: "cwd required" }, { status: 400, headers });
        }
        const state = loadState();
        const project = findProjectByPath(state, body.cwd);
        const session: Session = {
          projectPath: body.cwd,
          start: new Date().toISOString(),
        };
        state.sessions.push(session);
        await saveState(state);

        if (project) {
          const lastSummary = getLastSessionSummary(state, body.cwd);
          await writeContextFile(project, lastSummary);
          // Also write to project's .claude directory
          const projectContextDir = join(body.cwd, ".claude");
          mkdirSync(projectContextDir, { recursive: true });
          const lastSession = lastSummary || "First session — no prior context.";
          await Bun.write(
            join(projectContextDir, "context.md"),
            `# AURAMAXING Context — ${project.name}\nLast session: ${new Date().toISOString().split("T")[0]}\n${lastSession}\n`
          );
        }

        return Response.json({ ok: true, sessionStarted: session.start }, { headers });
      }

      // POST /session/end
      if (method === "POST" && path === "/session/end") {
        const body = (await req.json()) as { cwd: string; summary?: string };
        if (!body.cwd) {
          return Response.json({ error: "cwd required" }, { status: 400, headers });
        }
        const state = loadState();
        // Find the most recent open session for this path
        const sessionIdx = state.sessions
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.projectPath === body.cwd && !s.end)
          .sort((a, b) => new Date(b.s.start).getTime() - new Date(a.s.start).getTime())[0]?.i;

        if (sessionIdx !== undefined) {
          state.sessions[sessionIdx].end = new Date().toISOString();
          if (body.summary) {
            state.sessions[sessionIdx].summary = body.summary;
          }
        } else {
          // Create a closed session entry
          state.sessions.push({
            projectPath: body.cwd,
            start: new Date().toISOString(),
            end: new Date().toISOString(),
            summary: body.summary,
          });
        }
        await saveState(state);
        return Response.json({ ok: true }, { headers });
      }

      // POST /tool-event
      if (method === "POST" && path === "/tool-event") {
        const body = (await req.json()) as { tool: string; cwd: string; success?: boolean };
        const state = loadState();
        state.toolEvents.push({
          tool: body.tool || "unknown",
          cwd: body.cwd || "",
          success: body.success,
          timestamp: new Date().toISOString(),
        });
        // Keep last 1000 events to prevent unbounded growth
        if (state.toolEvents.length > 1000) {
          state.toolEvents = state.toolEvents.slice(-1000);
        }
        await saveState(state);
        return Response.json({ ok: true }, { headers });
      }

      // GET /context?cwd=PATH
      if (method === "GET" && path === "/context") {
        const cwd = url.searchParams.get("cwd");
        if (!cwd) {
          return Response.json({ error: "cwd required" }, { status: 400, headers });
        }
        const state = loadState();
        const project = findProjectByPath(state, cwd);
        if (!project) {
          return Response.json({ context: null }, { headers });
        }
        const lastSummary = getLastSessionSummary(state, cwd);
        const lastSession = lastSummary || "First session — no prior context.";
        const context = `# AURAMAXING Context — ${project.name}\nLast session: ${new Date().toISOString().split("T")[0]}\n${lastSession}\n`;
        return Response.json({ context }, { headers });
      }

      return Response.json({ error: "Not found" }, { status: 404, headers });
    } catch (err) {
      return Response.json(
        { error: "Internal error", details: String(err) },
        { status: 500, headers }
      );
    }
  },
});

console.log(`AURAMAXING daemon running on http://localhost:${PORT}`);
