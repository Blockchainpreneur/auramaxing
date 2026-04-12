#!/usr/bin/env python3
"""
AURAMXING — Notion-style AI Development OS
Dark kanban board matching Notion's visual language.
"""
import asyncio
import json
import site
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

sys.path.insert(0, site.getusersitepackages())

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, ScrollableContainer
from textual.screen import Screen
from textual.widgets import Button, Input, ProgressBar, Static
from textual.reactive import reactive
from textual.timer import Timer
from rich.text import Text

from ruflo_bridge import RufloBridge, AgentState
from agent_tracker import AgentTracker
from session_store import SessionStore


# ── Config ─────────────────────────────────────────────────────────────────────
_CFG_PATH = Path(__file__).parent / "config.json"
try:
    CFG = json.loads(_CFG_PATH.read_text())
except Exception:
    CFG = {}

COLUMNS    = CFG.get("kanban", {}).get("columns",
             ["Thinking","Designing","Developing","Testing","Reviewing","Deploying","Done"])
POLL_PORTS = CFG.get("ports", [3000, 3001, 5173, 8080, 4000])
REFRESH    = CFG.get("app", {}).get("refresh_rate", 2)
MIN_W      = CFG.get("app", {}).get("min_width",  140)
MIN_H      = CFG.get("app", {}).get("min_height",  42)

# ── Visual constants ────────────────────────────────────────────────────────────
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

# Notion-style column pill mapping
COL_PILL = {
    "Thinking":   ("pill-notstarted", "●", "Not Started"),
    "Designing":  ("pill-default",    "●", "Designing"),
    "Developing": ("pill-inprogress", "●", "In Progress"),
    "Testing":    ("pill-testing",    "●", "Testing"),
    "Reviewing":  ("pill-default",    "●", "Reviewing"),
    "Deploying":  ("pill-inprogress", "●", "Deploying"),
    "Done":       ("pill-done",       "●", "Done"),
}

# Avatar background colours (cycling)
AVATAR_COLORS = [
    "#5865f2", "#2383e2", "#0891b2", "#7c3aed",
    "#16a34a", "#dc2626", "#d97706", "#db2777",
]

# Initials from agent name
def _initials(name: str) -> str:
    parts = name.split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return name[:2].upper() if name else "??"

def _avatar_color(name: str) -> str:
    return AVATAR_COLORS[sum(ord(c) for c in name) % len(AVATAR_COLORS)]

def _fmt_elapsed(sec: int) -> str:
    if sec < 60:   return f"{sec}s ago"
    if sec < 3600: return f"{sec // 60}m ago"
    return f"{sec // 3600}h ago"

def _smooth_bar(pct: int, w: int = 12) -> str:
    BLOCKS = " ▏▎▍▌▋▊▉█"
    eighths = int(pct / 100 * w * 8)
    full = eighths // 8
    frac = eighths % 8
    bar  = "█" * full
    if frac and full < w:
        bar += BLOCKS[frac]
    return bar.ljust(w, "░")


# ═══════════════════════════════════════════════════════════════════════════════
# WIDGETS
# ═══════════════════════════════════════════════════════════════════════════════

