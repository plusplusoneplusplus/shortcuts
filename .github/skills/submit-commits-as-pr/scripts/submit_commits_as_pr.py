#!/usr/bin/env python3
"""Submit a commit or commit range as a GitHub PR.

Workflow:
    1. Snapshot the current branch.
    2. Resolve the user-supplied commit(s) into an ordered list.
    3. Fetch the latest base ref (default: origin/main).
    4. Create a new branch from the base ref.
    5. Cherry-pick each commit onto the new branch.
    6. (Optional) Rebase onto the latest base ref to be safe.
    7. Push the branch.
    8. Create a PR via the `gh` CLI.
    9. Switch back to the original branch.

If a cherry-pick or rebase produces a merge conflict, the script writes a
state file (.git/submit_commits_as_pr.state.json) and exits with code 2 so
the caller (typically the AI agent) can pause, ask the human to resolve the
conflict, and then re-run the script with `--continue`.

The script is intentionally chatty (everything to stderr) and structured
(machine-readable JSON status messages on stdout, prefixed with `JSON: `)
so an automated caller can drive it reliably.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable


STATE_FILENAME = "submit_commits_as_pr.state.json"


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def emit(status: str, **kwargs: object) -> None:
    """Emit a machine-readable status line on stdout."""
    payload = {"status": status, **kwargs}
    print("JSON: " + json.dumps(payload, sort_keys=True), flush=True)


def run(
    cmd: list[str],
    *,
    check: bool = True,
    capture: bool = True,
    cwd: str | None = None,
) -> subprocess.CompletedProcess[str]:
    log("$ " + " ".join(cmd))
    result = subprocess.run(
        cmd,
        check=False,
        text=True,
        capture_output=capture,
        cwd=cwd,
    )
    if capture:
        if result.stdout:
            log(result.stdout.rstrip())
        if result.stderr:
            log(result.stderr.rstrip())
    if check and result.returncode != 0:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(cmd)}"
        )
    return result


def git(*args: str, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    return run(["git", *args], check=check, capture=capture)


def git_out(*args: str) -> str:
    return git(*args).stdout.strip()


def repo_root() -> Path:
    return Path(git_out("rev-parse", "--show-toplevel"))


def state_path() -> Path:
    return repo_root() / ".git" / STATE_FILENAME


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


@dataclass
class State:
    original_branch: str
    new_branch: str
    base_ref: str
    remote: str
    commits: list[str]
    title: str | None = None
    body: str | None = None
    draft: bool = False
    auto_merge: bool = False
    merge_method: str = "merge"  # merge | squash | rebase
    pushed: bool = False
    pr_url: str | None = None
    phase: str = "cherry-pick"  # cherry-pick | rebase | push | pr | auto-merge | done
    extra_gh_args: list[str] = field(default_factory=list)

    def save(self) -> None:
        state_path().write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls) -> "State":
        if not state_path().exists():
            raise SystemExit(
                "no in-progress submit found "
                f"({state_path()} missing); cannot --continue"
            )
        data = json.loads(state_path().read_text())
        return cls(**data)

    def clear(self) -> None:
        try:
            state_path().unlink()
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------


def ensure_clean_worktree() -> None:
    status = git_out("status", "--porcelain")
    if status:
        emit("error", reason="dirty-worktree", detail=status)
        raise SystemExit(
            "working tree is dirty; commit or stash changes before submitting"
        )


def current_branch() -> str:
    name = git_out("rev-parse", "--abbrev-ref", "HEAD")
    if name == "HEAD":
        raise SystemExit("HEAD is detached; checkout a branch first")
    return name


def resolve_commits(spec: str) -> list[str]:
    """Resolve a single SHA, comma-separated SHAs, or a `A..B` range
    into an ordered list of full commit SHAs (oldest first)."""
    spec = spec.strip()
    if not spec:
        raise SystemExit("empty commit spec")

    if ".." in spec:
        # Range form: defer to git rev-list, reverse so it's oldest-first.
        out = git_out("rev-list", "--reverse", spec)
        commits = [line.strip() for line in out.splitlines() if line.strip()]
    elif "," in spec:
        commits = []
        for token in spec.split(","):
            token = token.strip()
            if not token:
                continue
            commits.append(git_out("rev-parse", token))
    else:
        commits = [git_out("rev-parse", spec)]

    if not commits:
        raise SystemExit(f"commit spec resolved to zero commits: {spec}")
    return commits


def branch_exists(name: str) -> bool:
    res = git("rev-parse", "--verify", "--quiet", f"refs/heads/{name}", check=False)
    return res.returncode == 0


def derive_branch_name(commits: list[str]) -> str:
    short = git_out("rev-parse", "--short", commits[0])
    subject = git_out("log", "-1", "--pretty=%s", commits[0])
    slug_chars: list[str] = []
    for ch in subject.lower():
        if ch.isalnum():
            slug_chars.append(ch)
        elif ch in (" ", "-", "_", "/"):
            slug_chars.append("-")
    slug = "".join(slug_chars).strip("-")
    slug = "-".join(filter(None, slug.split("-")))[:40].strip("-")
    base = f"pr/{short}" + (f"-{slug}" if slug else "")
    candidate = base
    i = 2
    while branch_exists(candidate):
        candidate = f"{base}-{i}"
        i += 1
    return candidate


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------


def do_cherry_pick(state: State, *, resume: bool = False) -> None:
    if resume:
        # User claims they resolved conflicts; let git finish the in-progress pick.
        result = git("cherry-pick", "--continue", check=False, capture=True)
        if result.returncode != 0:
            emit(
                "conflict",
                phase="cherry-pick",
                detail="cherry-pick --continue failed; resolve and re-run --continue",
            )
            state.save()
            raise SystemExit(2)
        # Drop the commit that was being applied from the queue if we have one in flight.
        # We track remaining commits in state.commits; pop the first.
        if state.commits:
            state.commits = state.commits[1:]

    while state.commits:
        sha = state.commits[0]
        log(f"cherry-picking {sha}")
        result = git("cherry-pick", sha, check=False, capture=True)
        if result.returncode != 0:
            emit(
                "conflict",
                phase="cherry-pick",
                commit=sha,
                detail=(
                    "merge conflict during cherry-pick; resolve in the working "
                    "tree, then re-run this script with --continue"
                ),
            )
            state.save()
            raise SystemExit(2)
        state.commits = state.commits[1:]
        state.save()

    state.phase = "rebase"
    state.save()


def do_rebase(state: State, *, resume: bool = False) -> None:
    target = f"{state.remote}/{state.base_ref}"
    if resume:
        result = git("rebase", "--continue", check=False, capture=True)
        if result.returncode != 0:
            emit(
                "conflict",
                phase="rebase",
                detail="rebase --continue failed; resolve and re-run --continue",
            )
            state.save()
            raise SystemExit(2)
    else:
        # Already cherry-picked onto target, so this is usually a no-op,
        # but it guards against the base ref moving while we were resolving conflicts.
        git("fetch", state.remote, state.base_ref)
        result = git("rebase", target, check=False, capture=True)
        if result.returncode != 0:
            emit(
                "conflict",
                phase="rebase",
                detail=(
                    f"merge conflict while rebasing onto {target}; resolve, then "
                    "re-run this script with --continue"
                ),
            )
            state.save()
            raise SystemExit(2)

    state.phase = "push"
    state.save()


def do_push(state: State) -> None:
    git("push", "-u", state.remote, state.new_branch)
    state.pushed = True
    state.phase = "pr"
    state.save()


def do_pr(state: State) -> None:
    if not shutil.which("gh"):
        emit("error", reason="gh-missing")
        raise SystemExit(
            "`gh` CLI not found; install it (https://cli.github.com) and re-run --continue"
        )

    cmd = [
        "gh",
        "pr",
        "create",
        "--base",
        state.base_ref,
        "--head",
        state.new_branch,
    ]
    if state.title:
        cmd += ["--title", state.title]
    else:
        cmd += ["--fill"]
    if state.body:
        cmd += ["--body", state.body]
    if state.draft:
        cmd += ["--draft"]
    cmd += state.extra_gh_args

    result = run(cmd, check=False, capture=True)
    if result.returncode != 0:
        emit("error", reason="gh-failed", detail=result.stderr.strip())
        raise SystemExit(result.returncode)

    url = (result.stdout or "").strip().splitlines()[-1] if result.stdout else None
    state.pr_url = url
    state.phase = "auto-merge" if state.auto_merge else "done"
    state.save()


def do_auto_merge(state: State) -> None:
    if not shutil.which("gh"):
        log("warning: gh not found, skipping auto-merge")
        state.phase = "done"
        state.save()
        return

    cmd = ["gh", "pr", "merge", state.pr_url, "--auto", f"--{state.merge_method}"]
    result = run(cmd, check=False, capture=True)
    if result.returncode != 0:
        log(f"warning: auto-merge failed: {result.stderr.strip()}")
    state.phase = "done"
    state.save()


def finalize(state: State) -> None:
    log(f"switching back to {state.original_branch}")
    git("checkout", state.original_branch)
    emit(
        "done",
        pr_url=state.pr_url,
        new_branch=state.new_branch,
        original_branch=state.original_branch,
    )
    state.clear()


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def cmd_start(args: argparse.Namespace) -> None:
    if state_path().exists():
        raise SystemExit(
            f"an in-progress submit already exists ({state_path()}); "
            "run with --continue or --abort first"
        )

    ensure_clean_worktree()
    original = current_branch()
    commits = resolve_commits(args.commits)
    log(f"resolved {len(commits)} commit(s): {', '.join(c[:8] for c in commits)}")

    branch = args.branch or derive_branch_name(commits)
    if branch_exists(branch):
        raise SystemExit(f"branch already exists: {branch}")

    log(f"fetching {args.remote}/{args.base}")
    git("fetch", args.remote, args.base)

    log(f"creating branch {branch} from {args.remote}/{args.base}")
    git("checkout", "-b", branch, f"{args.remote}/{args.base}")

    state = State(
        original_branch=original,
        new_branch=branch,
        base_ref=args.base,
        remote=args.remote,
        commits=commits,
        title=args.title,
        body=args.body,
        draft=args.draft,
        auto_merge=args.auto_merge,
        merge_method=args.merge_method,
        extra_gh_args=list(args.gh_arg or []),
    )
    state.save()

    drive(state, resume=False)


def cmd_continue(_: argparse.Namespace) -> None:
    state = State.load()
    log(f"resuming from phase: {state.phase}")
    drive(state, resume=True)


def cmd_abort(_: argparse.Namespace) -> None:
    state = State.load()
    log("aborting in-progress submit")

    # Best-effort: abort any in-progress cherry-pick/rebase.
    git("cherry-pick", "--abort", check=False, capture=True)
    git("rebase", "--abort", check=False, capture=True)

    # Switch back and delete the work branch if it exists.
    try:
        git("checkout", state.original_branch, check=False, capture=True)
    except Exception:  # noqa: BLE001
        pass

    if branch_exists(state.new_branch):
        git("branch", "-D", state.new_branch, check=False, capture=True)

    state.clear()
    emit("aborted", original_branch=state.original_branch, new_branch=state.new_branch)


def drive(state: State, *, resume: bool) -> None:
    phase = state.phase
    first = True
    while True:
        if phase == "cherry-pick":
            do_cherry_pick(state, resume=resume and first)
            phase = state.phase
        elif phase == "rebase":
            do_rebase(state, resume=resume and first)
            phase = state.phase
        elif phase == "push":
            do_push(state)
            phase = state.phase
        elif phase == "pr":
            do_pr(state)
            phase = state.phase
        elif phase == "auto-merge":
            do_auto_merge(state)
            phase = state.phase
        elif phase == "done":
            finalize(state)
            return
        else:
            raise SystemExit(f"unknown phase: {phase}")
        first = False


# ---------------------------------------------------------------------------
# Argparse
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Cherry-pick a commit (or range) onto a new branch off origin/main "
        "and submit it as a GitHub PR.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="Begin a new submit")
    start.add_argument(
        "commits",
        help="Commit SHA, comma-separated SHAs, or range (A..B or A^..B)",
    )
    start.add_argument("--branch", help="New branch name (auto-generated if omitted)")
    start.add_argument("--base", default="main", help="Base branch (default: main)")
    start.add_argument("--remote", default="origin", help="Remote name (default: origin)")
    start.add_argument("--title", help="PR title (defaults to gh --fill)")
    start.add_argument("--body", help="PR body")
    start.add_argument("--draft", action="store_true", help="Open the PR as a draft")
    start.add_argument(
        "--gh-arg",
        action="append",
        help="Extra args passed verbatim to `gh pr create` (repeatable)",
    )
    start.add_argument(
        "--auto-merge",
        action="store_true",
        help="Enable auto-merge on the PR after creation (requires branch protection rules)",
    )
    start.add_argument(
        "--merge-method",
        default="merge",
        choices=["merge", "squash", "rebase"],
        help="Merge method for auto-merge (default: merge)",
    )
    start.set_defaults(func=cmd_start)

    cont = sub.add_parser("continue", help="Resume after resolving a conflict")
    cont.set_defaults(func=cmd_continue)

    ab = sub.add_parser("abort", help="Abort an in-progress submit and clean up")
    ab.set_defaults(func=cmd_abort)

    return p


def main(argv: Iterable[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    args.func(args)


if __name__ == "__main__":
    main()
