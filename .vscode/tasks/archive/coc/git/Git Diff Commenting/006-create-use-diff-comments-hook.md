---
status: done
---

# 006: Create `useDiffComments` hook

## Summary

Implement a React hook `useDiffComments(wsId, context)` that provides full CRUD operations, AI flows, and WebSocket subscription for diff comments. The hook mirrors `useTaskComments` in structure and return shape, adapted for the diff-comment domain: the identifying key is a `DiffCommentContext` object instead of a single `taskPath` string, and all HTTP calls target the `/api/diff-comments/` route family introduced in commit 005.

## Motivation

All three diff viewer pages (commit 007 — `CommitDetail`, `WorkingTreeFileDiff`, `BranchFileDiff`) need to load, create, and mutate comments against a specific diff reference. Centralising that logic in one hook avoids triplication, keeps component files focused on rendering, and ensures consistent cancellation semantics when the viewed diff changes (e.g., the user navigates from one commit to another).

## Changes

### Files to Create

**`packages/coc/src/server/spa/client/react/hooks/useDiffComments.ts`**

Primary deliverable. Full contents described in Implementation Notes.

### Files to Modify

None required by this commit. Commit 007 will import the hook from the path above.

### Files to Delete

None.

## Implementation Notes

### Types (sourced from commit 001)

The hook imports from `../../diff-comment-types` (created by commit 001). Relevant shapes:

```ts
// From diff-comment-types.ts (commit 001)

interface DiffCommentContext {
    repositoryId: string;
    oldRef: string;
    newRef: string;
    filePath: string;
}

interface DiffCommentSelection {
    diffLineStart: number;
    diffLineEnd: number;
    side: 'added' | 'removed' | 'context';
    oldLineStart?: number;
    oldLineEnd?: number;
    newLineStart?: number;
    newLineEnd?: number;
    boundingRect?: { top: number; left: number; width: number; height: number };
}

interface DiffComment {
    id: string;
    context: DiffCommentContext;
    selection: DiffCommentSelection;
    selectedText: string;
    comment: string;
    status: 'open' | 'resolved';
    category?: string;
    author?: string;
    createdAt: string;
    updatedAt: string;
    aiResponse?: string;
    replies?: DiffCommentReply[];
}
```

### Hook signature

```ts
export function useDiffComments(
    wsId: string,
    context: DiffCommentContext | null,
): UseDiffCommentsReturn
```

`context === null` (before the diff is loaded) must short-circuit all network calls gracefully.

### URL helpers

```ts
// Base collection URL (GET list, POST create)
function diffCommentsUrl(wsId: string, ctx: DiffCommentContext): string {
    const params = new URLSearchParams({
        repo: ctx.repositoryId,
        oldRef: ctx.oldRef,
        newRef: ctx.newRef,
        file: ctx.filePath,
    });
    return `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}?${params}`;
}

// Single-resource URL (PATCH, DELETE)
function diffCommentUrl(wsId: string, ctx: DiffCommentContext, commentId: string): string {
    return diffCommentsUrl(wsId, ctx) + `&commentId=${encodeURIComponent(commentId)}`;
}
// NOTE: server route is /api/diff-comments/:wsId/:commentId — adjust if the
// server uses path segments instead of query params for the comment id.
// Exact URL shape must match commit 005's route registration.
```

> **Adjust the single-resource URL pattern** to match whatever commit 005 registered. If the server uses `/api/diff-comments/:wsId/:commentId`, then:
> ```ts
> function diffCommentUrl(wsId: string, ctx: DiffCommentContext, commentId: string): string {
>     const params = new URLSearchParams({ repo: ctx.repositoryId, oldRef: ctx.oldRef,
>         newRef: ctx.newRef, file: ctx.filePath });
>     return `${getApiBase()}/diff-comments/${encodeURIComponent(wsId)}/${encodeURIComponent(commentId)}?${params}`;
> }
> ```

### State

```ts
const [comments, setComments] = useState<DiffComment[]>([]);
const [loading, setLoading]   = useState(true);
const [error, setError]       = useState<string | null>(null);
const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
const [aiErrors, setAiErrors]         = useState<Map<string, string>>(new Map());
const [resolving, setResolving]               = useState(false);
const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null);
const mountedRef = useRef(true);
```

No `commentCounts` state — counts are task-centric and have no equivalent for diffs.

### Re-fetch on context change

Use a `useEffect` on `[wsId, context]` (deep-compare context by serialising to a stable key):

