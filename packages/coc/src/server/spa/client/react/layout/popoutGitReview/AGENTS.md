# Pop-Out Git Review

Kernel behind `../PopOutGitReviewShell.tsx`. The shell owns window chrome and review-type dispatch.

## Modules

- `popoutGitReviewRoute.ts` — route parse, titles, clone-base registration. `registerPopOutCloneBases` runs before children and does not re-seed on re-render.
- `usePopOutReviewLifecycle.ts` — broadcast open/close/restore and `document.title`.
- `usePopOutReviewModel.ts` — file, hunk, priority, mark-to-next in the rail's display order. `popOutDiffPanelProps` is shared.
- `useFileCommentMap.ts` — comment storage keys to paths.
- `PopOutClassificationToolbar.tsx`, `PopOutReviewLayout.tsx`, `PopOutReviewChatSlot.tsx` — controls, rail, side vs lens chat.
- `CommitReviewContent.tsx`, `PrReviewContent.tsx`, `BranchRangeReviewContent.tsx` — adapters. Commit uses `useCommitReviewFiles` and `GitFileReview`. Branch uses `BranchRangeOverview` and the same navigator. PR progress is origin-persisted. Its content search is default off.

## Rules

- Adapters do not acquire or render diffs themselves.
- Keep `sourceSelectionId` separate from raw `workspaceId` and the clone endpoint. Forward it as `attachmentDestinationId`. Omitted owners use the panel workspace fallback. Payloads keep raw workspace ids.
- Empty review composers opt into `newChatSeedDestinationId`. Active chats receive `sourceSelectionId`. Closed or hidden composers leave seeds buffered. Inline hosts do not opt in.
- PR capabilities are opt-in via `progress` / `classification`. Branch scope reuses commit review for a selected commit.
- Commit and branch viewed state is session-local and owner/comparison scoped. PR progress persists per `(originId, workspaceId, repoId, prId)` and head SHA.
- Test-id prefixes: `commit-popout`, `pr-popout`. Both share `ClassificationFilterBar`.