class NotionCard(Static):
    """
    Notion-style card: title prominent, avatar + metadata subtle.
    Matches the visual design of Notion's dark kanban cards.
    """

    def __init__(self, agent: AgentState, frame: int = 0, **kwargs):
        super().__init__(**kwargs)
        self.agent = agent
        self._frame = frame
        self._render()

    def _render(self):
        a     = self.agent
        spin  = SPINNER[self._frame % len(SPINNER)]
        ini   = _initials(a.name)
        acol  = _avatar_color(a.name)
        ela   = _fmt_elapsed(a.elapsed_sec)

        # Status
        if a.status == "thinking":
            status_indicator = f"[bold #7c3aed]{spin}[/]"
        elif a.status == "working":
            status_indicator = f"[bold #2383e2]{spin}[/]"
        elif a.status == "done":
            status_indicator = "[#22c55e]●[/]"
        elif a.status == "error":
            status_indicator = "[#ef4444]✗[/]"
        else:
            status_indicator = "[#333333]○[/]"

        # Title — this is the prominent element, like Notion card titles
        title = a.task or a.name
        # Wrap long titles (max ~26 chars per line, 2 lines max)
        if len(title) > 52:
            title = title[:49] + "…"
        lines = []
        while len(title) > 26:
            cut = title[:26].rfind(" ")
            if cut < 10: cut = 26
            lines.append(title[:cut])
            title = title[cut:].strip()
        lines.append(title)
        title_block = "\n ".join(lines)

        t = Text(no_wrap=False)

        # Title line(s) — bold and white like Notion
        if a.status in ("thinking", "working"):
            t.append(f" {title_block}\n", style="bold #e3e3e3")
        elif a.status == "done":
            t.append(f" {title_block}\n", style="#555555")
        elif a.status == "error":
            t.append(f" {title_block}\n", style="#993333")
        else:
            t.append(f" {title_block}\n", style="#666666")

        # Spacer
        t.append("\n")

        # Avatar + name row — like Notion's assignee row
        t.append(f" [{acol}]{ini}[/] ", style="")
        t.append(f"{a.name}", style="#555555")

        # Status indicator on right
        t.append("  ")
        t.append_text(Text.from_markup(status_indicator))

        # Timestamp row
        t.append(f"\n {ela}", style="#3a3a3a")

        # Progress bar only if active
        if a.status in ("thinking", "working") and a.progress > 0:
            bar = _smooth_bar(a.progress)
            t.append(f"\n [{acol}]{bar}[/] ", style="")
            t.append(f"{a.progress}%", style="#333333")

        self.update(t)

        # CSS card class
        for cls in ("card-thinking","card-working","card-done","card-error","card-idle"):
            self.remove_class(cls)
        self.add_class({
            "thinking": "card-thinking",
            "working":  "card-working",
            "done":     "card-done",
            "error":    "card-error",
        }.get(a.status, "card-idle"))

    def tick(self, frame: int):
        self._frame = frame
        if self.agent.status in ("thinking", "working"):
            self._render()

    def on_click(self):
        self.app.show_agent_detail(self.agent)


class KanbanColumn(Vertical):
    """Notion-style kanban column with pill header."""

    def __init__(self, name: str, **kwargs):
        super().__init__(**kwargs)
        self.col_name = name
        self.add_class("kanban-col")

    def compose(self) -> ComposeResult:
        yield Horizontal(id=f"hdr-{self.col_name}", classes="col-header-area")
        yield ScrollableContainer(id=f"cards-{self.col_name}", classes="col-cards-area")
        yield Static(id=f"add-{self.col_name}", classes="col-add-row")

    def on_mount(self):
        self._update_header(0)
        try:
            self.query_one(f"#add-{self.col_name}", Static).update(
                Text.from_markup("  [#2a2a2a]+ New task[/]"))
        except Exception:
            pass

    def _update_header(self, count: int):
        pill_cls, dot, label = COL_PILL.get(self.col_name,
                               ("pill-default", "●", self.col_name))
        try:
            hdr = self.query_one(f"#hdr-{self.col_name}", Horizontal)
            await_mount = False
            # Clear and re-add pill + count
            # We do it via update on a Static child if it exists
            for child in hdr.children:
                child.remove()
        except Exception:
            pass

        # Re-render header via Static inside Horizontal
        try:
            hdr = self.query_one(f"#hdr-{self.col_name}", Horizontal)
            pill_t = Text.from_markup(f"{dot} {label}")
            cnt_t  = Text(f"  {count}" if count else "", style="#3a3a3a")
            hdr.mount(Static(pill_t, classes=pill_cls))
            hdr.mount(Static(cnt_t, classes="col-count"))
        except Exception:
            pass

    def set_count(self, count: int):
        self._update_header(count)


