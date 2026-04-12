#!/usr/bin/env python3
"""AURAMAXING TUI — AI Development Operating System"""

import curses
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

DAEMON_URL = "http://localhost:57821"
PROJECTS_FILE = Path.home() / ".config" / "auramaxing" / "projects.json"
DAEMON_TIMEOUT = 0.5

LOGO_LINES = [
    " \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557      \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2557",
    "\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d \u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255a\u2588\u2588\u2557\u2588\u2588\u2554\u255d",
    "\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2554\u255d ",
    "\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255d   \u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551 \u2588\u2588\u2554\u2588\u2588\u2557 ",
    "\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u255d \u2588\u2588\u2557",
    " \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d     \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d",
]

SUBTITLE = "AI Development Operating System"


def daemon_get(endpoint: str, timeout: float = DAEMON_TIMEOUT):
    """GET request to daemon. Returns parsed JSON or None."""
    try:
        with urllib.request.urlopen(f"{DAEMON_URL}{endpoint}", timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def daemon_post(endpoint: str, data: dict, timeout: float = DAEMON_TIMEOUT):
    """POST request to daemon. Returns parsed JSON or None."""
    try:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{DAEMON_URL}{endpoint}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def load_fallback_projects() -> list[dict]:
    """Load projects from ~/.config/auramaxing/projects.json."""
    try:
        if PROJECTS_FILE.exists():
            return json.loads(PROJECTS_FILE.read_text())
    except Exception:
        pass
    return []


def save_fallback_projects(projects: list[dict]) -> None:
    """Save projects to ~/.config/auramaxing/projects.json."""
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))


def fetch_projects() -> tuple[list[dict], bool]:
    """Returns (projects, daemon_available)."""
    status = daemon_get("/status")
    if status and status.get("ok"):
        projects = daemon_get("/projects")
        if projects is not None:
            return projects, True
    return load_fallback_projects(), False


def init_colors():
    """Initialize curses color pairs."""
    curses.start_color()
    curses.use_default_colors()
    # Pair 1: CLAUDE purple (color 99)
    curses.init_pair(1, 99, -1)
    # Pair 2: MAX violet (color 141)
    curses.init_pair(2, 141, -1)
    # Pair 3: dim/muted
    curses.init_pair(3, 8, -1)
    # Pair 4: selected row (reverse)
    curses.init_pair(4, -1, -1)
    # Pair 5: cyan for new project
    curses.init_pair(5, 75, -1)
    # Pair 6: white
    curses.init_pair(6, 255, -1)


