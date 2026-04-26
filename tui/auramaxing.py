#!/usr/bin/env python3
"""AURAMAXING TUI — AI Development Operating System
Simplified launcher: scan projects, pick one, go.
"""

import curses
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

DAEMON_URL = "http://localhost:57821"
PROJECTS_CACHE = Path.home() / ".config" / "auramaxing" / "projects.json"
DAEMON_TIMEOUT = 0.5

# ── Hardcoded defaults (no settings UI) ──────────────────────────────────────
DEFAULTS = {
    "slow": False,
    "danger": True,
    "auto_relay": True,
    "multi_project": True,
    "state_diagram": False,
}

# ── Directories to scan for projects ──────────────────────────────────────────
SCAN_DIRS = [
    Path.home(),
    Path.home() / "code",
    Path.home() / "projects",
    Path.home() / "dev",
    Path.home() / "src",
    Path.home() / "work",
    Path.home() / "Documents",
    Path.home() / "Desktop",
]

# Project markers — if a directory contains any of these, it's a project
PROJECT_MARKERS = [
    ".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
    "setup.py", "pom.xml", "build.gradle", "Makefile", "CLAUDE.md",
    "composer.json", "Gemfile", "mix.exs", "pubspec.yaml",
]

# Directories to skip during scan
SKIP_DIRS = {
    "node_modules", ".git", ".next", "__pycache__", "venv", ".venv",
    "dist", "build", ".cache", ".npm", ".bun", "Library", ".Trash",
    "Applications", ".local", ".config", ".claude", ".auramaxing",
    "Pictures", "Movies", "Music", "Downloads",
}

LOGO_LINES = [
    " ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗ ███╗   ███╗ █████╗ ██╗  ██╗",
    "██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝ ████╗ ████║██╔══██╗╚██╗██╔╝",
    "██║     ██║     ███████║██║   ██║██║  ██║█████╗   ██╔████╔██║███████║ ╚███╔╝ ",
    "██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝   ██║╚██╔╝██║██╔══██║ ██╔██╗ ",
    "╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗ ██║ ╚═╝ ██║██║  ██║██╔╝ ██╗",
    " ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝",
]


# ═══════════════════════════════════════════════════════════════════════════════
# PROJECT SCANNER
# ═══════════════════════════════════════════════════════════════════════════════

def scan_projects() -> list[dict]:
    """Scan common directories for coding projects. Fast, max 2 levels deep."""
    found: dict[str, dict] = {}
    scanned = set()

    for base in SCAN_DIRS:
        if not base.exists():
            continue
        _scan_dir(base, found, scanned, depth=0, max_depth=2)

    # Sort by last modified (most recent first)
    projects = sorted(found.values(), key=lambda p: p.get("modified", 0), reverse=True)
    return projects


def _scan_dir(directory: Path, found: dict, scanned: set, depth: int, max_depth: int):
    """Recursively scan for project markers."""
    real = str(directory.resolve())
    if real in scanned or depth > max_depth:
        return
    scanned.add(real)

    try:
        entries = list(os.scandir(directory))
    except (PermissionError, OSError):
        return

    names = {e.name for e in entries}

    # Check if THIS directory is a project
    if any(marker in names for marker in PROJECT_MARKERS):
        path_str = str(directory)
        if path_str not in found:
            try:
                mtime = directory.stat().st_mtime
            except OSError:
                mtime = 0
            found[path_str] = {
                "name": directory.name,
                "path": path_str,
                "modified": mtime,
                "modified_fmt": _fmt_time(mtime),
            }
        return  # Don't scan deeper inside a project

    # Recurse into subdirectories
    for entry in entries:
        if not entry.is_dir(follow_symlinks=False):
            continue
        if entry.name.startswith(".") and entry.name != ".git":
            continue
        if entry.name in SKIP_DIRS:
            continue
        _scan_dir(Path(entry.path), found, scanned, depth + 1, max_depth)


def _fmt_time(ts: float) -> str:
    """Format timestamp as relative time."""
    if ts == 0:
        return ""
    diff = time.time() - ts
    if diff < 60:
        return "just now"
    if diff < 3600:
        return f"{int(diff // 60)}m ago"
    if diff < 86400:
        return f"{int(diff // 3600)}h ago"
    if diff < 604800:
        return f"{int(diff // 86400)}d ago"
    return datetime.fromtimestamp(ts).strftime("%b %d")


def load_cached_projects() -> list[dict]:
    """Load cached project list."""
    try:
        if PROJECTS_CACHE.exists():
            return json.loads(PROJECTS_CACHE.read_text())
    except Exception:
        pass
    return []


def save_cached_projects(projects: list[dict]):
    """Cache project list for fast startup."""
    PROJECTS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_CACHE.write_text(json.dumps(projects[:100], indent=2))


# ═══════════════════════════════════════════════════════════════════════════════
# SDR TEMPLATE
# ═══════════════════════════════════════════════════════════════════════════════

