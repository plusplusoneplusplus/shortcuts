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
  source construction, and which capabilities they opt into. Commit descriptions
  use the Git tab's `CommitInfoHeader`; PR descriptions use `PrDescription` and
  `getPullRequestReviewSummaryText` from the inline PR overview. Description
  sections remain above selected-file diffs and use bounded overflow. The shell
  keeps loaded subjects/titles and identifiers available, with description
  disclosure state scoped to the workspace and review target. Stale metadata
  responses are discarded when adapters unmount or change targets.

## Conventions

- Adapters configure the kernel; they never re-implement selection, priority
  navigation, comment mapping, or chat placement.
- Route metadata keeps `sourceSelectionId` separate from the raw `workspaceId`
  and clone endpoint. Clone registration includes that exact key and its guard
  checks the concrete owner. The shell forwards it as `attachmentDestinationId`
  through every adapter to `FileDiffPanel`; omitted owners retain the panel's
  workspace fallback. Diff payloads and source factories keep raw workspace IDs.
- Commit and PR adapters forward the same owner to review-chat panels and frames.
  Empty review composers opt into `newChatSeedDestinationId` for that owner;
  active chats receive `sourceSelectionId`. Closed, minimized or hidden review
  composers leave seeds buffered until an eligible composer mounts or becomes
  visible. Inline review hosts do not opt into this buffer.
- Capabilities are opt-in via optional `progress` / `classification` arguments.
  Branch-range currently opts into neither, which is why its rail hides the
  priority and filter affordances.
- Commit review progress is session-local; PR progress persists per
  `(originId, workspaceId, repoId, prId)` and is keyed by head SHA.
- Test-id prefixes are `commit-popout` and `pr-popout`; the toolbar renders
  identical markup for both, and a parity test asserts that.
