# Git commits UI

Commit review surface for the Git tab: the commit list on the left, the commit
detail/diff pane, and the commit-bound chat panels.

## CommitDetail

`CommitDetail.tsx` keeps the title and copyable SHA available in expanded and
collapsed headers. Collapsed metadata uses `hidden` so its controls leave the
keyboard order. Header and classification-settings disclosures reset on
`(workspaceId, hash)` changes. Settings reuse `ClassifyDiffAiControls` and the
workspace-scoped `useModalJobAiSelection`; disable selectors during classification.
Review and view control groups wrap independently in narrow panes. Icon buttons
need accessible names, and panel toggles expose their pressed state.
The review opener carries `attachmentDestinationId` as URL `sourceSelectionId`;
endpoint lookup uses that concrete owner, with explicit local owners staying on
the page origin. Omitted owners retain workspace-based lookup.

## Review composer ownership

`CommitChatPanel`, `PrChatPanel` and `CommitChatPlacementFrame` forward
`sourceSelectionId` to active `ChatDetail` and empty `InitialChatComposer`.
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
  the unpushed range are rejected.
- **Stale file loads.** Commit hashes are not unique across repos, so every
  `listCommitFiles` request carries a generation that bumps on workspace
  change; a response arriving after a repo switch is discarded and the cache is
  cleared.
- **Anchor.** Every toggle-style transition (Ctrl+click, mobile tap,
  swipe-right) routes through `computeToggleSelection`, so the anchor used by
  Shift ranges cannot drift between desktop and mobile paths.

## Tests

`test/spa/react/CommitList.test.ts` and several files under
`test/spa/react/repos/` assert on source text. They read the concatenated
family via `test/spa/helpers/commit-list-source.ts` — add any new module to
`COMMIT_LIST_MODULES` there. Test ids, class names, swipe action labels, and
drag payload formats are treated as a stable contract.

When mocking `useFileCommentCounts` in a hook test, return a **stable** Map:
the comment-map effect depends on its identity and a fresh Map per render
renders into an infinite loop (a hang, not a fast failure).
