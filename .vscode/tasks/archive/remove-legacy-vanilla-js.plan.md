# Remove Legacy Vanilla JS SPA Code

## Problem

The CoC dashboard SPA was rewritten from vanilla JS to React. The old vanilla JS files are completely dead code — they are never imported from the React entry point (`index.tsx`) and are excluded from the esbuild bundle. Some even reference non-existent modules (`./config`, `./core`, `./preferences`).

## Approach

Delete all legacy vanilla JS source files and their associated tests. No CSS cleanup needed (`.chat-message-content` is actively used by React). No shared utilities are orphaned — `markdown-renderer.ts`, `diff-utils.ts`, and `task-comments-types.ts` are still used by React.

## Files to Delete

### Source files (7 files)

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/detail.ts` | Process detail rendering (replaced by `ProcessDetail.tsx`) |
| `packages/coc/src/server/spa/client/sidebar.ts` | Sidebar navigation (replaced by React router/layout) |
| `packages/coc/src/server/spa/client/queue.ts` | Queue list rendering (replaced by React queue views) |
| `packages/coc/src/server/spa/client/filters.ts` | Filter UI (replaced by React filter components) |
| `packages/coc/src/server/spa/client/tool-renderer.ts` | Tool call HTML rendering (replaced by `ToolCallView.tsx`) |
| `packages/coc/src/server/spa/client/state.ts` | Client state types (only consumed by `tool-renderer.ts`) |
| `packages/coc/src/server/spa/client/utils.ts` | `escapeHtmlClient` utility (only consumed by legacy files) |

### Test files (4 files)

| File | What it tests |
|------|---------------|
| `packages/coc/test/spa/react/detail-legacy.test.ts` | Reads `detail.ts` source and asserts on content |
| `packages/coc/test/server/spa/client/tool-renderer-subtree.test.ts` | Imports from `tool-renderer.ts` |
| `packages/coc/test/server/spa/client/tool-renderer-edit-create.test.ts` | Imports from `tool-renderer.ts` |
| `packages/coc/test/server/spa/client/queue-repo-badge.test.ts` | Re-implements `resolveTaskRepoLabel` from `queue.ts` |

## Files to KEEP (shared utilities still used by React)

- `markdown-renderer.ts` — used by `ConversationTurnBubble`, `MarkdownReviewEditor`, etc.
- `diff-utils.ts` — used by `ToolCallView.tsx`
- `task-comments-types.ts` — used by comment system components

## Verification

1. Run `npm run build` — confirm no build errors
2. Run tests in `packages/coc/` — confirm no failures from missing imports
3. Verify the SPA still works: `coc serve --no-open` + check `http://localhost:4000`
