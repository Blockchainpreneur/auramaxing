"""
session_store.py — Persists session data to JSON files for history sidebar.
"""
import json
import time
from datetime import datetime, date
from pathlib import Path
from typing import Optional


class SessionStore:
    def __init__(self, sessions_dir: str = "sessions"):
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.current: dict = {}
        self._start_new_session()

    def _start_new_session(self):
        self.current = {
            "id": f"{datetime.now().strftime('%Y%m%d-%H%M%S')}",
            "project": "default",
            "start_time": time.time(),
            "end_time": None,
            "agents": [],
            "tasks": [],
            "tokens": 0,
            "cost_usd": 0.0,
            "savings_usd": 0.0,
        }

    def set_project(self, project: str):
        self.current["project"] = project
        self.current["id"] = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{project.replace(' ', '_')}"

    def update(self, agents_count: int, tasks_done: int, cost: float, savings: float):
        self.current["agents"] = agents_count
        self.current["tasks"] = tasks_done
        self.current["cost_usd"] = cost
        self.current["savings_usd"] = savings

    def save(self):
        self.current["end_time"] = time.time()
        path = self.sessions_dir / f"{self.current['id']}.json"
        path.write_text(json.dumps(self.current, indent=2))

    def load_recent(self, n: int = 3) -> list[dict]:
        files = sorted(self.sessions_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
        sessions = []
        for f in files[:n]:
            try:
                data = json.loads(f.read_text())
                # Format display label
                ts = data.get("start_time", 0)
                d = datetime.fromtimestamp(ts)
                today = date.today()
                session_date = d.date()
                if session_date == today:
                    label = "Today"
                elif (today - session_date).days == 1:
                    label = "Yesterday"
                else:
                    label = d.strftime("%b %-d")
                data["_label"] = label
                data["_cost_fmt"] = f"${data.get('cost_usd', 0):.2f}"
                sessions.append(data)
            except Exception:
                pass
        return sessions
