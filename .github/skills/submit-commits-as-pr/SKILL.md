---
name: submit-commits-as-pr
description: Submit a single commit or a range of commits as a new GitHub pull request. Cherry-picks the commits onto a fresh branch off the latest origin/main, pushes, opens the PR via `gh`, and enables auto-merge by default. On any cherry-pick/rebase conflict the script aborts the entire submit; the AI must NOT attempt to resolve conflicts. Use when the user asks to "open a PR for this commit", "send commits X..Y as a PR", "PR-ify these commits", or similar.
---

# Submit Commits as a PR

Republish existing commits as a clean PR off the latest `origin/main`,
with **auto-merge on by default**. All real work is in
`scripts/submit_commits_as_pr.py`. Don't use this skill to author new
commits — use `impl` for that.

## Inputs (ask only if missing)

1. **Commits** — SHA, comma-separated SHAs, or a range (`A..B`). For
   "last N commits", resolve to `HEAD~N..HEAD`. **If omitted, defaults
   to all outgoing commits on the current branch that are not yet on
   `<remote>/<base>` — do not ask the user for commits unless they want
   to submit a specific subset.**
2. **Base** — defaults to `main`. Ask only if the repo clearly differs.
3. **Title / body** — optional; otherwise `gh pr create --fill` uses the
   commit message.
4. **Draft** — only if user says "draft" / "WIP".
5. **Auto-merge** — on by default. Pass `--no-auto-merge` only if the
   user explicitly asks to leave it open / merge manually. Use
   `--merge-method squash|rebase` if they request that strategy.

The script refuses to run with a dirty worktree — ask the user to
commit/stash first.

## Invocation

```bash
python3 .agents/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start [<commits>] [options]
```

Common options:

| Flag | Purpose |
|------|---------|
| `--branch <name>` | Override auto-generated `pr/<short>-<slug>` |
| `--base <branch>` | Base branch (default `main`) |
| `--remote <name>` | Remote name (default `origin`) |
| `--title <t>` / `--body <b>` | PR metadata |
| `--draft` | Open as draft |
| `--gh-arg <arg>` | Extra arg passed verbatim to `gh pr create` (repeatable, e.g. `--gh-arg --reviewer --gh-arg alice`) |
| `--no-auto-merge` | Disable auto-merge (it's on by default) |
| `--merge-method merge\|squash\|rebase` | Auto-merge method (default `merge`) |

Other subcommands:

- `continue` — only for retrying a transient `git push` / `gh pr create` /
  `gh pr merge --auto` failure (e.g. `gh` not authed). Conflicts cannot
  be resumed.
- `abort` — bail out of an in-progress submit; aborts any cherry-pick /
  rebase, deletes the work branch, restores the original branch, clears
  state.

## What it does

1. Snapshot current branch; require a clean worktree.
2. `git fetch <remote> <base>` and create a fresh branch off `<remote>/<base>`.
3. Cherry-pick each commit in order. **Conflict → auto-abort.**
4. Rebase onto `<remote>/<base>` (race guard). **Conflict → auto-abort.**
5. `git push -u`, `gh pr create`, and (unless `--no-auto-merge`)
   `gh pr merge --auto --<method>`.
6. Switch back to the original branch and remove state.

State lives in `.git/submit_commits_as_pr.state.json` and is removed
automatically on success or auto-abort.

## Output

Stderr is human-readable progress; stdout has `JSON: {...}` status
lines. Statuses you'll see:

- `done` — success. Report `pr_url` to the user.
- `aborted` with `reason: cherry-pick-conflict` or `rebase-conflict` —
  hard abort already cleaned up. Tell the user the conflict killed the
  submit (include the `commit` SHA and base ref) and ask them to rebase
  / fix the source commits and re-invoke. **Do NOT** attempt to resolve
  the conflict, **do NOT** call `git cherry-pick/rebase --continue`, and
  **do NOT** call this script's `continue` subcommand.
- `aborted` from the user-invoked `abort` — cleanup finished.
- `error` with a `reason` (e.g. `dirty-worktree`, `gh-missing`,
  `gh-failed`) — surface verbatim.

Non-zero exit = hard failure or auto-abort. There is no "paused on
conflict" exit code.

## Monitor Mode

**Only activate this mode when the user explicitly asks to monitor the PR.**

After the PR is created, invoke the `loop` skill with a self-contained prompt that describes the PR and asks it to watch for problems, fix any that are fixable, and stop once the PR is merged or closed.

## Prereqs & notes

- Needs `git`, `gh` (authed), and `python3` ≥ 3.9 on PATH.
- Auto-merge only takes effect if the repo allows it and the chosen
  method is enabled; otherwise the PR is created and a warning is logged.
- Branch-name collisions get a numeric suffix (`pr/abc1234-fix-foo-2`).
- `--title` / `--body` win over `gh --fill`.
- No stacked-PR support and no commit-message editing — submit as-is or
  amend locally first.