```ts
const contextKey = context
    ? `${context.repositoryId}:${context.oldRef}:${context.newRef}:${context.filePath}`
    : null;

useEffect(() => {
    fetchComments();
}, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

Pending `fetch` calls from a previous context are silently ignored via `mountedRef` (already present) — no explicit AbortController needed unless future performance work demands it.

### `fetchComments`

```ts
const fetchComments = useCallback(async () => {
    if (!wsId || !context) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
        const res = await fetch(diffCommentsUrl(wsId, context));
        if (!res.ok) throw new Error('Failed to load diff comments');
        const data = await res.json();
        if (mountedRef.current) setComments(data.comments ?? []);
    } catch (err) {
        if (mountedRef.current) {
            setError(err instanceof Error ? err.message : 'Failed to load diff comments');
            setComments([]);
        }
    } finally {
        if (mountedRef.current) setLoading(false);
    }
}, [wsId, context]);
```

### `addComment`

```ts
addComment(
    selection: DiffCommentSelection,
    selectedText: string,
    text: string,
    category?: string,
): Promise<DiffComment>
```

POST body:
```json
{
  "context": { "repositoryId": "...", "oldRef": "...", "newRef": "...", "filePath": "..." },
  "selection": { ... },
  "selectedText": "...",
  "comment": "...",
  "category": "..."   // optional
}
```

Appends the returned comment to local state.

### `updateComment` / `resolveComment` / `unresolveComment` / `deleteComment`

Mirror `useTaskComments` exactly, using `diffCommentUrl` instead of `commentUrl`.

- `resolveComment(id)` → PATCH `{ status: 'resolved' }`
- `unresolveComment(id)` → PATCH `{ status: 'open' }`
- `deleteComment(id)` → DELETE, then filter from local state

### `askAI`

```ts
askAI(id: string, options?: AskAIOptions): Promise<void>
```

POST to `diffCommentUrl(wsId, context, id) + '/ask-ai'` with `{ commandId?, customQuestion? }`.
The server returns `{ aiResponse }` directly (no queue) or `{ taskId }` for async queue polling — reuse `pollTaskResult` from `useTaskComments` verbatim. On success, merge `aiResponse` into the matching comment in state.

### `resolveWithAI` / `fixWithAI` / `copyResolvePrompt`

Omit in the initial implementation — diff comments don't have a document-content write-back path analogous to task markdown files. Stub them as `undefined` or omit from the return type, and add a TODO comment. This keeps the surface area minimal until a use-case is defined.

### WebSocket subscription

```ts
useEffect(() => {
    if (!context) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
    ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe-diff', context }));
    });
    ws.addEventListener('message', (event) => {
        try {
            const msg = JSON.parse(event.data as string) as { type: string; context?: DiffCommentContext };
            const isSameDiff =
                msg.context?.repositoryId === context.repositoryId &&
                msg.context?.oldRef      === context.oldRef &&
                msg.context?.newRef      === context.newRef &&
                msg.context?.filePath    === context.filePath;
            if (msg.type === 'diff-comment-updated' && isSameDiff && mountedRef.current) {
                void fetchComments();
            }
        } catch { /* ignore */ }
    });
    return () => { ws.close(); };
}, [contextKey, fetchComments]); // eslint-disable-line react-hooks/exhaustive-deps
```

The `subscribe-diff` message type is new. The server-side WebSocket handler (commit 005 or a follow-up) must support it; if not yet implemented, the subscription simply receives no matching events and the hook degrades gracefully to polling-on-mutation.

### Working-tree ephemeral warning

The hook exposes a derived boolean:

```ts
const isEphemeral = context?.newRef === 'working-tree' ?? false;
```

Include `isEphemeral` in the return type so the consumer (diff viewer page) can render the warning banner without needing to inspect `context` directly.

### Return type

```ts
export interface UseDiffCommentsReturn {
    comments: DiffComment[];
    loading: boolean;
    error: string | null;
    isEphemeral: boolean;
    addComment: (
        selection: DiffCommentSelection,
        selectedText: string,
        text: string,
        category?: string,
    ) => Promise<DiffComment>;
    updateComment: (id: string, req: UpdateDiffCommentRequest) => Promise<DiffComment>;
    deleteComment: (id: string) => Promise<void>;
    resolveComment: (id: string) => Promise<DiffComment>;
    unresolveComment: (id: string) => Promise<DiffComment>;
    askAI: (id: string, options?: AskAIOptions) => Promise<void>;
    aiLoadingIds: Set<string>;
    aiErrors: Map<string, string>;
    clearAiError: (id: string) => void;
    resolving: boolean;
    resolvingCommentId: string | null;
    refresh: () => Promise<void>;
}
```

`UpdateDiffCommentRequest`:
```ts
export interface UpdateDiffCommentRequest {
    comment?: string;
    status?: 'open' | 'resolved';
    category?: string;
}
```

`AskAIOptions` can be imported from `useTaskComments` or redeclared locally.

### Re-used utilities

Import `pollTaskResult` and `getApiBase`/`getWsPath` from the same paths used by `useTaskComments`:

```ts
import { getApiBase, getWsPath } from '../utils/config';
// pollTaskResult — copy/inline from useTaskComments or extract to a shared util
```

If `pollTaskResult` is extracted to a shared utility (e.g., `../utils/pollTaskResult.ts`) as part of this commit, that is acceptable but not required.

## Tests

File: `packages/coc/src/server/spa/client/react/hooks/__tests__/useDiffComments.test.ts`

Use Vitest + `@testing-library/react` (renderHook).

| Test case | Description |
|-----------|-------------|
| `returns empty state when context is null` | Hook should not fetch; `loading` immediately `false`, `comments` empty |
| `fetches comments on mount` | Mock `fetch` returning `{ comments: [...] }`; assert state after hook mounts |
| `re-fetches when context changes` | Render with context A, then update to context B; assert two fetch calls with different query params |
| `addComment posts and appends to state` | Mock POST response; call `addComment`; assert state has new comment |
| `resolveComment patches status to resolved` | Mock PATCH; assert local comment status updated |
| `unresolveComment patches status to open` | Mirror above |
| `deleteComment removes comment from state` | Mock DELETE; assert comment absent from state |
| `askAI sets aiLoadingIds during request` | Assert loading flag set and cleared |
| `askAI stores error on failure` | Mock failing fetch; assert `aiErrors` populated |
| `clearAiError removes error entry` | After error set, call `clearAiError`; assert map is empty |
| `isEphemeral true when newRef is working-tree` | Pass context with `newRef: 'working-tree'`; assert flag |
| `WebSocket triggers refresh on diff-comment-updated` | Simulate WS message matching context; assert fetch called again |

## Acceptance Criteria

1. `useDiffComments(wsId, null)` returns `loading: false`, `comments: []`, no network requests.
2. `useDiffComments(wsId, context)` fetches `GET /api/diff-comments/{wsId}?repo=...&oldRef=...&newRef=...&file=...` on mount.
3. Changing `context` cancels stale state updates and triggers a fresh fetch.
4. `addComment` posts the correct body shape (context + selection + selectedText + comment).
5. `resolveComment` / `unresolveComment` / `deleteComment` / `updateComment` call the correct per-comment URLs.
6. `askAI` handles both synchronous `{ aiResponse }` and async `{ taskId }` server responses.
7. `isEphemeral` is `true` iff `context.newRef === 'working-tree'`.
8. WebSocket subscription sends `{ type: 'subscribe-diff', context }` on open and closes cleanly on unmount.
9. All tests listed above pass.
10. TypeScript compiles without errors (`npm run build`).

## Dependencies

| Commit | Provides |
|--------|----------|
| 001 | `DiffCommentSelection`, `DiffCommentContext`, `DiffComment` types in `diff-comment-types.ts` |
| 005 | Server routes `GET/POST /api/diff-comments/:wsId` and `PATCH/DELETE /api/diff-comments/:wsId/:commentId` |

## Assumed Prior State

- `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts` exists and is stable.
- `packages/coc/src/server/spa/client/react/utils/config.ts` exports `getApiBase()` and `getWsPath()`.
- `packages/coc/src/server/spa/client/diff-comment-types.ts` exports `DiffComment`, `DiffCommentContext`, `DiffCommentSelection` (commit 001).
- `/api/diff-comments/:wsId` accepts the query params described above and returns `{ comments: DiffComment[] }` (commit 005).
- `/api/diff-comments/:wsId/:commentId` accepts PATCH and DELETE (commit 005).
- `/api/diff-comments/:wsId/:commentId/ask-ai` accepts POST and returns `{ aiResponse }` or `{ taskId }` (commit 005).
- `/api/queue/:taskId` exists for async AI polling (already present in coc-server).
