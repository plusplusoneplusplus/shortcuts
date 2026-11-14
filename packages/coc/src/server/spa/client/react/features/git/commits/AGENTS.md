# Git commits UI

Commit list, commit diff, and commit-bound chat for the Git tab.

## Commit detail

`CommitDetail` and the pop-out adapter build one `GitReviewHeader` via `useCommitReviewHeader` and pass it to `GitFileReview`. Metadata starts collapsed and resets with owner and commit. Classify reuses `ClassifyDiffAiControls` and disables selectors while running. SHA lookup uses `getGitReviewClient` and `gitCommitLookup`.

`useCommitReviewFiles` drops superseded reads. Only the selected `FileDiffPanel` mounts. Review state keys include owner, workspace, and comparison. "All comments" uses `useAllCommitComments` and the selected panel chat's `currentChatSend`, not the commit-bound review chat. Openers serialize `attachmentDestinationId` as `sourceSelectionId`. Explicit local owners stay on the page origin.

`RepoGitDetailPane` owns one review host per `(attachmentDestinationId ?? workspaceId, hash)`. Same-commit file navigation keeps the conversation. Owner or commit changes replace the host. `CommitChatPanel`, `PrChatPanel`, and `CommitChatPlacementFrame` forward `sourceSelectionId`. Buffered seeds need explicit `newChatSeedDestinationId`. Inline hosts do not drain Activity seeds.

## CommitList

`CommitList.tsx` is wiring. Behavior lives in `commitListSelection.ts`, `commitRowViewModel.ts`, `useCommitListExpansion.ts`, `useCommitListGestures.ts`, and `useCommitListDragController.ts`. Types: `commitListTypes.ts`.

- `onMultiSelect` receives display order from `commitsInSet`, never from iterating the hash set.
- The ⠿ handle is reorder (`text/plain` index only). The row body is session-context drag. `dragIndex` is set only by `handleReorderDragStart`. Drops outside the unpushed range are rejected. Payloads keep the raw member workspace and `sourceRoutingRef`. An unresolved remote source cannot become local.
- `listCommitFiles` carries a generation that bumps on workspace change. Discard late responses and clear the cache.
- Toggle selection (Ctrl/Cmd-click, mobile tap, swipe) goes through `computeToggleSelection` so the Shift anchor stays shared.
- `CommitTooltip` portals to `document.body`. Pointer events on it do not dismiss hover-peek. Rail outgoing rows reuse the tooltip. Copy is not row activation.

## Tests

Source-mirror tests read `test/spa/helpers/commit-list-source.ts`. Add modules to `COMMIT_LIST_MODULES`. When mocking `useFileCommentCounts`, return a stable Map or the hook loops.
