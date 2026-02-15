---
status: pending
---

# 003: Create WikiManager for Multi-Wiki Lifecycle

## Summary
Create WikiManager class that manages per-wiki runtime state (WikiData, ContextBuilder, ConversationSessionManager, FileWatcher) with register/unregister lifecycle.

## Motivation
WikiManager is the bridge between the ProcessStore (persistent wiki registry) and the runtime state needed to serve wiki content and handle AI Q&A. It enables multi-wiki support by managing independent state per wiki.

## Changes

### Files to Create
- `packages/coc/src/server/wiki/wiki-manager.ts` — Main WikiManager class

### Files to Modify
- `packages/coc/src/server/wiki/index.ts` — Export WikiManager

### Files to Delete
- (none)

## Implementation Notes

### Current deep-wiki wiring (from `createServer` in `packages/deep-wiki/src/server/index.ts`)

The existing server initializes these four components in sequence for a **single** wiki:

1. **WikiData** (`new WikiData(wikiDir)` → `.load()`) — Eagerly reads `component-graph.json`, markdown articles, analyses, and theme files from `wikiDir`. Provides `.graph`, `.getMarkdownData()`, `.getThemeMarkdownData()`, `.reload()`.

2. **ContextBuilder** (`new ContextBuilder(graph, markdownData, themeMarkdownData)`) — Builds a TF-IDF index in its constructor (`this.buildIndex()`). Takes `ComponentGraph` + two markdown dictionaries. Used by the ask-handler to retrieve relevant context for AI questions. Created only when `aiEnabled` is true.

3. **ConversationSessionManager** (`new ConversationSessionManager({ sendMessage })`) — Wraps an `AskAIFunction` and tracks multi-turn conversation sessions with idle cleanup (default 10 min timeout, max 5 sessions, 1 min cleanup interval). Has `create()`, `get()`, `send()`, `destroy()`, `destroyAll()` methods. Created only when `aiSendMessage` is provided.

4. **FileWatcher** (`new FileWatcher({ repoPath, wikiDir, componentGraph, debounceMs, onChange, onError })` → `.start()`) — Watches `repoPath` recursively with `fs.watch`, debounces (default 2s), maps changed files to affected component IDs via the component graph, calls `onChange(affectedIds)`. Has `.start()`, `.stop()`, `.isWatching`. Created only when `watch && repoPath` are both set.

### AI function creation (from `serve.ts` `createAISendFunction`)

The `AskAIFunction` signature is:
```typescript
type AskAIFunction = (prompt: string, options?: {
    model?: string;
    workingDirectory?: string;
    onStreamingChunk?: (chunk: string) => void;
}) => Promise<string>;
```

In deep-wiki's serve command, this is built by:
1. Dynamically importing `getCopilotSDKService` from `@plusplusoneplusplus/pipeline-core`
2. Calling `service.isAvailable()` to verify SDK access
3. Returning a closure that calls `service.sendMessage({ prompt, model, workingDirectory, usePool: false, loadDefaultMcpConfig: false, onStreamingChunk })`

For WikiManager in CoC, the `AskAIFunction` should be **injected** (not created internally) — the caller (e.g. wiki route registration or the serve command) provides it. This keeps WikiManager decoupled from `pipeline-core` SDK details.

### WikiManager design

Follow the **TaskWatcher pattern** from `packages/coc/src/server/task-watcher.ts` — a Map-based registry keyed by wiki ID, with `register`/`unregister`/`disposeAll` lifecycle methods.

```typescript
interface WikiRegistration {
    wikiId: string;
    wikiDir: string;           // Resolved path to .wiki output directory
    repoPath?: string;         // Original repo path (for FileWatcher + AI workingDirectory)
    aiEnabled: boolean;
    aiModel?: string;
    watch?: boolean;
    watchDebounceMs?: number;
    title?: string;
    theme?: 'light' | 'dark' | 'auto';
}

interface WikiRuntime {
    registration: WikiRegistration;
    wikiData: WikiData;
    contextBuilder: ContextBuilder | null;  // Lazily initialized on first AI request
    sessionManager: ConversationSessionManager | null;
    fileWatcher: FileWatcher | null;
}
```

**Class shape:**

```typescript
class WikiManager {
    private wikis = new Map<string, WikiRuntime>();
    private aiSendMessage: AskAIFunction | null;

    constructor(options?: { aiSendMessage?: AskAIFunction });

    // Register a wiki — loads WikiData eagerly, defers ContextBuilder
    register(registration: WikiRegistration): void;

    // Unregister — destroys sessions, stops watcher, removes from map
    unregister(wikiId: string): boolean;

    // Get runtime for a wiki (used by route handlers)
    get(wikiId: string): WikiRuntime | undefined;

    // Get all registered wiki IDs
    getRegisteredIds(): string[];

    // Ensure ContextBuilder is initialized (lazy — called on first /api/ask)
    ensureContextBuilder(wikiId: string): ContextBuilder;

    // Reload wiki data (e.g. after file changes)
    reloadWikiData(wikiId: string): void;

    // Dispose all wikis (server shutdown)
    disposeAll(): void;
}
```

### Lazy ContextBuilder strategy

ContextBuilder builds a TF-IDF index in its constructor, which involves tokenizing all markdown articles. For multi-wiki scenarios, we don't want to build indexes for wikis that never receive AI questions.

- `register()` sets `contextBuilder: null`
- `ensureContextBuilder(wikiId)` checks if `contextBuilder` is null, and if so:
  1. Calls `wikiData.getMarkdownData()` and `wikiData.getThemeMarkdownData()`
  2. Creates `new ContextBuilder(wikiData.graph, markdownData, themeMarkdownData)`
  3. Stores on the runtime and returns it
