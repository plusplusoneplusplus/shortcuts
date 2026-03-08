#!/usr/bin/env python3

"""Tests for archive-task-file.py."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from unittest import mock

import pytest

# Import the module under test
sys.path.insert(0, str(Path(__file__).parent))
import importlib
archive_mod = importlib.import_module("archive-task-file")

is_subpath = archive_mod.is_subpath
unique_dest = archive_mod.unique_dest
find_coc_tasks_root = archive_mod.find_coc_tasks_root
main = archive_mod.main


# ── is_subpath ──────────────────────────────────────────────────────

class TestIsSubpath:
    def test_child_inside_parent(self, tmp_path: Path):
        parent = tmp_path / "a"
        child = parent / "b" / "c.txt"
        parent.mkdir()
        (parent / "b").mkdir()
        child.touch()
        assert is_subpath(child, parent) is True

    def test_same_path_returns_false(self, tmp_path: Path):
        assert is_subpath(tmp_path, tmp_path) is False

    def test_outside_returns_false(self, tmp_path: Path):
        a = tmp_path / "a"
        b = tmp_path / "b"
        a.mkdir()
        b.mkdir()
        assert is_subpath(a, b) is False


# ── unique_dest ─────────────────────────────────────────────────────

class TestUniqueDest:
    def test_returns_same_if_not_exists(self, tmp_path: Path):
        dest = tmp_path / "plan.md"
        assert unique_dest(dest) == dest

    def test_increments_on_collision(self, tmp_path: Path):
        dest = tmp_path / "plan.md"
        dest.touch()
        result = unique_dest(dest)
        assert result == tmp_path / "plan (1).md"

    def test_increments_twice(self, tmp_path: Path):
        dest = tmp_path / "plan.md"
        dest.touch()
        (tmp_path / "plan (1).md").touch()
        result = unique_dest(dest)
        assert result == tmp_path / "plan (2).md"


# ── find_coc_tasks_root ────────────────────────────────────────────

class TestFindCocTasksRoot:
    def test_file_under_coc_repos_tasks(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        tasks_dir = coc / "repos" / "abc123" / "tasks"
        task_file = tasks_dir / "feat" / "plan.md"
        tasks_dir.mkdir(parents=True)
        (tasks_dir / "feat").mkdir()
        task_file.touch()
        result = find_coc_tasks_root(task_file, coc)
        assert result is not None
        assert result.resolve() == tasks_dir.resolve()

    def test_file_directly_in_tasks(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        tasks_dir = coc / "repos" / "abc123" / "tasks"
        task_file = tasks_dir / "plan.md"
        tasks_dir.mkdir(parents=True)
        task_file.touch()
        result = find_coc_tasks_root(task_file, coc)
        assert result is not None
        assert result.resolve() == tasks_dir.resolve()

    def test_file_not_under_coc(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        coc.mkdir()
        other = tmp_path / "other" / "plan.md"
        other.parent.mkdir()
        other.touch()
        assert find_coc_tasks_root(other, coc) is None

    def test_file_under_repos_but_not_tasks(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        other_dir = coc / "repos" / "abc123" / "config"
        other_dir.mkdir(parents=True)
        f = other_dir / "foo.md"
        f.touch()
        assert find_coc_tasks_root(f, coc) is None


# ── main() integration tests ───────────────────────────────────────

class TestMainLegacyVscode:
    """Legacy .vscode/ path archiving."""

    def test_archives_vscode_task(self, tmp_path: Path):
        vscode = tmp_path / ".vscode" / "tasks" / "feat"
        vscode.mkdir(parents=True)
        task = vscode / "plan.md"
        task.write_text("hello")

        with mock.patch("sys.argv", ["prog", "--task", str(task), "--workspace", str(tmp_path)]):
            rc = main()

        assert rc == 0
        assert not task.exists()
        archived = tmp_path / ".vscode" / "tasks" / "archive" / "plan.md"
        assert archived.exists()
        assert archived.read_text() == "hello"

    def test_skip_outside_vscode(self, tmp_path: Path):
        other = tmp_path / "somewhere" / "plan.md"
        other.parent.mkdir(parents=True)
        other.write_text("hello")

        with mock.patch("sys.argv", [
            "prog", "--task", str(other),
            "--workspace", str(tmp_path),
            "--coc-data-dir", str(tmp_path / "no-coc"),
        ]):
            rc = main()

        assert rc == 0
        assert other.exists()  # not moved

    def test_file_not_found(self, tmp_path: Path):
        with mock.patch("sys.argv", ["prog", "--task", str(tmp_path / "missing.md"), "--workspace", str(tmp_path)]):
            rc = main()
        assert rc == 2


class TestMainCocTasks:
    """Modern ~/.coc/repos/<repoId>/tasks/ archiving."""

    def test_archives_coc_task(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        tasks_dir = coc / "repos" / "a1b2c3d4" / "tasks" / "feat"
        tasks_dir.mkdir(parents=True)
        task = tasks_dir / "plan.md"
        task.write_text("content")

        with mock.patch("sys.argv", [
            "prog", "--task", str(task),
            "--workspace", str(tmp_path),
            "--coc-data-dir", str(coc),
        ]):
            rc = main()

        assert rc == 0
        assert not task.exists()
        archived = coc / "repos" / "a1b2c3d4" / "tasks" / "archive" / "plan.md"
        assert archived.exists()
        assert archived.read_text() == "content"

    def test_archives_coc_task_at_tasks_root(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        tasks_dir = coc / "repos" / "abc123" / "tasks"
        tasks_dir.mkdir(parents=True)
        task = tasks_dir / "notes.md"
        task.write_text("notes")

        with mock.patch("sys.argv", [
            "prog", "--task", str(task),
            "--workspace", str(tmp_path),
            "--coc-data-dir", str(coc),
        ]):
            rc = main()

        assert rc == 0
        assert not task.exists()
        archived = tasks_dir / "archive" / "notes.md"
        assert archived.exists()

    def test_unique_dest_on_collision(self, tmp_path: Path):
        coc = tmp_path / ".coc"
        tasks_dir = coc / "repos" / "abc123" / "tasks"
        archive_dir = tasks_dir / "archive"
        archive_dir.mkdir(parents=True)
        (archive_dir / "plan.md").write_text("old")

        feat_dir = tasks_dir / "feat"
        feat_dir.mkdir()
        task = feat_dir / "plan.md"
        task.write_text("new")

        with mock.patch("sys.argv", [
            "prog", "--task", str(task),
            "--workspace", str(tmp_path),
            "--coc-data-dir", str(coc),
        ]):
            rc = main()

        assert rc == 0
        assert (archive_dir / "plan (1).md").exists()
        assert (archive_dir / "plan (1).md").read_text() == "new"

    def test_coc_takes_priority_over_vscode(self, tmp_path: Path):
        """If a file is under both .coc and .vscode (unusual), .coc wins."""
        # This wouldn't happen in practice, but tests priority ordering
        coc = tmp_path / ".vscode"  # pathological: coc data dir = .vscode
        tasks_dir = coc / "repos" / "abc" / "tasks"
        tasks_dir.mkdir(parents=True)
        task = tasks_dir / "plan.md"
        task.write_text("data")

        with mock.patch("sys.argv", [
            "prog", "--task", str(task),
            "--workspace", str(tmp_path),
            "--coc-data-dir", str(coc),
        ]):
            rc = main()

        assert rc == 0
        # Should archive under .coc pattern (repos/<id>/tasks/archive/), not .vscode/tasks/archive/
        archived = tasks_dir / "archive" / "plan.md"
        assert archived.exists()
