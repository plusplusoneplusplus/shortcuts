# Plan: Display Git Commit Info in Right Panel + Larger Left Panel

## Problem

Currently, commit metadata (author, date, hash, parents, body) is only accessible via a hover tooltip (`CommitTooltip`) on the left panel commit rows. The right panel (`CommitDetail`) shows only the unified diff with no metadata context. Additionally, the left panel is narrow (320px fixed), limiting usability.

## Proposed Approach

1. **Add a commit info header section to `CommitDetail`** — display metadata (subject, author, date, hash + copy, parents, body) at the top of the right panel in a compact, collapsible or always-visible strip.
2. **Widen the left panel** — increase from `lg:w-[320px]` to `lg:w-[400px]` (or similar) in `RepoGitTab.tsx` to give commit rows more readable space.
3. **Pass metadata props to `CommitDetail`** — the current `CommitDetailProps` only has `workspaceId`, `hash`, `filePath`. Add `subject`, `author`, `date`, `parentHashes`, `body` (already available at the `RepoGitTab` level from the selected commit).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` | Add metadata header section at top of right panel |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Pass metadata props to `CommitDetail`; widen left panel to `lg:w-[400px]` |

## Detailed Changes

### 1. `CommitDetail.tsx` — Add Metadata Header

- Extend `CommitDetailProps` with optional fields: `subject?`, `author?`, `date?`, `parentHashes?`, `body?`
- Render a metadata strip between the file-path label and the diff:
  - **Subject** — bold, full text
  - **Author** — with user icon
  - **Date** — human-friendly (e.g. "Mar 2, 2026, 5:25 AM")
  - **Hash** — 8-char short hash + "Copy" button (reuse clipboard logic from `CommitTooltip`)
  - **Parents** — space-separated short hashes
  - **Body** — if present, shown in a scrollable `<pre>` or collapsed text area
- Style consistently with `CommitTooltip` design (same field labels, same monospace hash styling)
- Use `border-b` separator between the metadata section and the diff

### 2. `RepoGitTab.tsx` — Wire Props + Widen Panel

- Where `CommitDetail` is rendered (around line 295–315), pass `subject`, `author`, `date`, `parentHashes`, `body` from the selected commit object (already in component state as `selectedCommit` or equivalent)
- Change `lg:w-[320px]` → `lg:w-[400px]` on the `<aside>` element (line 321)

## Design Notes

- **No tooltip removal** — `CommitTooltip` stays as-is; the right panel info is a complement, not a replacement.
- **No new API calls** — all metadata is already fetched as part of commit list data; just pass it through props.
- **Body collapsing** — if commit body is long, show first 3 lines with an expand toggle to avoid pushing the diff too far down.
- **Copy button** — reuse the same clipboard utility already used in `CommitTooltip` (`copyToClipboard` from `../utils/format` or inline `navigator.clipboard`).
- **Accessibility** — metadata fields use `<dl>`/`<dt>`/`<dd>` or labeled divs for screen-reader friendliness.

## Out of Scope

- Resizable splitter between left/right panels
- Virtualized commit list changes
- Mobile layout changes (stacked view already adequate)
