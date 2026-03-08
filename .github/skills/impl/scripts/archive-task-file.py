#!/usr/bin/env python3

"""Archive a task/plan file.

Supports two task locations:
  1. Legacy:  <workspace>/.vscode/  → archives to .vscode/tasks/archive/
  2. Modern:  <cocDataDir>/repos/<repoId>/tasks/  → archives to <same>/archive/

If the file is in neither location, this is a no-op.

Usage:
  python3 .github/skills/impl/scripts/archive-task-file.py --task <path> [--workspace <root>] [--coc-data-dir <dir>]
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


def find_coc_tasks_root(task_abs: Path, coc_data_dir: Path) -> Path | None:
    """If task_abs is under <cocDataDir>/repos/<repoId>/tasks/, return that tasks dir."""
    repos_dir = coc_data_dir.resolve() / "repos"
    if not is_subpath(task_abs, repos_dir):
        return None
    # Walk up from the file to find a 'tasks' directory under repos/<repoId>/
    try:
        rel = task_abs.resolve().relative_to(repos_dir)
    except Exception:
        return None
    parts = rel.parts  # e.g. ('a1b2c3d4', 'tasks', 'feat', 'plan.md')
    if len(parts) >= 3 and parts[1] == "tasks":
        return repos_dir / parts[0] / "tasks"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--task", required=True, help="Path to the task file")
    parser.add_argument(
        "--workspace",
        default=os.getcwd(),
        help="Workspace root (default: current working directory)",
    )
    parser.add_argument(
        "--coc-data-dir",
        default=os.path.join(Path.home(), ".coc"),
        help="CoC data directory (default: ~/.coc)",
    )

    args = parser.parse_args()

    workspace_root = Path(args.workspace).expanduser().resolve()
    coc_data_dir = Path(args.coc_data_dir).expanduser().resolve()
    task_path = Path(args.task).expanduser()
    task_abs = (workspace_root / task_path).resolve() if not task_path.is_absolute() else task_path.resolve()

    if not task_abs.exists():
        print(f"Task file not found: {task_abs}")
        return 2

    # 1) Check modern location: ~/.coc/repos/<repoId>/tasks/
    coc_tasks_root = find_coc_tasks_root(task_abs, coc_data_dir)
    if coc_tasks_root is not None:
        archive_dir = coc_tasks_root / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        dest = unique_dest(archive_dir / task_abs.name)
        shutil.move(str(task_abs), str(dest))
        print(f"Archived: {task_abs} -> {dest}")
        return 0

    # 2) Check legacy location: <workspace>/.vscode/
    vscode_root = workspace_root / ".vscode"
    if is_subpath(task_abs, vscode_root):
        archive_dir = vscode_root / "tasks" / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        dest = unique_dest(archive_dir / task_abs.name)
        shutil.move(str(task_abs), str(dest))
        print(f"Archived: {task_abs} -> {dest}")
        return 0

    print(f"Skip: task is not under .vscode/ or {coc_data_dir}: {task_abs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
