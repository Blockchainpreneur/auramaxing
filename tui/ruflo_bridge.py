"""
ruflo_bridge.py — Polls Ruflo daemon and maps agents to kanban columns.
"""
import asyncio
import json
import subprocess
import re
import time
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field


COLUMN_KEYWORDS = {
    "Thinking":   re.compile(r"analyz|plan|think|evaluat|assess|investigat|research", re.I),
    "Designing":  re.compile(r"design|layout|ui|style|architect|schema|model|struct", re.I),
    "Developing": re.compile(r"implement|build|write|creat|code|generat|scaffold|develop", re.I),
    "Testing":    re.compile(r"test|check|verif|validat|assert|spec|lint|debug", re.I),
    "Reviewing":  re.compile(r"review|audit|inspect|analyz.*code|read|scan", re.I),
    "Deploying":  re.compile(r"deploy|publish|push|release|ship|upload|migrat", re.I),
    "Done":       re.compile(r"complet|done|finish|success|✓|ok$", re.I),
}


@dataclass
class AgentState:
    id: str
    name: str
    status: str = "idle"        # idle | thinking | working | done | error
    task: str = ""
    column: str = "Thinking"
    progress: int = 0
    elapsed_sec: int = 0
    cost_usd: float = 0.0
    tool_calls: int = 0
    log_lines: list = field(default_factory=list)
    spawned_at: float = field(default_factory=time.time)


def detect_column(task: str) -> str:
    for column, pattern in COLUMN_KEYWORDS.items():
        if pattern.search(task):
            return column
    return "Developing"


def estimate_progress(agent: AgentState) -> int:
    """Rough % based on time in column + tool call count."""
    if agent.status == "done":
        return 100
    if agent.status == "idle":
        return 0
    base = min(agent.tool_calls * 8, 70)
    time_factor = min(int(agent.elapsed_sec / 3), 25)
    return min(base + time_factor, 95)


class RufloBridge:
    def __init__(self, project_dir: str = "."):
        self.project_dir = Path(project_dir)
        self.agents: dict[str, AgentState] = {}
        self.memory_entries: list[str] = []
        self.daemon_running: bool = False
        self.last_poll: float = 0.0
        self.session_tokens: int = 0
        self.session_cost: float = 0.0
        self._poll_task: Optional[asyncio.Task] = None

    async def ensure_daemon(self) -> bool:
        """Start Ruflo daemon if not running."""
        try:
            result = await asyncio.create_subprocess_exec(
                "npx", "ruflo@latest", "daemon", "status",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(result.communicate(), timeout=5)
            if b"running" in stdout.lower() or b"active" in stdout.lower():
                self.daemon_running = True
                return True
        except Exception:
            pass

        # Try to start
        try:
            subprocess.Popen(
                ["npx", "ruflo@latest", "daemon", "start"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            await asyncio.sleep(2)
            self.daemon_running = True
            return True
        except Exception:
            self.daemon_running = False
            return False

    async def poll_once(self) -> list[AgentState]:
        """Single poll of Ruflo hive-mind status."""
        try:
            result = await asyncio.create_subprocess_exec(
                "npx", "ruflo@latest", "hive-mind", "status", "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.project_dir),
            )
            stdout, _ = await asyncio.wait_for(result.communicate(), timeout=5)
            raw = stdout.decode("utf-8", errors="replace").strip()
            if not raw:
                return list(self.agents.values())
            data = json.loads(raw)
            return self._parse_agents(data)
        except asyncio.TimeoutError:
            return list(self.agents.values())
        except json.JSONDecodeError:
            return list(self.agents.values())
        except Exception:
            return list(self.agents.values())

    def _parse_agents(self, data: dict) -> list[AgentState]:
        raw_agents = data.get("agents", [])
        now = time.time()
        updated = []
        for a in raw_agents:
            agent_id = str(a.get("id", a.get("name", f"agent-{len(self.agents)}")))
            task = a.get("currentTask", a.get("task", ""))
            status = a.get("status", "idle").lower()
            existing = self.agents.get(agent_id)
            if existing:
                existing.task = task or existing.task
                existing.status = status
                existing.elapsed_sec = int(now - existing.spawned_at)
                existing.tool_calls = a.get("toolCalls", existing.tool_calls)
                if task:
                    existing.column = detect_column(task)
                existing.progress = estimate_progress(existing)
                updated.append(existing)
            else:
                col = detect_column(task) if task else "Thinking"
                agent = AgentState(
                    id=agent_id,
                    name=a.get("name", f"Agent {agent_id[:6]}"),
                    status=status,
                    task=task,
                    column=col,
                    spawned_at=now,
                )
                agent.progress = estimate_progress(agent)
                self.agents[agent_id] = agent
                updated.append(agent)
        # Mark removed agents as done
        active_ids = {str(a.get("id", a.get("name", ""))) for a in raw_agents}
        for aid, agent in self.agents.items():
            if aid not in active_ids and agent.status not in ("done", "error"):
                agent.status = "done"
                agent.progress = 100
        return list(self.agents.values())

    async def search_memory(self, query: str = "recent patterns", limit: int = 8) -> list[str]:
        """Search Ruflo memory for the current project."""
        try:
            result = await asyncio.create_subprocess_exec(
                "npx", "ruflo@latest", "memory", "search",
                "--query", query, "--limit", str(limit),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.project_dir),
            )
            stdout, _ = await asyncio.wait_for(result.communicate(), timeout=6)
            raw = stdout.decode("utf-8", errors="replace")
            lines = [l.strip() for l in raw.splitlines() if l.strip() and not l.startswith("[")]
            self.memory_entries = lines[:limit]
            return self.memory_entries
        except Exception:
            return self.memory_entries

    def add_demo_agents(self):
        """Add placeholder agents when Ruflo has no real agents yet."""
        placeholders = [
            ("demo-1", "QB Agent", "idle", "Waiting for your first prompt...", "Thinking"),
            ("demo-2", "Memory Agent", "idle", "Memory system ready", "Done"),
        ]
        for aid, name, status, task, col in placeholders:
            if aid not in self.agents:
                a = AgentState(id=aid, name=name, status=status, task=task, column=col)
                a.progress = 100 if status == "done" else 0
                self.agents[aid] = a

    async def spawn_task(self, prompt: str, queen_type: str = "tactical") -> bool:
        """Dispatch a new task via Ruflo hive-mind."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "npx", "ruflo@latest", "hive-mind", "spawn", prompt,
                "--queen-type", queen_type,
                "--claude",
                "--topology", "hierarchical",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.project_dir),
            )
            asyncio.create_task(self._stream_spawn(proc))
            return True
        except Exception:
            return False

    async def _stream_spawn(self, proc):
        """Stream spawn output and create agent cards."""
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if "agent" in decoded.lower() or "spawn" in decoded.lower():
                    # Create a new agent card from stdout
                    agent_id = f"spawned-{int(time.time())}"
                    if agent_id not in self.agents:
                        a = AgentState(
                            id=agent_id,
                            name="New Agent",
                            status="thinking",
                            task=decoded[:60],
                            column="Thinking",
                        )
                        self.agents[agent_id] = a
        except Exception:
            pass
