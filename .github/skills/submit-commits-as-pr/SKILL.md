---
name: submit-commits-as-pr
description: Submit a single commit or a range of commits as a new GitHub pull request. Cherry-picks the commits onto a fresh branch based on the latest origin/main, rebases, pushes, and opens the PR via the gh CLI — then switches back to the original branch. If a merge conflict occurs, pauses and asks the user to resolve it. Use when the user asks to "open a PR for this commit", "send commits X..Y as a PR", "PR-ify these commits", or similar.
---

# Submit Commits as a PR

Turn one or more existing commits on your current branch into a clean pull
request branched off the latest `origin/main`. Almost all of the heavy
lifting lives in `scripts/submit_commits_as_pr.py`; your job is to invoke
it correctly, decide what to do when it pauses, and report the outcome to
the user.

## When to use this skill

Trigger on requests like:

- "Open a PR for commit `abc123`."
- "Submit commits `abc123..def456` as a PR."
- "PR-ify the last 3 commits on this branch."
- "Send these commits upstream as a draft PR."
- "Submit this commit as a PR with auto-merge."

Do **not** use this skill to author new commits — use the `impl` skill for
that. This skill only republishes commits that already exist.

## Required inputs (ask if missing)

Before running, make sure you know:

1. **Which commits** — a single SHA, a comma-separated list, or a range
   (`A..B` or `A^..B`). For "the last N commits", resolve to `HEAD~N..HEAD`.
2. **Base branch** — defaults to `main`. Ask only if the repo clearly uses
   a different default (e.g. `master`, `develop`).
3. **PR title / body** — optional. If the user didn't supply them, let
   `gh pr create --fill` derive them from the commit message.
4. **Draft?** — only if the user mentions "draft" or "WIP".

If the working tree is dirty, ask the user to commit or stash first; the
script refuses to run otherwise.

## How to invoke

The script has three subcommands: `start`, `continue`, `abort`.

### Start

```bash
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start <commits> [options]
```

Useful options:

| Flag | Purpose |
|------|---------|
| `--branch <name>` | Override the auto-generated `pr/<short>-<slug>` branch name |
| `--base <branch>` | Base branch (default `main`) |
| `--remote <name>` | Remote name (default `origin`) |
| `--title <t>` / `--body <b>` | PR metadata (otherwise `gh --fill` is used) |
| `--draft` | Open as draft |
| `--gh-arg <arg>` | Pass an extra arg through to `gh pr create` (repeat as needed, e.g. `--gh-arg --reviewer --gh-arg alice`) |
| `--auto-merge` | Enable auto-merge after the PR is created |
| `--merge-method <method>` | Merge method for auto-merge: `merge` (default), `squash`, or `rebase` |

Examples:

```bash
# Single commit
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start abc1234

# Range
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start origin/main..HEAD

# Last 3 commits, draft PR with custom title
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start HEAD~3..HEAD \
    --draft --title "Refactor task queue retry path"

# Single commit with auto-merge enabled
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start abc1234 \
    --auto-merge --merge-method merge
```

### Continue (after a conflict)

If the script paused on a conflict, the user fixes the files (and
`git add`s them), then run:

```bash
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py continue
```

Do **not** call `git cherry-pick --continue` or `git rebase --continue`
yourself — the script does that.

### Abort

If the user wants to bail out mid-flight:

```bash
python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py abort
```

This aborts any in-progress cherry-pick/rebase, deletes the work branch,
switches back to the original branch, and removes the state file.

## What the script does, end to end

1. Verifies the working tree is clean and remembers the current branch.
2. Resolves the commit spec into an ordered list of full SHAs.
3. `git fetch <remote> <base>` to refresh the base ref.
4. Creates a fresh branch from `<remote>/<base>` (auto-named `pr/<short>-<slug>` if not provided).
5. Cherry-picks each commit in order. On conflict → emit a `conflict` status and exit `2`.
6. Rebases onto `<remote>/<base>` (usually a no-op, but guards against races). On conflict → pause as above.
7. `git push -u <remote> <new-branch>`.
8. `gh pr create` with the chosen options.
9. If `--auto-merge` is set, run `gh pr merge --auto --<method>` on the new PR.
10. `git checkout <original-branch>` and removes the state file.

State (remaining commits, current phase, PR metadata, branch names) is
persisted in `.git/submit_commits_as_pr.state.json` so `--continue` picks up
exactly where the conflict happened.

## Interpreting the output

The script logs human-readable progress to **stderr** and emits structured
status lines to **stdout** prefixed with `JSON: `. The key statuses are:

- `JSON: {"status": "conflict", "phase": "cherry-pick", "commit": "<sha>", "detail": "..."}` — pause and ask the user to resolve.
- `JSON: {"status": "conflict", "phase": "rebase", "detail": "..."}` — same, but during the rebase step.
- `JSON: {"status": "error", "reason": "<reason>", ...}` — surface the error to the user verbatim.
- `JSON: {"status": "done", "pr_url": "...", "new_branch": "...", "original_branch": "..."}` — success. Report the PR URL to the user.
- `JSON: {"status": "aborted", ...}` — `abort` completed.

A non-zero exit code other than `2` means a hard failure; `2` specifically
means "paused on conflict, awaiting user resolution".

## Conflict handling — what you should say to the user

When you see a `conflict` status:

1. Tell the user **which commit** is being cherry-picked (or that the rebase is conflicting).
2. Ask them to resolve the conflict in their editor and `git add` the resolved files. They should **not** run `git cherry-pick --continue` themselves.
3. Once they confirm, run the `continue` subcommand.
4. If they want to give up, run `abort`.

## Prerequisites

- `git` available on PATH.
- `gh` (GitHub CLI) installed and authenticated (`gh auth status`).
- `python` 3.8+ on PATH (no third-party packages required — standard library only).
- A clean working tree.
- A remote (default `origin`) that points at the GitHub repo where the PR should land.

## Notes & limits

- The script never touches commits on the original branch; it only reads them.
- If the auto-generated branch name collides, a numeric suffix is appended (`pr/abc1234-fix-foo-2`).
- `--title` / `--body` win over `gh --fill`. If neither is set, gh derives them from the first commit.
- The state file lives in `.git/`, so it's automatically ignored by Git.
- No support yet for stacked PRs or for editing commit messages on the way through — submit the commits as-is, or amend them locally first.
