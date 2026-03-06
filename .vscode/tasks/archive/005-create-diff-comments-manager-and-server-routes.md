---
status: pending
---

# 005: Create DiffCommentsManager and server routes

## Summary

Add a `DiffCommentsManager` class (in a new file `packages/coc/src/server/diff-comments-handler.ts`) that persists diff comments under `~/.coc/diff-comments/{wsId}/{storageKey}.json`, plus a `registerDiffCommentsRoutes` function that wires up eight REST endpoints under `/api/diff-comments/...`. Export both from `packages/coc/src/server/index.ts` and call `registerDiffCommentsRoutes` inside `createServer`.

## Motivation

Server-side persistence is self-contained: it only imports types from `pipeline-core` and mirrors the already-proven `TaskCommentsManager` pattern. Completing this unblocks commits 006 (VS Code extension client) and 007 (webview UI), which all depend on these routes existing. Building it in isolation also makes it independently testable.

## Changes

### Files to Create

- **`packages/coc/src/server/diff-comments-handler.ts`**
  - `DiffCommentsStorage` interface
  - `DiffCommentsManager` class
  - `registerDiffCommentsRoutes` function
  - All URL patterns as module-level `RegExp` constants

### Files to Modify

- **`packages/coc/src/server/index.ts`**
  - Add import of `registerDiffCommentsRoutes` and `DiffCommentsManager`
  - Call `registerDiffCommentsRoutes(routes, dataDir, bridge, store, () => wsServer)` immediately after the `registerTaskCommentsRoutes` call (line ~233)
  - Add re-exports at the bottom (mirror the `TaskCommentsManager` export lines)

### Files to Delete

_(none)_

## Implementation Notes

### Storage Layout

```
{dataDir}/diff-comments/{wsId}/{storageKey}.json
```

- `storageKey = SHA-256(repositoryId + oldRef + newRef + filePath)` for all normal diffs
- **Working-tree special case:** when `newRef === 'working-tree'`, use `SHA-256(repositoryId + filePath + 'working-tree')` and mark every comment in the file with `ephemeral: true`
- Construct the key by concatenating fields **without** a separator to match what the client will produce; document this in a JSDoc comment on `hashContext`

### `DiffCommentsStorage` Interface

```ts
export interface DiffCommentsStorage {
    comments: DiffComment[];
    settings: {
        showResolved: boolean;
    };
}
```

Import `DiffComment` and `DiffCommentContext` from `@plusplusoneplusplus/pipeline-core` (defined in commit 001 under `pipeline-core/src/editor/types.ts`).

### `DiffCommentsManager` Class

```ts
const DIFF_COMMENTS_DIR_NAME = 'diff-comments';

const DEFAULT_DIFF_SETTINGS: DiffCommentsStorage['settings'] = {
    showResolved: true,
};

export class DiffCommentsManager {
    private readonly commentsRoot: string;
    constructor(dataDir: string) { ... }

    // Key derivation
    hashContext(ctx: DiffCommentContext): string
    // → crypto.createHash('sha256')
    //     .update(ctx.repositoryId + ctx.oldRef + ctx.newRef + ctx.filePath)
    //     .digest('hex')
    // If ctx.newRef === 'working-tree':
    //     .update(ctx.repositoryId + ctx.filePath + 'working-tree')

    private getWorkspaceDir(wsId: string): string
    private getStorageFile(wsId: string, storageKey: string): string
    private ensureWorkspaceDir(wsId: string): void

    async getComments(wsId: string, storageKey: string): Promise<DiffComment[]>
    async writeComments(wsId: string, storageKey: string, comments: DiffComment[]): Promise<void>
    // atomic: write to `${file}.tmp` then fs.rename

    async addComment(
        wsId: string,
        ctx: DiffCommentContext,
        commentData: Omit<DiffComment, 'id' | 'createdAt' | 'updatedAt' | 'ephemeral'>
    ): Promise<DiffComment>
    // Sets ephemeral: true when ctx.newRef === 'working-tree'

    async updateComment(wsId: string, storageKey: string, id: string,
        updates: Partial<Omit<DiffComment, 'id' | 'createdAt'>>): Promise<DiffComment | null>

    async deleteComment(wsId: string, storageKey: string, id: string): Promise<boolean>

    async getComment(wsId: string, storageKey: string, id: string): Promise<DiffComment | null>

    async addReply(wsId: string, storageKey: string, id: string,
        replyData: { author: string; text: string; isAI?: boolean }): Promise<DiffCommentReply | null>

    async getCommentCounts(wsId: string): Promise<Record<string, number>>
    // reads all *.json in wsDir; key = storageKey (filename without .json), value = comments.length

    async listAllComments(wsId: string): Promise<DiffComment[]>
    // reads all *.json in wsDir; flattens to a single array
}
```

`DiffCommentReply` — define locally (same shape as `TaskCommentReply`: `id`, `author`, `text`, `createdAt`, `isAI?`).

### URL Patterns

All patterns use the workspace ID format `[a-zA-Z0-9_-]+`. The storage key (SHA-256 hex) is always 64 hex characters and appears as a URL segment.

```ts
// /api/diff-comment-counts/:wsId
const countsPattern = /^\/api\/diff-comment-counts\/([a-zA-Z0-9_-]+)$/;

// /api/diff-comments/:wsId  (list all / create)
const collectionPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)$/;

// /api/diff-comments/:wsId/:storageKey
const storageKeyPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})$/;

// /api/diff-comments/:wsId/:storageKey/:id
const itemPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// /api/diff-comments/:wsId/:storageKey/:id/replies
const replyPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/replies$/;

// /api/diff-comments/:wsId/:storageKey/:id/ask-ai
const askAiPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ask-ai$/;
```

