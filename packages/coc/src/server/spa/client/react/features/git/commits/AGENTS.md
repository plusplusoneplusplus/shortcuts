# Git commits UI

Commit review surface for the Git tab: the commit list on the left, the commit
detail/diff pane, and the commit-bound chat panels.

## CommitDetail

`CommitDetail.tsx` and the pop-out adapter build one `GitReviewHeader` with
`useCommitReviewHeader.tsx` and pass it to `GitFileReview`, so title, SHA,
Classify, file navigation, progress, Mark viewed and actions share one toolbar
row. `CommitInfoSummary` is the ellipsized title disclosure; `CommitInfoHeader`
renders subject, body, author, date, parents, file count and copyable SHA below
the row. Metadata starts collapsed, uses `hidden` outside the keyboard order, and
resets with the owner and commit. The Classify split-button caret reuses
`ClassifyDiffAiControls` and the workspace-scoped AI selection; disable selectors
during classification. Priority navigation, comments, AI chat and pop-out are
toolbar actions that move into the More menu in narrower panes.

`useCommitReviewFiles` reads file metadata through the concrete owner client and
discards superseded results. `GitFileReview` supplies Git transport and revision
attachments to the shared `ReviewFiles` shell, which owns grouping/tree/flat layouts, search, filters,
selection, viewed tracking, overview, resizing and the narrow drawer. Inline PR
files adapt their metadata and renderer to the same shell. Only
the selected `FileDiffPanel` mounts; never load a combined patch for navigation.
The file panel retains diff engines, hunk navigation, comments, find, truncation
and fallback behavior. Review state keys include owner, workspace and comparison.
The toolbar's "All comments in this commit" sidebar lists every file's comments
through `useAllCommitComments` (shared `useReviewComments`), grouped by file, whichever
file is selected. Classification also stays on the toolbar.

Icon buttons need accessible names; panel toggles expose pressed state. Review
openers serialize `attachmentDestinationId` as `sourceSelectionId` and resolve
that exact endpoint. Explicit local owners stay on the page origin. Omitted
owners retain workspace-based lookup.

## Commit review lifetime

`RepoGitDetailPane` owns one review host per `(attachmentDestinationId ?? workspaceId, hash)`. It passes
`reviewChat` presentation controls into `CommitDetail` and `FileDiffPanel`, and
renders `CommitReviewChat` beside their content. Same-commit overview/file
navigation preserves the conversation, draft and scroll. File-to-file navigation
reuses the file panel and Monaco editor while loading fresh models; hidden prior
models cannot receive selections. Clone owner or commit changes replace the host.
Standalone surfaces own their chat locally through the same shared renderer.

## Review composer ownership

`CommitChatPanel`, `PrChatPanel` and `CommitChatPlacementFrame` forward
`sourceSelectionId` to active `ChatDetail` and empty `InitialChatComposer`.
Inline `CommitReviewChat` receives that owner from `attachmentDestinationId`
for lens, pinned and classic placements.
Buffered selection seeds require explicit `newChatSeedDestinationId` opt-in.
Pop-out review adapters supply the same owner as their diff panels for both side
and lens placements. Inline review hosts leave seed consumption unset, so they
cannot drain Activity fallback selections.

## CommitList interaction kernel

`CommitList.tsx` owns only the public prop contract and wiring. Behavior is
split so that a change to one interaction mode cannot silently alter another:

| Module | Owns |
| --- | --- |
| `commitListTypes.ts` | `GitCommitItem`, `isTouchOnly()`. Import types from here inside the family; external callers may keep importing from `CommitList`. |
| `commitListSelection.ts` | Pure selection transitions — single, Ctrl/Cmd toggle, Shift range, keyboard move, mobile toggle. No React state. |
| `commitRowViewModel.ts` | Pure date grouping (`computeCommitGroups`), author avatar helpers, and `buildCommitRowViewModel` (selected / unpushed / merge / fixup / classified flags). |
| `useCommitListExpansion.ts` | Expanded hash, lazy `listCommitFiles` cache, loading indicator, deep-link auto-expand, filePath → comment-count map. |
| `useCommitListGestures.ts` | Hover-tooltip timers, touch-start dismissal, long-press context menu, swipe-reveal row state, touch overflow button. |
| `useCommitListDragController.ts` | The two drag systems, kept explicitly apart. |
| `CommitRow.tsx` | Row markup + `SwipeableCommitRow`. Presentation only; all behavior arrives as props. |
| `CommitIdentity.tsx`, `outgoingCommits.ts` | Shared SHA/subject formatting, history page size and outgoing-prefix selection for expanded Git and collapsed-rail Sync previews. |
| `CommitRowBadges.tsx`, `CommitGroupSeparator.tsx`, `CommitExpandedFiles.tsx`, `CommitMobileSelectionBar.tsx` | Focused presentation pieces. |

### Invariants

- **Selection order.** `onMultiSelect` always receives commits in display order.
  That comes from `commitsInSet` filtering the commit array, never from
  iterating the hash set — keep it that way.
- **Two drags, never one.** The ⠿ handle starts a reorder drag (`text/plain`
  index only); the row body starts a session-context drag
  (`writePointerContextDragData` / `writeSessionContextDragBundle`). A context
  drag passing over the list cannot become a reorder preview because
  `dragIndex` is set only by `handleReorderDragStart`. Reorder drops outside
  the unpushed range are rejected. Context payloads keep the raw member workspace
  and `sourceRoutingRef` from the concrete `sourceSelectionId` or subtree owner
  on every bundled commit; an unresolved remote source cannot become local.
- **Stale file loads.** Commit hashes are not unique across repos, so every
  `listCommitFiles` request carries a generation that bumps on workspace
  change; a response arriving after a repo switch is discarded and the cache is
  cleared.
- **Anchor.** Every toggle-style transition (Ctrl+click, mobile tap,
  swipe-right) routes through `computeToggleSelection`, so the anchor used by
  Shift ranges cannot drift between desktop and mobile paths.
- **Tooltip ownership.** `CommitTooltip` portals to `document.body` with
  viewport coordinates, outside transformed/clipping sidebar containers. React
  hover events retain panel ownership; tooltip pointerdown and mousedown stop
  propagation so its controls do not trigger hover-peek outside-click dismissal. Outside
  mousedown, Escape and touch-start cancel tooltip timers and dismiss the portal.
  Rail outgoing rows reuse the tooltip, gestures and history metadata; focus keeps
  the nested preview alive, and Copy remains separate from row activation.

## Tests

`test/spa/react/CommitList.test.ts` and several files under
`test/spa/react/repos/` assert on source text. They read the concatenated
family via `test/spa/helpers/commit-list-source.ts` — add any new module to
`COMMIT_LIST_MODULES` there. Test ids, class names, swipe action labels, and
drag payload formats are treated as a stable contract.

When mocking `useFileCommentCounts` in a hook test, return a **stable** Map:
the comment-map effect depends on its identity and a fresh Map per render
renders into an infinite loop (a hang, not a fast failure).
