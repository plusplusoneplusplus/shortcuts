#!/usr/bin/env python3
"""Self-contained tests for resolve_commits() order-independence.

Builds a tiny temporary git repo with a linear chain of commits and verifies
that resolve_commits() always returns SHAs oldest-first, regardless of the
order in which comma-separated SHAs are supplied.

Run directly:  python3 test_resolve_commits.py
Or with pytest: pytest test_resolve_commits.py
"""

from __future__ import annotations

import contextlib
import io
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


class RunOutputEchoTest(unittest.TestCase):
    """run() must echo a child's stdout/stderr only on failure or when
    SUBMIT_PR_VERBOSE=1 — never on a successful (returncode 0) command.

    Quieting successful output keeps the wrapper's combined output small enough
    to survive the agent harness's output cap, so the trailing `JSON: {…}`
    success line the chat's PR-banner detection keys on is not truncated away.
    """

    # Tokens are passed to the child via the environment so they appear only in
    # the child's OUTPUT, never in the `$ <cmd>` breadcrumb (which echoes the
    # command source — that references the env var names, not their values).
    OUT_TOKEN = "STDOUT_ECHO_TOKEN_9f3a1c"
    ERR_TOKEN = "STDERR_ECHO_TOKEN_9f3a1c"

    def setUp(self) -> None:
        self._saved_env = {
            k: os.environ.get(k)
            for k in ("SUBMIT_PR_ECHO_OUT", "SUBMIT_PR_ECHO_ERR", "SUBMIT_PR_VERBOSE")
        }
        os.environ["SUBMIT_PR_ECHO_OUT"] = self.OUT_TOKEN
        os.environ["SUBMIT_PR_ECHO_ERR"] = self.ERR_TOKEN
        os.environ.pop("SUBMIT_PR_VERBOSE", None)

    def tearDown(self) -> None:
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _cmd(self, exit_code: int) -> list[str]:
        code = (
            "import os, sys; "
            "sys.stdout.write(os.environ['SUBMIT_PR_ECHO_OUT']); "
            "sys.stderr.write(os.environ['SUBMIT_PR_ECHO_ERR']); "
            "sys.exit({})".format(exit_code)
        )
        return [sys.executable, "-c", code]

    def _run_capturing_log(self, *, exit_code: int, check: bool):
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            result = mod.run(self._cmd(exit_code), check=check)
        return buf.getvalue(), result

    def test_success_does_not_echo_child_output(self) -> None:
        logged, result = self._run_capturing_log(exit_code=0, check=True)
        # Still captured for the script's own parsing (git_out, gh URL read)…
        self.assertIn(self.OUT_TOKEN, result.stdout)
        self.assertIn(self.ERR_TOKEN, result.stderr)
        # …but NOT echoed to the log on success.
        self.assertNotIn(self.OUT_TOKEN, logged)
        self.assertNotIn(self.ERR_TOKEN, logged)
        # The `$ <cmd>` breadcrumb is always kept.
        self.assertIn("$ ", logged)

    def test_failure_echoes_child_output(self) -> None:
        # check=False so the non-zero exit does not raise before we inspect.
        logged, _ = self._run_capturing_log(exit_code=3, check=False)
        self.assertIn(self.OUT_TOKEN, logged)
        self.assertIn(self.ERR_TOKEN, logged)

    def test_verbose_env_echoes_child_output_on_success(self) -> None:
        os.environ["SUBMIT_PR_VERBOSE"] = "1"
        logged, _ = self._run_capturing_log(exit_code=0, check=True)
        self.assertIn(self.OUT_TOKEN, logged)
        self.assertIn(self.ERR_TOKEN, logged)


if __name__ == "__main__":
    unittest.main()