### `registerDiffCommentsRoutes` Signature

```ts
export function registerDiffCommentsRoutes(
    routes: Route[],
    dataDir: string,
    bridge: MultiRepoQueueExecutorBridge,
    store?: ProcessStore,
    getWsServer?: () => ProcessWebSocketServer | undefined
): void
```

### Route Handlers

| Method | Pattern | Handler logic |
|--------|---------|---------------|
| `GET` | `countsPattern` | `manager.getCommentCounts(wsId)` → `{ counts }` |
| `GET` | `collectionPattern` | `manager.listAllComments(wsId)` → `{ comments }` |
| `POST` | `collectionPattern` | parse body → validate `context` (DiffCommentContext) + `selection` + `selectedText` + `comment` → `manager.addComment(wsId, ctx, ...)` → 201 |
| `GET` | `storageKeyPattern` | `manager.getComments(wsId, storageKey)` → `{ comments }` |
| `GET` | `itemPattern` | `manager.getComment(wsId, storageKey, id)` → 200 or 404 |
| `PATCH` | `itemPattern` | parse body → `manager.updateComment(...)` → 200 or 404 |
| `DELETE` | `itemPattern` | `manager.deleteComment(...)` → 204 or 404 |
| `POST` | `replyPattern` | parse body `{ author, text }` → `manager.addReply(...)` → 201 or 404 |
| `POST` | `askAiPattern` | skeleton: return 501 Not Implemented (AI integration deferred to a later commit) |

**Validation helpers** (module-private):
- `isValidWorkspaceId(wsId)` — reuse same regex as task-comments: `/^[a-zA-Z0-9_-]+$/`
- `isValidStorageKey(key)` — `/^[0-9a-f]{64}$/`
- Required body fields for create: `context` (object with `repositoryId`, `oldRef`, `newRef`, `filePath`), `selection`, `selectedText`, `comment`

### `index.ts` Registration Call

```ts
// after registerTaskCommentsRoutes line:
registerDiffCommentsRoutes(routes, dataDir, bridge, store, () => wsServer);
```

### `index.ts` Re-exports (append after existing task-comments exports)

```ts
export { registerDiffCommentsRoutes, DiffCommentsManager } from './diff-comments-handler';
export type { DiffCommentsStorage } from './diff-comments-handler';
```

## Tests

Create `packages/coc/src/server/__tests__/diff-comments-handler.test.ts` (Vitest).

Test cases to cover:

1. **`DiffCommentsManager.hashContext`** — same inputs produce the same hash; `newRef === 'working-tree'` produces a different hash than `newRef === 'HEAD'` for otherwise identical context
2. **`addComment`** — stores comment; `ephemeral: true` set when `newRef === 'working-tree'`, absent otherwise
3. **`updateComment`** — updates fields, preserves `id` and `createdAt`, bumps `updatedAt`; returns `null` for unknown ID
4. **`deleteComment`** — removes comment; returns `false` for unknown ID
5. **`getComment`** — returns correct comment; `null` for unknown
6. **`addReply`** — appends reply to correct comment; returns `null` for unknown comment
7. **`getCommentCounts`** — returns correct counts across multiple storage files
8. **`listAllComments`** — flattens comments from multiple files
9. **Atomic write** — simulate write failure (mock `fs.promises.rename` to throw); verifies `.tmp` file is cleaned up
10. **Route: POST `/api/diff-comments/:wsId`** — 400 on missing `context`; 201 on valid body
11. **Route: PATCH `/api/diff-comments/:wsId/:key/:id`** — 404 for unknown ID; 200 on success
12. **Route: DELETE `/api/diff-comments/:wsId/:key/:id`** — 404 for unknown; 204 on success
13. **Route: GET `/api/diff-comment-counts/:wsId`** — returns `{ counts }` map

Use a temp directory (`os.tmpdir()` + random suffix) as `dataDir`; clean up in `afterEach`.

## Acceptance Criteria

- [ ] `DiffCommentsManager` stores and retrieves comments from `{dataDir}/diff-comments/{wsId}/{hash}.json`
- [ ] Storage key for `newRef === 'working-tree'` differs from the key for `newRef === 'HEAD'` with same other fields
- [ ] Comments added with `newRef === 'working-tree'` have `ephemeral: true`
- [ ] Writes are atomic (`.tmp` → rename)
- [ ] All eight REST endpoints respond with correct status codes and JSON shapes
- [ ] `registerDiffCommentsRoutes` and `DiffCommentsManager` are exported from `packages/coc/src/server/index.ts`
- [ ] All new Vitest tests pass (`npm run test:run` inside `packages/coc`)
- [ ] `npm run build` succeeds with no TypeScript errors

## Dependencies

- **Commit 001** — `DiffComment`, `DiffCommentContext` types in `pipeline-core/src/editor/types.ts` must be importable from `@plusplusoneplusplus/pipeline-core`

## Assumed Prior State

- `pipeline-core` exports `DiffComment` and `DiffCommentContext` from its public surface (`packages/pipeline-core/src/index.ts` or via a subpath)
- `packages/coc/src/server/task-comments-handler.ts` exists as shown above (the pattern being mirrored)
- `packages/coc/src/server/index.ts` already imports and calls `registerTaskCommentsRoutes` at the location described
