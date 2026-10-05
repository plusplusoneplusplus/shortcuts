---
name: submit-commits-as-pr
description: Submit existing commits as a GitHub or Azure DevOps pull request through CoC create_pull_request, with auto-merge on by default. Use when the user asks to open a PR for a commit, send a commit range as a PR, or submit outgoing commits. Conflicts abort submission; never resolve them.
---

# Submit Commits as a PR

Use CoC's `create_pull_request` tool exclusively. Submit committed objects in an
isolated temporary linked worktree. Never switch the active worktree's branch or
move its HEAD during submission. A dirty active worktree is fine. Use `impl` to
change source code; this skill submits existing commits.

## Workspace and tool availability

The tool uses the calling chat's repository and its `origin` remote; it does not
accept a target workspace or alternate remote. Verify that the chat owns the
requested repository. For another workspace, use `list_workspaces` and delegate
to a writable CoC chat in that workspace, carrying the exact commit selection
and PR options. Confirm that the target has the committed objects.

Discover CoC's native or MCP-qualified `create_pull_request` tool. If unavailable,
explain that submission requires a writable CoC context (Autopilot or a Ralph
write turn), with the tool enabled, and delegate when authorized and available.
Otherwise report the blocker. Never substitute scripts, `gh pr create`,
`az repos pr create`, or another PR creation path.

## Select the exact commits

1. Honor the requested SHA, comma-separated SHAs, range (`A..B`), or last N
   commits (`HEAD~N..HEAD`). Resolve each ref to a full commit SHA. Expand ranges
   with `git rev-list --reverse --topo-order <range>`; resolve explicit SHAs with
   `git rev-parse --verify <ref>^{commit}`. Deduplicate and order only the selected
   commits oldest first; do not add their unrequested ancestors.
2. Use the requested base, otherwise resolve the repository's default branch
   from `origin/HEAD` or `git ls-remote --symref origin HEAD`, falling back to
   `main`. The tool supports `origin` only.
3. When commits are unspecified, fetch `origin` and the resolved base without
   changing the active branch/HEAD. Resolve outgoing commits with
   `git rev-list --reverse --topo-order origin/<base>..HEAD`. Do not ask for a
   subset unless the request needs one. For an explicit selection, never replace
   it with the outgoing range.
4. Inspect the selected commits and their diff. If the selection is empty or
   invalid, report it and stop. **ALWAYS pass nonempty `commits`** as an explicit
   array of resolved SHAs. Omitted or empty `commits` selects the tool's
   current-branch mode, which this skill must never use.

## Prepare and submit

Provide a reviewable `title` and Markdown `body` describing the concrete change,
why it matters, relevant validation, and material limitations. Respect supplied
metadata. Pass the resolved `base` and these options:

- `draft`: true for an explicit draft/WIP request; otherwise false.
- `autoMerge`: **always pass `autoMerge: true` by default**, or
  **`autoMerge: false`** when the user explicitly asks to disable auto-merge,
  leave it open, or merge manually. Invoking this skill authorizes its documented
  auto-merge default. The general tool's omitted-parameter default remains false.
- `mergeMethod`: honor `merge`, `squash`, or `rebase` when requested; otherwise
  use `merge`. Surface provider/repository limitations from the result.
- `commits`: the nonempty exact SHA array, oldest first.

Call `create_pull_request` once. The tool orders selected commits oldest first,
fetches `origin/<base>`, creates a fresh branch in a temporary linked worktree,
cherry-picks and rebases there, pushes, opens the PR, and records its chat binding.
The provider comes from `origin`; server-side GitHub/ADO credentials must work.
Do not create branches, push, or open PRs yourself.

## Interpret results and retries

- `success: true`: report `url`, PR identity, branch/base, and actual
  `autoMerge.enabled` plus any `autoMerge.warning`. Requested auto-merge can fail
  while PR creation succeeds. `existing: true` means the tool returned an open
  PR for its branch; report it as existing.
- `bound: false` with success means the PR exists but its chat binding was not
  written. Report that limitation; never resubmit to repair a binding.
- `success: false`: report `code`, `error`, and `commit` when present. A
  `conflict` aborts and cleans up the temporary run. **NEVER resolve cherry-pick
  or rebase conflicts**, run `--continue`, or alter source commits to overcome
  them. Report the conflicting SHA when supplied and the base, then stop so the
  user can fix the source commits and request submission again.
- Push/creation errors, timeouts, or lost responses can leave a remote branch or
  an existing PR. Before any retry, check local/remote submission branches and
  provider PR state using read-only Git/provider queries in the owning workspace.
  The generated branch is `pr/<first-short-SHA>-<subject-slug>` with a numeric
  suffix on collisions. A fresh commits-mode call can create a different branch;
  the tool's existing-PR check alone does not make a blind retry safe.
  If a PR exists, report it and its incomplete steps. If the outcome remains
  uncertain, stop and report the uncertainty. Retry only after proving no PR was
  created and accounting for any pushed branch; never blindly rerun or fall back
  to CLI creation. Do not claim an error rolled back remote state.

## Monitor mode

Activate monitoring **only when the user explicitly asks to monitor the PR**.
Use the `cron` skill with a self-contained prompt naming the owning workspace,
PR, requested checks/fixes, and a stop condition when the PR is merged or closed.
Submission and auto-merge alone do not authorize monitoring.
