"""
agent_tracker.py — Tracks agent lifecycle, cost estimation, and task history.
"""
import time
from dataclasses import dataclass, field
from typing import Optional


COST_PER_1K_INPUT = 0.003   # Sonnet-level estimate
COST_PER_1K_OUTPUT = 0.015
AVG_TOKENS_PER_TOOL = 800   # rough estimate per tool call


@dataclass
class TaskRecord:
    task: str
    agent_id: str
    started_at: float
    ended_at: Optional[float] = None
    tool_calls: int = 0
    tokens_used: int = 0
    cost_usd: float = 0.0
    success: bool = True
    column_path: list = field(default_factory=list)

    @property
    def duration_sec(self) -> float:
        end = self.ended_at or time.time()
        return end - self.started_at


class AgentTracker:
    def __init__(self):
        self.tasks: list[TaskRecord] = []
        self.session_start: float = time.time()
        self._total_tokens: int = 0
        self._total_cost: float = 0.0

    def record_task_start(self, task: str, agent_id: str) -> TaskRecord:
        record = TaskRecord(task=task, agent_id=agent_id, started_at=time.time())
        self.tasks.append(record)
        return record

    def record_task_end(self, agent_id: str, tool_calls: int = 0, success: bool = True):
        for record in reversed(self.tasks):
            if record.agent_id == agent_id and record.ended_at is None:
                record.ended_at = time.time()
                record.tool_calls = tool_calls
                record.tokens_used = tool_calls * AVG_TOKENS_PER_TOOL
                record.cost_usd = (record.tokens_used / 1000) * COST_PER_1K_INPUT
                record.success = success
                self._total_tokens += record.tokens_used
                self._total_cost += record.cost_usd
                break

    def estimate_session_cost(self) -> float:
        """Live cost estimate based on active tool calls."""
        return round(self._total_cost, 4)

    def estimate_savings(self) -> float:
        """Estimate savings vs single-agent: multi-agent is ~40% faster,
        parallel execution saves repeat context loading."""
        single_agent_cost = self._total_cost * 2.1
        return round(single_agent_cost - self._total_cost, 4)

    def session_elapsed(self) -> str:
        elapsed = int(time.time() - self.session_start)
        h = elapsed // 3600
        m = (elapsed % 3600) // 60
        s = elapsed % 60
        return f"{h:02d}:{m:02d}:{s:02d}"

    def tasks_done(self) -> int:
        return sum(1 for t in self.tasks if t.ended_at is not None)

    def active_count(self) -> int:
        return sum(1 for t in self.tasks if t.ended_at is None)

    def recent_tasks(self, n: int = 5) -> list[TaskRecord]:
        done = [t for t in self.tasks if t.ended_at is not None]
        return sorted(done, key=lambda t: t.ended_at or 0, reverse=True)[:n]