class TopBar(Horizontal):
    """Notion-style top breadcrumb bar with view tabs."""

    def compose(self) -> ComposeResult:
        yield Static(
            Text.from_markup("[#3a3a3a]AURAMXING[/]  [#2a2a2a]/[/]  "),
            id="topbar-breadcrumb",
        )
        yield Static(
            Text("Tasks", style="bold #e3e3e3"),
            id="topbar-title",
        )
        with Horizontal(id="topbar-tabs"):
            yield Button("All",            classes="tab-btn",        id="tab-all")
            yield Button("⊞ Board",        classes="tab-btn-active",  id="tab-board")
            yield Button("My activity",    classes="tab-btn",        id="tab-mine")
        with Horizontal(id="topbar-actions"):
            yield Button("+ New",          id="new-btn")

    def on_button_pressed(self, event: Button.Pressed):
        if event.button.id == "new-btn":
            self.app.focus_input()


class Sidebar(Vertical):
    """Notion-style left sidebar."""

    def __init__(self, **kwargs):
        super().__init__(id="sidebar", **kwargs)
        self.projects   = ["Econ Markets", "EconCash"]
        self.active     = "Econ Markets"
        self._sessions  = []
        self._memory    = []
        self._cost      = 0.0
        self._agents    = 0

    def compose(self) -> ComposeResult:
        # Workspace header
        with Horizontal(classes="sb-workspace"):
            yield Static("A", classes="sb-workspace-icon")
            yield Static(" AdrianGuts", classes="sb-workspace-name")

        # Nav items
        for icon, label in [("🔍", "Search"), ("⌂", "Home"), ("📅", "Meetings"), ("🤖", "AI")]:
            with Horizontal(classes="sb-nav-item"):
                yield Static(f" {icon}", classes="sb-nav-icon")
                yield Static(label, classes="sb-nav-label")

        yield Static("PROJECTS", classes="sb-section-hdr")

        for p in self.projects:
            cls = "sb-project-active" if p == self.active else "sb-project-item"
            with Horizontal(classes=cls):
                yield Static(" 📋", classes="sb-project-icon")
                yield Static(p, classes="sb-project-label",
                             id=f"proj-{p.replace(' ','_')}")

        with Horizontal(classes="sb-nav-item"):
            yield Static("  +", classes="sb-nav-icon")
            yield Static("Add page", classes="sb-nav-label")

        yield Static("RECENT", classes="sb-section-hdr")
        yield Static(id="sb-sessions", classes="")

        yield Static("MEMORY", classes="sb-section-hdr")
        yield Static(id="sb-memory",   classes="")

        yield Static(id="sb-footer",   classes="sb-footer-area")

    def on_mount(self):
        self._draw_sessions()
        self._draw_memory()
        self._draw_footer()

    def _draw_sessions(self):
        t = Text()
        if self._sessions:
            for s in self._sessions[:3]:
                lbl  = s.get("_label", "—")
                cost = s.get("_cost_fmt", "$0.00")
                t.append(f"  ◷ {lbl}", style="#3a3a3a")
                t.append(f"  {cost}\n", style="#6b21a8")
        else:
            t.append("  no sessions yet\n", style="#252525")
        try:
            self.query_one("#sb-sessions", Static).update(t)
        except Exception:
            pass

    def _draw_memory(self):
        t = Text()
        if self._memory:
            for m in self._memory[:4]:
                s = m[:20].strip()
                if s:
                    t.append(f"  · {s}\n", style="#2a2a2a")
        else:
            t.append("  no patterns yet\n", style="#252525")
        try:
            self.query_one("#sb-memory", Static).update(t)
        except Exception:
            pass

    def _draw_footer(self):
        t = Text()
        t.append(f" ◆ ${self._cost:.4f} today\n", style="#6b21a8")
        t.append(" ⚡ Fast Mode ON\n",              style="#2a2a2a")
        t.append(f" ◎ {self._agents} active\n",    style="#2a2a2a")
        try:
            self.query_one("#sb-footer", Static).update(t)
        except Exception:
            pass

    def refresh_data(self, sessions, memory, cost, agents):
        self._sessions = sessions
        self._memory   = memory
        self._cost     = cost
        self._agents   = agents
        self._draw_sessions()
        self._draw_memory()
        self._draw_footer()


