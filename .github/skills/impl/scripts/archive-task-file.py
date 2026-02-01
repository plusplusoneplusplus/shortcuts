#!/usr/bin/env python3

"""Archive a task/plan file under .vscode/.

Moves the task file to .vscode/tasks/archive/<filename> *only if* the file is located
under <workspaceRoot>/.vscode/. If the file is outside .vscode/, this is a no-op.

Usage:
  python3 .github/skills/impl/scripts/archive-task-file.py --task <path> [--workspace <workspaceRoot>]
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


def is_subpath(child: Path, parent: Path) -> bool:
    """Return True if child is inside parent (and not equal to parent)."""
    try:
        rel = child.resolve().relative_to(parent.resolve())
    except Exception:
        return False
    return str(rel) != "."


def unique_dest(dest: Path) -> Path:
    if not dest.exists():
        return dest

    stem = dest.stem
    suffix = dest.suffix
    for n in range(1, 1000):
        candidate = dest.with_name(f"{stem} ({n}){suffix}")
        if not candidate.exists():
            return candidate

    raise RuntimeError(f"Could not find unique archive filename for: {dest}")


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--task", required=True, help="Path to the task file")
    parser.add_argument(
        "--workspace",
        default=os.getcwd(),
        help="Workspace root (default: current working directory)",
    )

    args = parser.parse_args()

    workspace_root = Path(args.workspace).expanduser().resolve()
    task_path = Path(args.task).expanduser()
    task_abs = (workspace_root / task_path).resolve() if not task_path.is_absolute() else task_path.resolve()

    if not task_abs.exists():
        print(f"Task file not found: {task_abs}")
        return 2

    vscode_root = workspace_root / ".vscode"
    if not is_subpath(task_abs, vscode_root):
        print(f"Skip: task is not under .vscode/: {task_abs}")
        return 0

    archive_dir = vscode_root / "tasks" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    dest = unique_dest(archive_dir / task_abs.name)

    # shutil.move uses rename when possible, and falls back to copy+delete across devices.
    shutil.move(str(task_abs), str(dest))
    print(f"Archived: {task_abs} -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
