# Pop-Out Git Review Kernel

Shared flow kernel behind `../PopOutGitReviewShell.tsx`. The shell owns only the
window chrome (providers, top bar, review-type dispatch); everything else lives
here.

## Modules

- `popoutGitReviewRoute.ts` — pure route parsing, top-bar/document-title labels,
  and clone-base registration. `registerPopOutCloneBases` is guarded so a React
  re-render cannot re-seed the module-level clone registry, and it still runs
  before any child renders (children issue workspace-scoped requests from
  effects, which run before the shell's own effects).
- `usePopOutReviewLifecycle.ts` — broadcast-channel open/close/restore plus the
  dynamic `document.title`.
- `usePopOutReviewModel.ts` — selected file, hunk target, priority sort,
  classification-driven prev/next navigation, and the last-selected-file sync.
  `popOutDiffPanelProps` builds the `FileDiffPanel` props every review type
  shares.
- `useFileCommentMap.ts` — maps diff-comment storage keys onto file paths.
- `PopOutClassificationToolbar.tsx`, `PopOutReviewLayout.tsx`,
  `PopOutReviewChatSlot.tsx` — shared controls, file rail + diff column layout,
  and chat placement (side panel vs. lens).
- `CommitReviewContent.tsx`, `PrReviewContent.tsx`,
  `BranchRangeReviewContent.tsx` — per-review-type adapters: data loading, diff
  source construction, and which capabilities they opt into.

## Conventions

- Adapters configure the kernel; they never re-implement selection, priority
  navigation, comment mapping, or chat placement.
- Capabilities are opt-in via optional `progress` / `classification` arguments.
  Branch-range currently opts into neither, which is why its rail hides the
  priority and filter affordances.
- Commit review progress is session-local; PR progress persists per
  `(originId, workspaceId, repoId, prId)` and is keyed by head SHA.
- Test-id prefixes are `commit-popout` and `pr-popout`; the toolbar renders
  identical markup for both, and a parity test asserts that.