class BottomBar(Horizontal):
    """Bottom input bar — clean Notion-style."""

    def compose(self) -> ComposeResult:
        with Horizontal(id="bottom-prompt-wrap"):
            yield Static("QB ▶ ", id="bottom-prefix")
            yield Input(placeholder="Describe what to build…", id="prompt-input")
        with Horizontal(id="bottom-actions"):
            yield Button("✦ Feature",   classes="quick-btn", id="q-feat")
            yield Button("⚑ Fix",       classes="quick-btn", id="q-fix")
            yield Button("◈ Contract",  classes="quick-btn", id="q-contract")
            yield Button("▶ Go",        id="go-btn")

    def on_button_pressed(self, event: Button.Pressed):
        TEMPLATES = {
            "q-feat":     "Build {feature} for {project}. Coordinate frontend React/Next.js, backend Node.js/Supabase, and tests in parallel.",
            "q-fix":      "Fix {bug}. Identify affected files, implement fix, verify with tests.",
            "q-contract": "Build and audit {contract} smart contract in Solidity with Hardhat. Deploy to testnet after audit passes.",
        }
        if event.button.id == "go-btn":
            inp = self.query_one("#prompt-input", Input)
            if inp.value.strip():
                self.app.dispatch_task(inp.value.strip())
                inp.value = ""
        elif event.button.id in TEMPLATES:
            self.query_one("#prompt-input", Input).value = TEMPLATES[event.button.id]
            self.query_one("#prompt-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted):
        if event.value.strip():
            self.app.dispatch_task(event.value.strip())
            event.input.value = ""


# ═══════════════════════════════════════════════════════════════════════════════
# SCREENS
# ═══════════════════════════════════════════════════════════════════════════════

LOGO_ART = r"""
  ███████╗ ██████╗ ██████╗ ███╗  ██╗
  ██╔════╝██╔════╝██╔═══██╗████╗ ██║
  █████╗  ██║     ██║   ██║██╔██╗██║
  ██╔══╝  ██║     ██║   ██║██║╚████║
  ███████╗╚██████╗╚██████╔╝██║ ╚███║
  ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚══╝
              · vibe ·
"""

BOOT_STEPS = [
    "initializing workspace…",
    "connecting to Ruflo…",
    "loading MCP servers…",
    "warming up agents…",
    "ready.",
]


class LoadingScreen(Screen):
    _progress: int = 0
    _step: int = 0

    def compose(self) -> ComposeResult:
        yield Static(id="loading-logo")
        yield Static(id="loading-sub")
        yield ProgressBar(total=100, show_eta=False, id="loading-progress")
        yield Static(id="loading-step")

    def on_mount(self):
        try:
            self.query_one("#loading-logo", Static).update(
                Text(LOGO_ART, style="bold #2383e2", justify="center"))
            self.query_one("#loading-sub", Static).update(
                Text("The AI Development Operating System\n", style="#2a2a2a", justify="center"))
        except Exception:
            pass
        self.set_interval(0.055, self._tick)

    def _tick(self):
        self._progress = min(self._progress + 2, 100)
        try:
            self.query_one("#loading-progress", ProgressBar).advance(2)
        except Exception:
            pass
        step = int(self._progress / 100 * len(BOOT_STEPS))
        if step < len(BOOT_STEPS) and step != self._step:
            self._step = step
            try:
                self.query_one("#loading-step", Static).update(
                    Text(BOOT_STEPS[step], style="#222222", justify="center"))
            except Exception:
                pass
        if self._progress >= 100:
            self.app.pop_screen()


class SizeWarningScreen(Screen):
    def compose(self) -> ComposeResult:
        yield Static(
            f"\n  ⚠  Terminal too small\n\n"
            f"  Minimum: {MIN_W} × {MIN_H}\n\n"
            "  Resize to continue\n",
            id="size-msg",
        )


class MainScreen(Screen):
    BINDINGS = [
        Binding("q",      "quit",           "Quit"),
        Binding("p",      "open_preview",   "Preview"),
        Binding("d",      "deploy",         "Deploy"),
        Binding("r",      "refresh_memory", "Memory"),
        Binding("escape", "blur_input",     "Blur"),
    ]

    def compose(self) -> ComposeResult:
        yield TopBar(id="topbar")
        with Horizontal(id="body"):
            yield Sidebar()
            with ScrollableContainer(id="kanban-scroll"):
                with Horizontal(id="kanban"):
                    for col in COLUMNS:
                        yield KanbanColumn(col, id=f"col-{col}")
        yield BottomBar(id="bottom-bar")

    def action_quit(self):
        self.app.exit()

    def action_open_preview(self):
        self.app.open_preview()

    def action_deploy(self):
        self.app.run_deploy()

    def action_refresh_memory(self):
        asyncio.create_task(self.app.refresh_memory())

    def action_blur_input(self):
        try:
            self.query_one("#prompt-input", Input).blur()
        except Exception:
            pass

    def on_resize(self, event) -> None:
        """Hide sidebar on narrow terminals, hide topbar on very short ones."""
        try:
            sidebar = self.query_one("#sidebar")
            sidebar.set_class(event.size.width < 100, "hidden")
        except Exception:
            pass
        try:
            topbar = self.query_one("#topbar")
            topbar.set_class(event.size.height < 28, "hidden")
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# APP
# ═══════════════════════════════════════════════════════════════════════════════

class EconVibeApp(App):
    CSS_PATH = "theme.tcss"
    TITLE    = "AURAMXING"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.bridge  = RufloBridge(project_dir=str(Path.cwd()))
        self.tracker = AgentTracker()
        self.store   = SessionStore(sessions_dir=str(Path(__file__).parent / "sessions"))
        self._frame  = 0
        self._poll_timer: Optional[Timer] = None
        self._spin_timer: Optional[Timer] = None

    def on_mount(self):
        self.push_screen(LoadingScreen())
        self.push_screen(MainScreen())
        self._poll_timer = self.set_interval(REFRESH, self._refresh_all)
        self._spin_timer = self.set_interval(0.13,    self._spin_tick)
        asyncio.create_task(self._startup())

    async def on_unmount(self):
        self.store.save()

    def _spin_tick(self):
        self._frame += 1
        main = self._main()
        if not main:
            return
        try:
            for card in main.query(NotionCard):
                card.tick(self._frame)
        except Exception:
            pass

    async def _startup(self):
        await asyncio.sleep(1.8)
        self.bridge.add_demo_agents()
        await self.bridge.ensure_daemon()
        await self.bridge.search_memory("recent patterns architecture")
        await self._refresh_all()

    async def _refresh_all(self):
        w, h = self.size
        if w < MIN_W or h < MIN_H:
            if not isinstance(self.screen, SizeWarningScreen):
                self.push_screen(SizeWarningScreen())
            return
        else:
            if isinstance(self.screen, SizeWarningScreen):
                self.pop_screen()

        agents = await self.bridge.poll_once()
        main   = self._main()
        if not main:
            return

        # Group
        by_col: dict[str, list] = {c: [] for c in COLUMNS}
        for a in agents:
            col = a.column if a.column in COLUMNS else "Developing"
            by_col[col].append(a)

        for col_name in COLUMNS:
            try:
                col_w   = main.query_one(f"#col-{col_name}", KanbanColumn)
                cards_c = col_w.query_one(f"#cards-{col_name}", ScrollableContainer)
                col_a   = by_col[col_name]
                col_w.set_count(len(col_a))
                await cards_c.remove_children()
                if col_a:
                    for a in col_a:
                        await cards_c.mount(
                            NotionCard(a, frame=self._frame, classes="notion-card"))
                else:
                    await cards_c.mount(Static("", classes="empty-col"))
            except Exception:
                pass

        # Sidebar
        sessions = self.store.load_recent(3)
        try:
            main.query_one(Sidebar).refresh_data(
                sessions=sessions,
                memory=self.bridge.memory_entries,
                cost=self.tracker.estimate_session_cost(),
                agents=len([a for a in agents if a.status in ("thinking","working")]),
            )
        except Exception:
            pass

    def _main(self) -> Optional[MainScreen]:
        for s in self.screen_stack:
            if isinstance(s, MainScreen):
                return s
        return None

    def _detect_port(self) -> Optional[int]:
        for p in POLL_PORTS:
            try:
                with socket.create_connection(("localhost", p), timeout=0.15):
                    return p
            except Exception:
                pass
        return None

    def focus_input(self):
        try:
            self._main().query_one("#prompt-input", Input).focus()
        except Exception:
            pass

    def dispatch_task(self, prompt: str):
        self.notify(f"{prompt[:70]}…" if len(prompt) > 70 else prompt,
                    title="Dispatching")
        asyncio.create_task(self._do_dispatch(prompt))

    async def _do_dispatch(self, prompt: str):
        aid = f"qb-{int(time.time())}"
        a   = AgentState(id=aid, name="QB Agent",
                         status="thinking", task=prompt[:80], column="Thinking")
        self.bridge.agents[aid] = a
        self.tracker.record_task_start(prompt, aid)
        ok = await self.bridge.spawn_task(prompt)
        if not ok:
            a.status = "error"
            self.notify("Ruflo not responding.", title="Error", severity="error")

    def open_preview(self):
        port = self._detect_port()
        if port:
            subprocess.Popen(["open", f"http://localhost:{port}"])
        else:
            self.notify("No local server detected.", title="Preview", severity="warning")

    def run_deploy(self):
        self.notify("Starting Vercel deploy…", title="Deploy")
        asyncio.create_task(self._do_deploy())

    async def _do_deploy(self):
        try:
            proc = await asyncio.create_subprocess_shell(
                "npx vercel --yes 2>&1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(Path.cwd()),
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
            txt = out.decode("utf-8", errors="replace")
            if "https://" in txt:
                url = [l.strip() for l in txt.splitlines() if "https://" in l][-1]
                self.notify(url, title="Deployed ✓")
            else:
                self.notify("Check terminal for details.", title="Deploy done")
        except Exception as e:
            self.notify(str(e)[:80], title="Deploy Error", severity="error")

    async def refresh_memory(self):
        self.notify("Refreshing memory…", title="Memory")
        await self.bridge.search_memory("recent patterns architecture")
        n = len(self.bridge.memory_entries)
        self.notify(f"{n} pattern{'s' if n != 1 else ''} found", title="Memory")

    def show_agent_detail(self, agent: AgentState):
        t = (
            f"[bold]{agent.name}[/]\n"
            f"Status:   {agent.status}\n"
            f"Column:   {agent.column}\n"
            f"Task:     {agent.task[:60]}\n"
            f"Progress: {agent.progress}%\n"
            f"Elapsed:  {_fmt_elapsed(agent.elapsed_sec)}\n"
            f"Tools:    {agent.tool_calls}\n"
            f"Cost:     ${agent.cost_usd:.4f}"
        )
        self.notify(t, title="Agent Detail", timeout=10)


if __name__ == "__main__":
    EconVibeApp().run()
