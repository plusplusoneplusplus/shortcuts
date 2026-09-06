#!/usr/bin/env python3
"""Regression tests for isolated-worktree PR submission."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import submit_commits_as_pr as mod  # noqa: E402


def _git(*args: str, cwd: str | Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, text=True, capture_output=True
    ).stdout.strip()


class WorktreeWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self._previous_cwd = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory(prefix="submit pr tests ")
        root = Path(self._tmp.name)
        self.remote = root / "remote repo.git"
        self.repo = root / "source repo"
        self.repo.mkdir()

        _git("init", "--bare", "-q", str(self.remote), cwd=root)
        _git("init", "-q", "-b", "main", cwd=self.repo)
        _git("config", "user.email", "test@example.com", cwd=self.repo)
        _git("config", "user.name", "Test", cwd=self.repo)
        _git("config", "commit.gpgsign", "false", cwd=self.repo)
        _git("remote", "add", "origin", str(self.remote), cwd=self.repo)

        (self.repo / "shared.txt").write_text("base\n")
        _git("add", "shared.txt", cwd=self.repo)
        _git("commit", "-q", "-m", "base", cwd=self.repo)
        _git("push", "-q", "-u", "origin", "main", cwd=self.repo)
        self.base_sha = _git("rev-parse", "HEAD", cwd=self.repo)
        os.chdir(self.repo)

    def tearDown(self) -> None:
        os.chdir(self._previous_cwd)
        self._tmp.cleanup()

    def _commit(self, content: str = "feature\n") -> str:
        (self.repo / "feature.txt").write_text(content)
        _git("add", "feature.txt", cwd=self.repo)
        _git("commit", "-q", "-m", "feature commit", cwd=self.repo)
        return _git("rev-parse", "HEAD", cwd=self.repo)

    def _args(self, sha: str, branch: str) -> argparse.Namespace:
        return argparse.Namespace(
            commits=sha,
            branch=branch,
            base="main",
            remote="origin",
            title=None,
            body=None,
            draft=False,
            auto_merge=False,
            merge_method="merge",
            gh_arg=None,
        )

    @staticmethod
    def _complete_pr(state: mod.State) -> None:
        state.pr_url = "https://github.com/example/repo/pull/1"
        state.phase = "done"
        state.save()

    def test_submission_preserves_dirty_caller_branch_and_head(self) -> None:
        sha = self._commit()
        branch_before = _git("branch", "--show-current", cwd=self.repo)
        head_before = _git("rev-parse", "HEAD", cwd=self.repo)
        dirty_file = self.repo / "uncommitted file.txt"
        dirty_file.write_text("keep me\n")

        stdout = io.StringIO()
        with mock.patch.object(mod, "do_pr", side_effect=self._complete_pr):
            with contextlib.redirect_stdout(stdout):
                mod.cmd_start(self._args(sha, "pr/test-isolated-worktree"))

        self.assertEqual(_git("branch", "--show-current", cwd=self.repo), branch_before)
        self.assertEqual(_git("rev-parse", "HEAD", cwd=self.repo), head_before)
        self.assertEqual(dirty_file.read_text(), "keep me\n")
        self.assertFalse(mod.state_path().exists())
        payload = json.loads(stdout.getvalue().split("JSON: ")[-1])
        self.assertEqual(payload["commits_submitted"], [sha])
        self.assertEqual(payload["commits_count"], 1)

    def test_state_uses_common_git_directory(self) -> None:
        sha = self._commit()
        captured: list[mod.State] = []

        with mock.patch.object(mod, "drive", side_effect=captured.append):
            mod.cmd_start(self._args(sha, "pr/test-common-state"))

        state = captured[0]
        worktree = Path(state.worktree_path)
        expected = Path(_git("rev-parse", "--git-common-dir", cwd=self.repo)).resolve()
        self.assertEqual(mod.state_path(), expected / mod.STATE_FILENAME)
        os.chdir(worktree)
        self.assertEqual(mod.state_path(), expected / mod.STATE_FILENAME)
        os.chdir(self.repo)
        mod.cmd_abort(argparse.Namespace())

    def test_abort_removes_worktree_and_temporary_branch(self) -> None:
        sha = self._commit()
        captured: list[mod.State] = []
        branch = "pr/test-abort-cleanup"
        with mock.patch.object(mod, "drive", side_effect=captured.append):
            mod.cmd_start(self._args(sha, branch))

        worktree = Path(captured[0].worktree_path)
        mod.cmd_abort(argparse.Namespace())

        self.assertFalse(worktree.exists())
        self.assertFalse(mod.state_path().exists())
        result = subprocess.run(
            ["git", "rev-parse", "--verify", f"refs/heads/{branch}"],
            cwd=self.repo,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(_git("branch", "--show-current", cwd=self.repo), "main")

    def test_continue_loads_persisted_worktree_state(self) -> None:
        sha = self._commit()
        captured: list[mod.State] = []
        with mock.patch.object(mod, "drive", side_effect=captured.append):
            mod.cmd_start(self._args(sha, "pr/test-continue"))

        state = captured[0]
        state.phase = "push"
        state.save()
        resumed: list[mod.State] = []
        with mock.patch.object(mod, "drive", side_effect=resumed.append):
            mod.cmd_continue(argparse.Namespace())

        self.assertEqual(resumed[0].worktree_path, state.worktree_path)
        self.assertEqual(resumed[0].submitted_commits, [sha])
        mod.cmd_abort(argparse.Namespace())

    def test_cherry_pick_conflict_cleans_up_without_moving_caller(self) -> None:
        (self.repo / "shared.txt").write_text("feature\n")
        _git("add", "shared.txt", cwd=self.repo)
        _git("commit", "-q", "-m", "conflicting feature", cwd=self.repo)
        feature_sha = _git("rev-parse", "HEAD", cwd=self.repo)

        _git("reset", "--hard", self.base_sha, cwd=self.repo)
        (self.repo / "shared.txt").write_text("upstream\n")
        _git("add", "shared.txt", cwd=self.repo)
        _git("commit", "-q", "-m", "upstream change", cwd=self.repo)
        _git("push", "-q", "origin", "main", cwd=self.repo)
        caller_head = _git("rev-parse", "HEAD", cwd=self.repo)
        branch = "pr/test-conflict-cleanup"

        with self.assertRaises(SystemExit):
            mod.cmd_start(self._args(feature_sha, branch))

        self.assertEqual(_git("rev-parse", "HEAD", cwd=self.repo), caller_head)
        self.assertEqual(_git("branch", "--show-current", cwd=self.repo), "main")
        self.assertFalse(mod.state_path().exists())
        self.assertFalse(mod.branch_exists(branch))


if __name__ == "__main__":
    unittest.main()
