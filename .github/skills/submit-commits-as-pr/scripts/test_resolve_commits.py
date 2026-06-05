#!/usr/bin/env python3
"""Self-contained tests for resolve_commits() order-independence.

Builds a tiny temporary git repo with a linear chain of commits and verifies
that resolve_commits() always returns SHAs oldest-first, regardless of the
order in which comma-separated SHAs are supplied.

Run directly:  python3 test_resolve_commits.py
Or with pytest: pytest test_resolve_commits.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import submit_commits_as_pr as mod  # noqa: E402


def _git(*args: str, cwd: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


class ResolveCommitsOrderTest(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        repo = self._tmp.name

        _git("init", "-q", cwd=repo)
        _git("config", "user.email", "test@example.com", cwd=repo)
        _git("config", "user.name", "Test", cwd=repo)
        _git("config", "commit.gpgsign", "false", cwd=repo)

        self.shas: list[str] = []
        # Base commit so the first real commit (c1) has a parent, letting the
        # range form `c1^..c3` resolve.
        (Path(repo) / "base.txt").write_text("base\n")
        _git("add", "-A", cwd=repo)
        _git("commit", "-q", "-m", "base", cwd=repo)
        for i in range(1, 4):
            (Path(repo) / f"f{i}.txt").write_text(f"content {i}\n")
            _git("add", "-A", cwd=repo)
            _git("commit", "-q", "-m", f"commit {i}", cwd=repo)
            self.shas.append(_git("rev-parse", "HEAD", cwd=repo))

        # self.shas is [c1, c2, c3] oldest-first.
        os.chdir(repo)

    def tearDown(self) -> None:
        os.chdir(self._prev_cwd)
        self._tmp.cleanup()

    def test_scrambled_comma_list_is_sorted_oldest_first(self) -> None:
        c1, c2, c3 = self.shas
        spec = f"{c3},{c1},{c2}"
        self.assertEqual(mod.resolve_commits(spec), [c1, c2, c3])

    def test_newest_first_comma_list_is_sorted_oldest_first(self) -> None:
        c1, c2, c3 = self.shas
        spec = f"{c3},{c2},{c1}"
        self.assertEqual(mod.resolve_commits(spec), [c1, c2, c3])

    def test_range_form_matches_comma_form(self) -> None:
        c1, c2, c3 = self.shas
        range_result = mod.resolve_commits(f"{c1}^..{c3}")
        comma_result = mod.resolve_commits(f"{c3},{c1},{c2}")
        self.assertEqual(range_result, [c1, c2, c3])
        self.assertEqual(range_result, comma_result)

    def test_single_sha(self) -> None:
        c1, c2, c3 = self.shas
        self.assertEqual(mod.resolve_commits(c2), [c2])


if __name__ == "__main__":
    unittest.main()