- After a `reloadWikiData()` call, the existing `contextBuilder` is invalidated (set to null) so the next AI request rebuilds it with fresh data

### FileWatcher integration

When `registration.watch` is true and `registration.repoPath` is set:
- `register()` creates a `FileWatcher` with:
  - `repoPath`: `registration.repoPath`
  - `wikiDir`: `registration.wikiDir`
  - `componentGraph`: `wikiData.graph`
  - `debounceMs`: `registration.watchDebounceMs` (or default 2000)
  - `onChange(affectedIds)`: calls `this.reloadWikiData(wikiId)` and emits an event/callback
  - `onError(err)`: logs or emits error event
- Calls `fileWatcher.start()`
- `unregister()` calls `fileWatcher.stop()`

### ConversationSessionManager per wiki

When `aiEnabled` and `aiSendMessage` is available:
- `register()` creates `new ConversationSessionManager({ sendMessage: this.aiSendMessage })` per wiki
- Each wiki has its own session pool (max 5 sessions, 10 min idle timeout)
- `unregister()` calls `sessionManager.destroyAll()` to clear sessions and stop cleanup timer

### Cleanup on unregister / disposeAll

`unregister(wikiId)`:
1. `sessionManager?.destroyAll()` — clears sessions, stops cleanup interval
2. `fileWatcher?.stop()` — closes `fs.watch`, clears debounce timer
3. `wikis.delete(wikiId)` — removes from registry

`disposeAll()`:
- Iterates all registered IDs and calls `unregister()` on each

### Error handling

- `register()` validates that `wikiDir` exists and contains `component-graph.json` (same checks as `serve.ts` lines 90-102). Throws an error if invalid.
- `WikiData.load()` throws if graph file is missing/malformed — `register()` should catch and re-throw with wiki ID context.
- `FileWatcher.start()` failures are non-fatal — log warning, set `fileWatcher` to null.
- `ensureContextBuilder()` failures (e.g. no markdown data) should throw so the ask-handler can return a 500.

### Event emission for watcher changes

WikiManager should accept an optional `onWikiReloaded` callback:
```typescript
constructor(options?: {
    aiSendMessage?: AskAIFunction;
    onWikiReloaded?: (wikiId: string, affectedComponentIds: string[]) => void;
    onWikiError?: (wikiId: string, error: Error) => void;
});
```
This lets the server layer (router/WebSocket) react to reload events without WikiManager knowing about HTTP/WS internals — mirroring how `TaskWatcher` takes a `TasksChangedCallback` in its constructor.

## Tests

Test file: `packages/coc/test/server/wiki/wiki-manager.test.ts`

### Register / unregister lifecycle
- Register a wiki with valid `wikiDir` → `get(id)` returns runtime with loaded WikiData
- `getRegisteredIds()` includes the wiki ID
- `unregister(id)` → `get(id)` returns undefined
- `unregister` unknown ID → returns false (no crash)
- Double `register` with same ID → throws or replaces cleanly

### Multi-wiki independence
- Register 2 wikis with different `wikiDir` paths
- Each has its own `WikiData` instance (different `.graph`)
- Each has its own `ConversationSessionManager` (sessions are isolated)
- Unregistering one doesn't affect the other

### Lazy ContextBuilder
- After `register()`, `runtime.contextBuilder` is null
- `ensureContextBuilder(id)` creates it and returns a valid `ContextBuilder`
- Subsequent calls return the same instance (cached)
- After `reloadWikiData(id)`, `runtime.contextBuilder` is null again (invalidated)
- Next `ensureContextBuilder(id)` rebuilds with fresh data

### Cleanup on dispose
- Register 2 wikis with session managers and file watchers
- Call `disposeAll()`
- Verify `sessionManager.destroyAll()` called (size === 0)
- Verify `fileWatcher.stop()` called (isWatching === false)
- Verify internal map is empty

### Invalid wiki directory
- `register()` with non-existent `wikiDir` → throws error mentioning path
- `register()` with `wikiDir` missing `component-graph.json` → throws error
- Verify nothing is left in the registry after a failed register

### FileWatcher integration
- Register with `watch: true` and valid `repoPath` → `runtime.fileWatcher` is not null, `.isWatching` is true
- Register with `watch: false` → `runtime.fileWatcher` is null
- Register with `watch: true` but `repoPath` not set → `runtime.fileWatcher` is null
- `onWikiReloaded` callback fires when FileWatcher triggers onChange

### ConversationSessionManager integration
- Register with `aiEnabled: true` and `aiSendMessage` provided → `runtime.sessionManager` is not null
- Register with `aiEnabled: false` → `runtime.sessionManager` is null
- Register with `aiEnabled: true` but no `aiSendMessage` → `runtime.sessionManager` is null

## Acceptance Criteria
- [ ] WikiManager can register/unregister wikis
- [ ] Each wiki has independent WikiData, ContextBuilder, sessions
- [ ] ContextBuilder lazily initialized on first AI request
- [ ] ContextBuilder invalidated on wiki data reload
- [ ] FileWatcher optional and per-wiki
- [ ] ConversationSessionManager created only when AI is enabled and sendMessage available
- [ ] Proper cleanup on unregister (sessions destroyed, watchers stopped)
- [ ] Proper cleanup on disposeAll (all wikis cleaned up)
- [ ] Invalid wiki directory throws descriptive error
- [ ] Event callbacks (onWikiReloaded, onWikiError) wired correctly
- [ ] CoC build succeeds
- [ ] All new tests pass on Linux, macOS, and Windows

## Dependencies
- Depends on: 002 (data layer modules — WikiData, ContextBuilder, ConversationSessionManager, FileWatcher, AskAIFunction type available in CoC)