def draw_screen(stdscr, projects: list[dict], sel: int, daemon_ok: bool):
    """Draw the full AURAMAXING screen."""
    stdscr.erase()
    h, w = stdscr.getmaxyx()

    logo_w = 80
    row = 0

    # 3 blank lines
    row = 3

    # Logo (6 lines, centered)
    lpad = max(0, (w - logo_w) // 2)

    claude_attr = curses.color_pair(1) | curses.A_BOLD
    max_attr = curses.color_pair(2) | curses.A_BOLD

    # Split each logo line into CLAUDE part (~50 chars) and MAX part (~29 chars)
    claude_split = 48  # chars for CLAUDE part per line

    for i, line in enumerate(LOGO_LINES):
        if row >= h - 1:
            break
        try:
            # Write full line with color split
            claude_part = line[:claude_split]
            max_part = line[claude_split:]
            x = lpad
            stdscr.addstr(row, x, claude_part, claude_attr)
            stdscr.addstr(row, x + len(claude_part), " " + max_part, max_attr)
        except curses.error:
            pass
        row += 1

    # Blank line
    row += 1

    # Subtitle centered, dim
    if row < h - 1:
        sub_x = max(0, (w - len(SUBTITLE)) // 2)
        try:
            stdscr.addstr(row, sub_x, SUBTITLE, curses.color_pair(3) | curses.A_DIM)
        except curses.error:
            pass
    row += 1

    # 2 blank lines
    row += 2

    # Separator full width
    sep_w = min(w - 1, 80)
    sep_x = max(0, (w - sep_w) // 2)
    if row < h - 1:
        try:
            stdscr.addstr(row, sep_x, "\u2500" * sep_w, curses.color_pair(3))
        except curses.error:
            pass
    row += 1

    # Blank line
    row += 1

    # Project rows (70 cols wide, centered)
    row_w = 70
    rpad = max(0, (w - row_w) // 2)
    total = len(projects) + 1  # +1 for New Project

    if not projects:
        msg = "No projects yet  \u00b7  press n to create one"
        mx = max(0, (w - len(msg)) // 2)
        if row < h - 1:
            try:
                stdscr.addstr(row, mx, msg, curses.color_pair(3) | curses.A_DIM)
            except curses.error:
                pass
        row += 1
    else:
        for i, proj in enumerate(projects):
            if row >= h - 1:
                break
            name = (proj.get("name") or "")[:28]
            stack = (proj.get("stack") or "")[:18]
            line = f"  {'◆' if i == sel else ' '}  {name:<28}  {stack:<18}  "
            line = line[:row_w]

            if i == sel:
                attr = curses.A_REVERSE | curses.A_BOLD
            else:
                attr = curses.color_pair(3) | curses.A_DIM

            try:
                stdscr.addstr(row, rpad, line, attr)
            except curses.error:
                pass
            row += 1

    # Blank line
    row += 1

    # Thin separator
    if row < h - 1:
        try:
            stdscr.addstr(row, rpad, "\u2500" * min(row_w, w - rpad - 1), curses.color_pair(3))
        except curses.error:
            pass
    row += 1

    # New Project row
    new_proj_idx = len(projects)
    new_line = f"  {'◆' if sel == new_proj_idx else '+'}  {'New Project':<{row_w - 6}}"
    new_line = new_line[:row_w]
    if row < h - 1:
        if sel == new_proj_idx:
            try:
                stdscr.addstr(row, rpad, new_line, curses.A_REVERSE | curses.color_pair(5) | curses.A_BOLD)
            except curses.error:
                pass
        else:
            try:
                stdscr.addstr(row, rpad, new_line, curses.color_pair(5) | curses.A_DIM)
            except curses.error:
                pass
    row += 1

    # 2 blank lines
    row += 2

    # Bottom separator
    if row < h - 1:
        try:
            stdscr.addstr(row, sep_x, "\u2500" * sep_w, curses.color_pair(3))
        except curses.error:
            pass
    row += 1

    # Hints
    hints = "\u2191\u2193 navigate   \u21b5 launch   n new   q quit"
    if not daemon_ok:
        hints += "   [daemon offline]"
    hx = max(0, (w - len(hints)) // 2)
    if row < h - 1:
        try:
            stdscr.addstr(row, hx, hints, curses.color_pair(3) | curses.A_DIM)
        except curses.error:
            pass

    stdscr.refresh()


def run_wizard(projects: list[dict]) -> bool:
    """
    Run the new project wizard outside of curses.
    Returns True if a project was created and claude launched (execvp called).
    Returns False if cancelled.
    """
    curses.endwin()

    print("\n  \u25c6 AURAMAXING  \u2014  New Project\n")
    try:
        name = input("  Project name: ").strip()
    except (EOFError, KeyboardInterrupt):
        name = ""

    if not name:
        print("  (cancelled)")
        time.sleep(0.8)
        return False

    try:
        stack = input("  Stack / type:  ").strip() or "TypeScript"
    except (EOFError, KeyboardInterrupt):
        stack = "TypeScript"

    slug = name.lower().replace(" ", "-").replace("_", "-")
    proj_path = str(Path.home() / "code" / slug)

    # Create directory and CLAUDE.md
    Path(proj_path).mkdir(parents=True, exist_ok=True)
    claude_md = Path(proj_path) / "CLAUDE.md"
    claude_md.write_text(f"# {name} — Claude Code Configuration\n\n## Stack\n{stack}\n\n## Rules\n- Do what has been asked; nothing more, nothing less\n- NEVER create files unless absolutely necessary\n- ALWAYS prefer editing an existing file to creating a new one\n- ALWAYS read a file before editing it\n- NEVER commit secrets, credentials, or .env files\n")

    # POST to daemon
    daemon_post("/projects", {"name": name, "stack": stack, "path": proj_path})

    # Save to fallback file
    fallback = load_fallback_projects()
    if not any(p.get("path") == proj_path for p in fallback):
        fallback.append({"name": name, "stack": stack, "path": proj_path, "cost_today": 0})
        save_fallback_projects(fallback)

    print(f"\n  \u2713  {name}  created at {proj_path}\n")
    time.sleep(0.4)

    os.chdir(proj_path)
    os.execvp("claude", ["claude"])
    return True  # unreachable


def launch_project(stdscr, proj: dict) -> None:
    """Launch claude for the given project."""
    path = proj.get("path") or str(Path.home())
    if not os.path.isdir(path):
        slug = (proj.get("name") or "").lower().replace(" ", "-")
        path = str(Path.home() / "code" / slug)
    if not os.path.isdir(path):
        path = str(Path.home())

    # Fetch context from daemon
    ctx = daemon_get(f"/context?cwd={urllib.parse.quote(path)}", timeout=1.0)
    if ctx and ctx.get("context"):
        context_dir = Path(path) / ".claude"
        context_dir.mkdir(parents=True, exist_ok=True)
        (context_dir / "context.md").write_text(ctx["context"])

    curses.endwin()
    os.chdir(path)
    os.execvp("claude", ["claude"])


def main(stdscr):
    """Main curses entry point."""
    curses.curs_set(0)
    stdscr.keypad(True)
    stdscr.timeout(100)

    init_colors()

    projects, daemon_ok = fetch_projects()
    sel = 0
    total = len(projects) + 1

    while True:
        draw_screen(stdscr, projects, sel, daemon_ok)

        try:
            key = stdscr.getch()
        except KeyboardInterrupt:
            break

        if key == -1:
            continue

        total = len(projects) + 1

        if key in (curses.KEY_UP, ord("k")):
            sel = (sel - 1) % total

        elif key in (curses.KEY_DOWN, ord("j")):
            sel = (sel + 1) % total

        elif key in (curses.KEY_ENTER, ord("\n"), ord("\r")):
            if sel == len(projects):
                # New project
                run_wizard(projects)
                # If we get here, wizard was cancelled — reinit
                projects, daemon_ok = fetch_projects()
                sel = 0
            else:
                launch_project(stdscr, projects[sel])
                # If we return (execvp failed), reload
                projects, daemon_ok = fetch_projects()
                sel = 0

        elif key in (ord("n"), ord("N")):
            run_wizard(projects)
            # If cancelled, reinit
            projects, daemon_ok = fetch_projects()
            sel = 0

        elif key in (ord("r"), ord("R")):
            projects, daemon_ok = fetch_projects()
            sel = 0

        elif key in (ord("q"), ord("Q")):
            break


# Import urllib.parse for URL encoding
import urllib.parse

if __name__ == "__main__":
    curses.wrapper(main)