SDR_TEMPLATE = """# {name} — Software Design Record

## Status: Draft
Generated by AURAMAXING autopilot. Updated automatically during session.

## Overview
<!-- Autopilot fills this after first prompt -->

## Architecture
<!-- Generated from implementation decisions -->

## Stack
{stack}

## Decisions Log
| # | Decision | Rationale | Date |
|---|----------|-----------|------|

## Current State
- Phase: Initial
- Files: 0
- Tests: 0

---
*Auto-generated by AURAMAXING. Do not edit manually — autopilot updates this.*
"""


# ═══════════════════════════════════════════════════════════════════════════════
# CURSES UI
# ═══════════════════════════════════════════════════════════════════════════════

def init_colors():
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, 99, -1)    # purple
    curses.init_pair(2, 141, -1)   # violet
    curses.init_pair(3, 8, -1)     # dim
    curses.init_pair(4, 255, -1)   # white
    curses.init_pair(5, 75, -1)    # cyan
    curses.init_pair(6, 34, -1)    # green


def draw_screen(stdscr, projects: list[dict], sel: int, scroll: int, scanning: bool):
    stdscr.erase()
    h, w = stdscr.getmaxyx()

    row = 1
    logo_w = 80
    lpad = max(0, (w - logo_w) // 2)
    claude_split = 48

    # ── Logo ──
    for line in LOGO_LINES:
        if row >= h - 1:
            break
        try:
            stdscr.addstr(row, lpad, line[:claude_split],
                          curses.color_pair(1) | curses.A_BOLD)
            stdscr.addstr(row, lpad + claude_split, " " + line[claude_split:],
                          curses.color_pair(2) | curses.A_BOLD)
        except curses.error:
            pass
        row += 1

    row += 1
    sub = "Multi-Agent Autopilot"
    try:
        stdscr.addstr(row, max(0, (w - len(sub)) // 2), sub,
                      curses.color_pair(3) | curses.A_DIM)
    except curses.error:
        pass
    row += 2

    # ── New Project ──
    row_w = min(74, w - 4)
    rpad = max(0, (w - row_w) // 2)
    new_idx = 0  # New Project is always index 0
    is_new_sel = sel == new_idx

    try:
        icon = "▶" if is_new_sel else "+"
        label = f"  {icon}  New Project"
        if is_new_sel:
            stdscr.addstr(row, rpad, label.ljust(row_w),
                          curses.color_pair(6) | curses.A_BOLD)
        else:
            stdscr.addstr(row, rpad, label.ljust(row_w),
                          curses.color_pair(5))
    except curses.error:
        pass
    row += 2

    # ── Separator ──
    sep = "─" * row_w
    try:
        stdscr.addstr(row, rpad, sep, curses.color_pair(3))
    except curses.error:
        pass
    row += 1

    # ── Projects header ──
    hdr = f" PROJECTS ({len(projects)})"
    if scanning:
        hdr += "  scanning…"
    try:
        stdscr.addstr(row, rpad, hdr, curses.color_pair(3) | curses.A_DIM)
    except curses.error:
        pass
    row += 1

    # ── Project list ──
    visible_rows = h - row - 3  # leave room for hints
    if visible_rows < 1:
        visible_rows = 1

    if not projects:
        try:
            stdscr.addstr(row, rpad + 2, "No projects found. Scanning…",
                          curses.color_pair(3) | curses.A_DIM)
        except curses.error:
            pass
    else:
        for i in range(scroll, min(len(projects), scroll + visible_rows)):
            if row >= h - 2:
                break
            proj = projects[i]
            list_idx = i + 1  # +1 because New Project is index 0
            is_sel = sel == list_idx

            name = (proj.get("name") or "?")[:30]
            path = (proj.get("path") or "")
            # Shorten path
            home = str(Path.home())
            if path.startswith(home):
                path = "~" + path[len(home):]
            path = path[:row_w - 40] if len(path) > row_w - 40 else path
            mod = proj.get("modified_fmt", "")

            line = f"  {'▶' if is_sel else ' '}  {name:<30} {mod:>8}"
            line = line[:row_w]

            try:
                if is_sel:
                    stdscr.addstr(row, rpad, line.ljust(row_w),
                                  curses.A_REVERSE | curses.A_BOLD)
                    # Show path on next line when selected
                    if row + 1 < h - 2:
                        row += 1
                        stdscr.addstr(row, rpad + 5, path,
                                      curses.color_pair(3))
                else:
                    stdscr.addstr(row, rpad, line, curses.color_pair(3))
            except curses.error:
                pass
            row += 1

    # ── Bottom hints ──
    row = h - 1
    hints = "↑↓ navigate   ⏎ launch   n new   r rescan   q quit"
    try:
        stdscr.addstr(row, max(0, (w - len(hints)) // 2), hints,
                      curses.color_pair(3) | curses.A_DIM)
    except curses.error:
        pass

    stdscr.refresh()


# ═══════════════════════════════════════════════════════════════════════════════
# NEW PROJECT — straight to session
# ═══════════════════════════════════════════════════════════════════════════════

def create_project() -> bool:
    """Create a new project and launch straight into claude session."""
    curses.endwin()

    print("\n  ▶ AURAMAXING — New Project\n")
    try:
        name = input("  Project name: ").strip()
    except (EOFError, KeyboardInterrupt):
        return False

    if not name:
        print("  (cancelled)")
        time.sleep(0.5)
        return False

    slug = name.lower().replace(" ", "-").replace("_", "-")
    default_path = str(Path.home() / slug)

    try:
        path = input(f"  Path [{default_path}]: ").strip() or default_path
    except (EOFError, KeyboardInterrupt):
        path = default_path

    # Create directory
    Path(path).mkdir(parents=True, exist_ok=True)

    # Generate SDR file
    sdr_path = Path(path) / "SDR.md"
    if not sdr_path.exists():
        sdr_path.write_text(SDR_TEMPLATE.format(name=name, stack="TBD"))

    # Create CLAUDE.md with autopilot directives
    claude_md = Path(path) / "CLAUDE.md"
    if not claude_md.exists():
        claude_md.write_text(
            f"# {name}\n\n"
            "## Rules\n"
            "- Do what has been asked; nothing more, nothing less\n"
            "- NEVER create files unless absolutely necessary\n"
            "- ALWAYS read a file before editing it\n"
            "- NEVER commit secrets, credentials, or .env files\n\n"
            "## SDR\n"
            "The Software Design Record is at `SDR.md`. Update it when:\n"
            "- Architecture decisions are made\n"
            "- Stack choices change\n"
            "- New phases begin\n"
        )

    # Cache project
    cached = load_cached_projects()
    if not any(p.get("path") == path for p in cached):
        cached.insert(0, {"name": name, "path": path, "modified": time.time(),
                          "modified_fmt": "just now"})
        save_cached_projects(cached)

    print(f"\n  ✓ Created {name}")
    print(f"    {path}")
    print(f"    SDR.md generated")
    print(f"\n  Launching session…\n")
    time.sleep(0.3)

    # Launch claude directly — no wizard steps
    os.chdir(path)
    os.execvp("claude", ["claude"])
    return True


def launch_project(proj: dict):
    """Launch claude for an existing project."""
    path = proj.get("path") or str(Path.home())
    if not os.path.isdir(path):
        return

    # Ensure SDR exists
    sdr_path = Path(path) / "SDR.md"
    if not sdr_path.exists():
        sdr_path.write_text(SDR_TEMPLATE.format(
            name=proj.get("name", Path(path).name), stack="TBD"))

    curses.endwin()
    os.chdir(path)
    os.execvp("claude", ["claude"])


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main(stdscr):
    curses.curs_set(0)
    stdscr.keypad(True)
    stdscr.timeout(100)
    init_colors()

    # Load cached projects first (instant startup)
    projects = load_cached_projects()
    sel = 0
    scroll = 0
    scanning = True

    # Show cached immediately, scan in background
    draw_screen(stdscr, projects, sel, scroll, scanning)

    # Scan for projects (blocking but fast)
    scanned = scan_projects()
    if scanned:
        projects = scanned
        save_cached_projects(projects)
    scanning = False

    while True:
        total = 1 + len(projects)  # New Project + projects
        draw_screen(stdscr, projects, sel, scroll, scanning)

        try:
            key = stdscr.getch()
        except KeyboardInterrupt:
            break

        if key == -1:
            continue

        if key in (curses.KEY_UP, ord("k")):
            sel = (sel - 1) % total

        elif key in (curses.KEY_DOWN, ord("j")):
            sel = (sel + 1) % total

        elif key in (curses.KEY_ENTER, ord("\n"), ord("\r")):
            if sel == 0:
                # New Project
                if create_project():
                    return  # execvp replaced process
                # Cancelled — reinit
                projects = load_cached_projects()
                sel = 0
            else:
                # Launch existing project
                proj_idx = sel - 1
                if proj_idx < len(projects):
                    launch_project(projects[proj_idx])
                    # If we return (execvp failed), reload
                    projects = load_cached_projects()
                    sel = 0

        elif key in (ord("n"), ord("N")):
            if create_project():
                return
            projects = load_cached_projects()
            sel = 0

        elif key in (ord("r"), ord("R")):
            scanning = True
            draw_screen(stdscr, projects, sel, scroll, scanning)
            projects = scan_projects()
            save_cached_projects(projects)
            scanning = False
            sel = 0

        elif key in (ord("q"), ord("Q")):
            break

        # Scroll management
        if sel > 0:
            proj_scroll_idx = sel - 1
            h = stdscr.getmaxyx()[0]
            visible = h - 18  # approximate visible rows
            if visible < 1:
                visible = 1
            if proj_scroll_idx >= scroll + visible:
                scroll = proj_scroll_idx - visible + 1
            elif proj_scroll_idx < scroll:
                scroll = proj_scroll_idx
        else:
            scroll = 0


if __name__ == "__main__":
    curses.wrapper(main)
