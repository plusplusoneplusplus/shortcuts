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
  classification-driven prev/next navigation, mark-to-next navigation through the
  rail’s reported display order, and the last-selected-file sync.
  `popOutDiffPanelProps` builds the `FileDiffPanel` props every review type
  shares.
- `useFileCommentMap.ts` — maps diff-comment storage keys onto file paths.
- `PopOutClassificationToolbar.tsx`, `PopOutReviewLayout.tsx`,
  `PopOutReviewChatSlot.tsx` — shared controls, file rail + diff column layout,
  and chat placement (side panel vs. lens).
- `CommitReviewContent.tsx`, `PrReviewContent.tsx`,
  `BranchRangeReviewContent.tsx` — review-type adapters. Commit review loads
  metadata through `useCommitReviewFiles` and uses `GitFileReview`; branch review
  uses `BranchRangeOverview` with the same navigator and focused file panel.
  Both retain concrete owner routing and session-local viewed state. PR review
  uses `PopOutReviewLayout` and its origin-persisted review progress. Its optional
  default-off content search uses the existing owner-routed paired loader and
  review-local controller; the file rail retains Files/Search controls and
  forwards exact-side targets to `FileDiffPanel`.
  Commit review passes `useCommitReviewHeader` (title/SHA, Classify split button,
  chat action, collapsed `CommitInfoHeader` details) into the `GitFileReview`
  single-row toolbar; PR descriptions use
  `PrDescription` and `getPullRequestReviewSummaryText`. Metadata has bounded
  overflow, resets by owner/target and discards superseded reads. The shell keeps
  loaded subjects/titles and identifiers in the window header.

## Conventions

- Adapters reuse shared review layouts and chat slots; they never duplicate
  diff acquisition or rendering.
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
- PR kernel capabilities are opt-in through `progress` / `classification`.
  Commit classification uses the same controls and model; branch scope exposes
  the exact comparison commits and reuses commit review for a selected commit.
- Commit and branch viewed state is session-local and owner/comparison scoped;
  PR progress persists per
  `(originId, workspaceId, repoId, prId)` and is keyed by head SHA.
- Test-id prefixes are `commit-popout` and `pr-popout`. `PopOutClassificationToolbar`
  serves PR review; both share `ClassificationFilterBar`.
