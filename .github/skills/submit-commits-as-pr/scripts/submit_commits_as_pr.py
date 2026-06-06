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
    9. Enable auto-merge on the PR (default; opt out with --no-auto-merge).
   10. Switch back to the original branch.

Conflict policy: if any cherry-pick or rebase produces a merge conflict,
the script aborts the entire submit — it runs `git cherry-pick --abort`
or `git rebase --abort`, switches back to the original branch, deletes
the work branch, clears state, emits an `aborted` status, and exits
non-zero. AI agents must NOT attempt to resolve merge conflicts on the
user's behalf; the human is expected to rebase / fix the source commits
themselves and re-invoke this skill afresh.

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
    auto_merge: bool = True
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
        tokens = [t.strip() for t in spec.split(",") if t.strip()]
        shas = [git_out("rev-parse", t) for t in tokens]
        wanted = set(shas)
        # Walk the union of the requested commits' histories in topological,
        # oldest-first order, then keep only the requested commits. This makes
        # caller-supplied order (e.g. newest-first from `git log`) irrelevant
        # and stays correct even when commits share identical timestamps.
        out = git_out("rev-list", "--reverse", "--topo-order", *shas)
        commits = [line.strip() for line in out.splitlines() if line.strip() in wanted]
    else:
        commits = [git_out("rev-parse", spec)]

    if not commits:
        raise SystemExit(f"commit spec resolved to zero commits: {spec}")
    return commits


def outgoing_commits(remote: str, base: str) -> list[str]:
    """Return commits on HEAD that are not yet on <remote>/<base>, oldest first."""
    git("fetch", remote, base)
    out = git_out("rev-list", "--reverse", f"{remote}/{base}..HEAD")
    commits = [line.strip() for line in out.splitlines() if line.strip()]
    if not commits:
        raise SystemExit(
            f"no outgoing commits found between {remote}/{base} and HEAD; "
            "nothing to submit"
        )
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


def auto_abort_on_conflict(
    state: State,
    *,
    phase: str,
    detail: str,
    commit: str | None = None,
) -> None:
    """Abort the entire submit when a merge conflict is hit.

    Policy: AI agents must not perform merge-conflict resolution. The user
    should rebase / fix the source commits manually and re-invoke the
    skill afresh. So when a cherry-pick or rebase conflicts, we tear
    everything down: abort the in-progress git operation, switch back to
    the original branch, delete the work branch, clear state, emit an
    `aborted` status, and exit non-zero.
    """
    log(f"merge conflict during {phase}; aborting the entire submit")

    git("cherry-pick", "--abort", check=False, capture=True)
    git("rebase", "--abort", check=False, capture=True)

    try:
        git("checkout", state.original_branch, check=False, capture=True)
    except Exception:  # noqa: BLE001
        pass

    if branch_exists(state.new_branch):
        git("branch", "-D", state.new_branch, check=False, capture=True)

    state.clear()

    payload: dict[str, object] = {
        "reason": f"{phase}-conflict",
        "phase": phase,
        "detail": detail,
        "original_branch": state.original_branch,
        "new_branch": state.new_branch,
    }
    if commit is not None:
        payload["commit"] = commit
    emit("aborted", **payload)
    raise SystemExit(1)


def do_cherry_pick(state: State) -> None:
    while state.commits:
        sha = state.commits[0]
        log(f"cherry-picking {sha}")
        result = git("cherry-pick", sha, check=False, capture=True)
        if result.returncode != 0:
            auto_abort_on_conflict(
                state,
                phase="cherry-pick",
                commit=sha,
                detail=(
                    "merge conflict during cherry-pick; the entire submit "
                    "has been aborted. Rebase or fix the source commits "
                    "manually, then re-invoke the skill."
                ),
            )
        state.commits = state.commits[1:]
        state.save()

    state.phase = "rebase"
    state.save()


def do_rebase(state: State) -> None:
    target = f"{state.remote}/{state.base_ref}"
    # Already cherry-picked onto target, so this is usually a no-op,
    # but it guards against the base ref moving while we were working.
    git("fetch", state.remote, state.base_ref)
    result = git("rebase", target, check=False, capture=True)
    if result.returncode != 0:
        auto_abort_on_conflict(
            state,
            phase="rebase",
            detail=(
                f"merge conflict while rebasing onto {target}; the entire "
                "submit has been aborted. Rebase or fix the source commits "
                "manually, then re-invoke the skill."
            ),
        )

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
    if args.commits:
        commits = resolve_commits(args.commits)
        log(f"resolved {len(commits)} commit(s): {', '.join(c[:8] for c in commits)}")
        log(f"fetching {args.remote}/{args.base}")
        git("fetch", args.remote, args.base)
    else:
        log(f"no commits specified; detecting outgoing commits vs {args.remote}/{args.base}")
        commits = outgoing_commits(args.remote, args.base)
        log(f"found {len(commits)} outgoing commit(s): {', '.join(c[:8] for c in commits)}")

    branch = args.branch or derive_branch_name(commits)
    if branch_exists(branch):
        raise SystemExit(f"branch already exists: {branch}")

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

    drive(state)


def cmd_continue(_: argparse.Namespace) -> None:
    state = State.load()
    log(f"resuming from phase: {state.phase}")
    if state.phase in ("cherry-pick", "rebase"):
        # Should never happen: conflicts auto-abort and clear state. Defend
        # against a corrupt state file rather than silently re-driving the
        # cherry-pick / rebase from scratch.
        raise SystemExit(
            f"refusing to resume from phase {state.phase!r}: cherry-pick and "
            "rebase conflicts now auto-abort, so this state should not exist. "
            "Run `abort` to clean up and start over."
        )
    drive(state)


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


def drive(state: State) -> None:
    phase = state.phase
    while True:
        if phase == "cherry-pick":
            do_cherry_pick(state)
            phase = state.phase
        elif phase == "rebase":
            do_rebase(state)
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
        nargs="?",
        default=None,
        help=(
            "Commit SHA, comma-separated SHAs, or range (A..B or A^..B). "
            "If omitted, defaults to all outgoing commits on HEAD that are "
            "not yet on <remote>/<base>."
        ),
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
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Enable auto-merge on the PR after creation. Default: enabled. "
            "Use --no-auto-merge to opt out. Requires repo-level auto-merge "
            "to be allowed; if it isn't, the script logs a warning but the "
            "PR is still created."
        ),
    )
    start.add_argument(
        "--merge-method",
        default="merge",
        choices=["merge", "squash", "rebase"],
        help="Merge method for auto-merge (default: merge)",
    )
    start.set_defaults(func=cmd_start)

    cont = sub.add_parser(
        "continue",
        help=(
            "Resume after a transient push / `gh pr create` / auto-merge "
            "failure (e.g. missing gh auth). Cherry-pick / rebase conflicts "
            "auto-abort and cannot be resumed."
        ),
    )
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
