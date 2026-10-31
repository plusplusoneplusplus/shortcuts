---
name: release
description: Cut a CoC release end to end — pick the version, draft user-facing "What's New" notes from the commit range, get approval, tag and push, watch the Release workflow, then write the notes into the GitHub Release body. Use when the user asks to "cut a release", "ship an alpha", "tag v3.4.9-alpha.32", "publish release notes", or similar.
---

# Release CoC

Releases the fetched `origin/main` commit: pin source → version → notes draft →
approval → tag → workflow → release body. The GitHub Release body is the single
source of truth for release notes; nothing is committed into the repo.

Preserve the current checkout, branch, HEAD, index and unrelated edits. Never
run `git checkout`, `git switch`, or any branch-changing command. Do not pull,
merge, rebase, reset, stash, commit local edits or push local branch commits to
prepare a release. Local unmerged commits and ahead/behind/diverged state do
not enter or block the release; any current branch or detached HEAD is valid,
and a dirty working tree is allowed.

## 0. Preconditions — fetch and pin the release source

Require an authenticated GitHub account, then fetch `origin/main` explicitly
along with tags. Stop on failure; never use a stale remote-tracking ref or
fall back to local `main` or `HEAD`.

```bash
gh auth status || exit 1
git fetch --tags origin +refs/heads/main:refs/remotes/origin/main || exit 1
RELEASE_SHA=$(git rev-parse --verify 'refs/remotes/origin/main^{commit}') || exit 1
printf 'Release source: origin/main at %s\n' "$RELEASE_SHA"
```

`RELEASE_SHA` is the full commit SHA, not an abbreviated hash or a moving ref.
Keep this value fixed for the entire release. Use it explicitly for tag
creation, previous reachable tag selection and the release-note range. Read
release content from Git objects at that SHA, not working-tree files. Fetching
updates remote-tracking refs and tags without moving the checkout or HEAD.

- **`gh` not authenticated** → stop with `gh auth login` as the fix.
- **Fetch or commit resolution fails** → stop and report the error. Do not
  reconcile the local branch or ask the user to commit, stash, switch or push.
- If a later fetch advances `origin/main`, keep the approved pin. To release a
  different SHA, restart source selection, regenerate notes and obtain approval
  for that source and text before tagging.

## 1. Version selection

The repo does **not** carry the release version. `packages/coc-desktop/package.json`
stays at its checked-in value; `.github/workflows/release.yml` rewrites it from
the tag at build time ("Sync desktop version from tag"). So **do not bump any
version file and do not create a version-bump commit** — the tag *is* the version.

Find the latest tag, prereleases included:

```bash
git tag --sort=-v:refname | head -10
```

Propose the next version by asking the user which they want:

- **prerelease bump** — `v3.4.9-alpha.31` → `v3.4.9-alpha.32` (increment the
  trailing counter, keep the base version)
- **new prerelease line** — `v3.4.9-alpha.31` → `v3.5.0-alpha.1`
- **stable** — `v3.4.9-alpha.31` → `v3.4.9`

Confirm the exact tag string with the user before continuing.

Then check the tag does not already exist:

```bash
git rev-parse -q --verify "refs/tags/$TAG"      # must fail
git ls-remote --tags origin "refs/tags/$TAG"    # must print nothing
```

If the tag exists locally or on the remote → **stop**. Never delete or
force-push a tag.

## 2. Draft the What's New section

Resolve the previous tag — the highest semver tag reachable from `RELEASE_SHA`,
prereleases included:

```bash
PREV=$(git tag --sort=-v:refname --merged "$RELEASE_SHA" | head -1)
if [ -z "$PREV" ]; then
  printf '%s\n' 'No previous reachable release tag; agree on a baseline before continuing.' >&2
  exit 1
fi
git log --no-merges --pretty='%h %s' "$PREV..$RELEASE_SHA" || exit 1
```

If no previous reachable release tag exists, stop and ask the user to agree
on a baseline before drafting notes. Never substitute `HEAD` or an unreachable
tag. Read that log and write a `## What's New` section.

**Grouping.** Three optional subsections, in this order, omitting any that
would be empty:

```markdown
## What's New

### Added
- ...

### Fixed
- ...

### Changed
- ...
```

**Bullets.** 3–8 bullets total across all groups. Each bullet describes
user-visible behavior in plain language — what a person can now do, or what
stopped being broken. Never name files, functions, packages, PR numbers, or
internal refactors. Merge several commits into one bullet when they are one
user-facing change.

**Exclusions.** Drop commits that are chore-only, test-only, CI/workflow-only,
dependency bumps, lint/formatting, docs-only, or pure internal refactors with
no behavior change. If *every* commit in the range is excluded, say so and ask
the user whether to write a one-line "maintenance and stability fixes" note or
skip the What's New block entirely.

**Prerelease prefix.** If the new tag has a suffix after the semver
(`-alpha.N`, `-beta.N`, `-rc.N`), the section starts with this line
immediately under the `## What's New` heading, before the first `###`:

```markdown
_Early build — expect rough edges. Please report anything that breaks._
```

**Approval gate — mandatory.** Show the exact tag, full `RELEASE_SHA`, previous
tag, release-note range and full draft to the user. Ask for explicit approval
of that source and text. There is no auto-write path: do not create the tag,
push, or run any `gh release` write command until the user approves the source
and text. If they ask for edits, revise and re-present.

## 3. Tag and push

Only after approval, repeat both local and remote tag-collision checks from
step 1. Stop if either check finds the tag or the remote check fails. Create
the annotated tag at the pinned SHA, verify its target, then push only that tag:

```bash
git tag -a "$TAG" "$RELEASE_SHA" -m "CoC $TAG" || exit 1
test "$(git rev-parse --verify "refs/tags/$TAG^{commit}")" = "$RELEASE_SHA" || exit 1
git push origin "refs/tags/$TAG:refs/tags/$TAG" || exit 1
```

Never omit the explicit SHA or replace it with `HEAD`, local `main` or a fresh
resolution of `origin/main`. A collision or push failure is not permission to
delete, move or force-push a tag.

## 4. Watch the Release workflow

The tag push triggers `.github/workflows/release.yml`. Identify the run for
`$TAG` at `$RELEASE_SHA`; do not select an unrelated run just because it is
newest. Poll it:

```bash
gh run list --workflow=release.yml --limit 5
gh run watch <run-id> --exit-status
```

- **Workflow succeeded** → continue to step 5.
- **Workflow failed** → **stop before touching the release body.** Report
  which job failed (`gh run view <run-id>` shows per-job status) and the
  failing step's log tail. Do not retry blindly; hand the failure back to
  the user.

The workflow creates the release itself: a **prerelease** tag yields a
published prerelease, a **stable** tag yields a **draft** release. A draft is
still editable by tag — proceed normally, but tell the user at the end that
the release is a draft and needs to be published manually.

## 5. Patch the release body (idempotent)

The workflow already wrote an Install/troubleshooting body. Insert What's New
above `## Install`, replacing any What's New block already there.

```bash
gh release view "$TAG" --json body -q .body > /tmp/release-body.md
```

**Strip-and-insert algorithm:**

1. Scan `/tmp/release-body.md` for a line matching `^## What's New\s*$`.
2. If found, delete from that line up to (but not including) the next line
   matching `^## ` — or to end of file if there is no next `##`. Everything
   before the heading and everything from the next `##` onward is kept
   verbatim. Do not touch `### ` subheadings outside that range.
3. Insert the approved What's New block (followed by a blank line)
   **immediately before the first remaining `^## ` line** — normally
   `## Install`. If the body has no `## ` heading at all, append the block at
   the end instead.

   Insert *before the first heading*, not at the very top of the body. For a
   prerelease the workflow emits a `> [!WARNING]` **Pre-release build** banner
   as untitled preamble above `## Install`; putting What's New above that
   banner would pull the banner inside the strip range on the next run and
   silently delete it. Inserting before the first heading keeps the banner on
   top and keeps step 2 exactly reversible.
4. Push it back:

```bash
gh release edit "$TAG" --notes-file /tmp/release-new-body.md
```

Reference implementation of steps 1–3 (`whatsnew.md` holds the approved block):

```bash
awk 'BEGIN{skip=0} /^## What'"'"'s New[ \t]*$/{skip=1;next} skip&&/^## /{skip=0} !skip' \
  /tmp/release-body.md > /tmp/release-stripped.md
awk -v f=/tmp/whatsnew.md 'BEGIN{done=0}
  !done && /^## /{while((getline l < f)>0) print l; print ""; done=1}
  {print}
  END{if(!done){print ""; while((getline l < f)>0) print l}}' \
  /tmp/release-stripped.md > /tmp/release-new-body.md
```

Because step 2 removes the old block before step 3 inserts the new one,
re-running the skill on the same tag replaces the block instead of appending
a second one. The prerelease banner and the `## Install` section survive
untouched.

Both prerelease and draft releases are editable this way.

## 6. Report

Print the release URL (`gh release view "$TAG" --json url -q .url`) and the
full source SHA. For a stable tag, remind the user the release is a draft
until they publish it.

## Failure modes — quick table

| Situation | Action |
| --- | --- |
| Local unmerged commits, ahead/behind/diverged branch, detached HEAD or dirty tree | Proceed from the pinned remote SHA; preserve checkout/HEAD and unrelated edits without reconciliation. |
| Fetch or remote commit resolution fails | Stop; report the error. Never release from stale refs or local HEAD. |
| `origin/main` advances after pinning | Keep the pin; a different source requires new notes and approval. |
| No previous reachable release tag | Stop; agree on a baseline with the user. |
| `gh` not authenticated | Stop; tell the user to run `gh auth login`. |
| Tag exists locally or on origin | Stop. No delete, no force-push. |
| Release workflow failed | Report the failing job; do not edit the release body. |
| Stable tag → draft release | Fine; edit it, then tell the user to publish. |
| No user-facing commits in range | Ask before writing a filler note. |
| User has not approved the draft | Do nothing that writes — no tag, no push, no `gh release edit`. |

## Notes

`.claude/skills` is a symlink to `.github/skills`, so this file needs no
mirrored copy.
