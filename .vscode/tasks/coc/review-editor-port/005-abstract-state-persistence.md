---
status: pending
---

# 005: Abstract state persistence layer

## Summary

Define a `StateStore` interface that abstracts VS Code's `Memento` (workspaceState) API into a portable `get/set` contract. Provide three implementations — `VscodeStateStore` (wraps `context.workspaceState`), `FileStateStore` (JSON file on disk for serve mode), and `InMemoryStateStore` (for tests). Update `ReviewEditorViewProvider` to accept a `StateStore` instead of reaching into `context.workspaceState` directly.

## Motivation

`ReviewEditorViewProvider` calls `this.context.workspaceState.get()` / `.update()` in eight places across four distinct keys. These are VS Code Memento API calls that have no equivalent in a standalone HTTP server. Extracting an interface lets the serve-mode router (from commit 004) inject a `FileStateStore` that persists to `~/.coc/review-state.json`, while the VS Code extension continues using the existing Memento backend unchanged.

## State Keys Inventory

All `workspaceState` access in `review-editor-view-provider.ts`:

| # | Key pattern | Type | Lines | Purpose |
|---|-------------|------|-------|---------|
| 1 | `mdReview.collapsedSections.{filePath}` | `string[]` | 150, 158 | Per-file collapsed section IDs |
| 2 | `workspaceShortcuts.recentPrompts` | `Array<{absolutePath, relativePath, name, lastUsed}>` | 1648, 1682 | Last 5 used prompt files |
| 3 | `workspaceShortcuts.recentSkills` | `Array<{name, lastUsed}>` | 1695, 1717 | Last 5 used skills |
| 4 | `followPrompt.lastSelection` | `{mode, model}` | 1965, 1979 | Last Follow Prompt dialog selection |

## Changes

### Files to Create

1. **`src/shortcuts/markdown-comments/state-store.ts`**

   The `StateStore` interface and all three implementations in one file:

   ```typescript
   /**
    * Portable key-value state persistence.
    * Abstracts VS Code Memento for use in both extension and serve mode.
    */
   export interface StateStore {
       /** Get a value by key. Returns defaultValue (or undefined) if not set. */
       get<T>(key: string, defaultValue?: T): T | undefined;
       /** Set a value by key. Implementations may persist asynchronously. */
       set(key: string, value: unknown): Promise<void>;
   }
   ```

   **`VscodeStateStore`** — wraps `vscode.Memento`:

   ```typescript
   import * as vscode from 'vscode';

   export class VscodeStateStore implements StateStore {
       constructor(private readonly memento: vscode.Memento) {}

       get<T>(key: string, defaultValue?: T): T | undefined {
           return this.memento.get<T>(key, defaultValue as T);
       }

       async set(key: string, value: unknown): Promise<void> {
           await this.memento.update(key, value);
       }
   }
   ```

   **`InMemoryStateStore`** — for unit tests:

   ```typescript
   export class InMemoryStateStore implements StateStore {
       private readonly data = new Map<string, unknown>();

       get<T>(key: string, defaultValue?: T): T | undefined {
           if (this.data.has(key)) {
               return this.data.get(key) as T;
           }
           return defaultValue;
       }

       async set(key: string, value: unknown): Promise<void> {
           this.data.set(key, value);
       }

       /** Test helper: clear all stored state. */
       clear(): void {
           this.data.clear();
       }
   }
   ```

2. **`packages/pipeline-core/src/file-state-store.ts`**

   JSON-file-backed implementation for serve mode, following the `FileProcessStore` atomic-write pattern:

   ```typescript
   import * as fs from 'fs';
   import * as path from 'path';
   import { StateStore } from './state-store';

   export class FileStateStore implements StateStore {
       private cache: Record<string, unknown> | null = null;
       private readonly filePath: string;

       constructor(filePath: string) {
           this.filePath = filePath;
       }

       get<T>(key: string, defaultValue?: T): T | undefined {
           const data = this.readAll();
           if (key in data) {
               return data[key] as T;
           }
           return defaultValue;
       }

       async set(key: string, value: unknown): Promise<void> {
           const data = this.readAll();
           data[key] = value;
           this.cache = data;
           await this.writeAll(data);
       }

       private readAll(): Record<string, unknown> {
           if (this.cache) return this.cache;
           try {
               const raw = fs.readFileSync(this.filePath, 'utf-8');
               this.cache = JSON.parse(raw);
               return this.cache!;
           } catch {
               this.cache = {};
               return this.cache;
           }
       }

       private async writeAll(data: Record<string, unknown>): Promise<void> {
           const dir = path.dirname(this.filePath);
           fs.mkdirSync(dir, { recursive: true });
           const tmpPath = this.filePath + '.tmp';
           fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
           fs.renameSync(tmpPath, this.filePath);
       }
   }
   ```

   The `StateStore` interface must also be re-exported from `pipeline-core` so that `FileStateStore` and the interface live in the same package (no VS Code dependency). Place a minimal copy of the interface at:

3. **`packages/pipeline-core/src/state-store.ts`**

   ```typescript
   /**
    * Portable key-value state persistence interface.
    * Shared between extension (VscodeStateStore) and serve mode (FileStateStore).
    */
   export interface StateStore {
       get<T>(key: string, defaultValue?: T): T | undefined;
       set(key: string, value: unknown): Promise<void>;
   }
   ```

   Export from `packages/pipeline-core/src/index.ts`.

   The extension-side `src/shortcuts/markdown-comments/state-store.ts` re-exports this interface and adds the VS-Code-specific `VscodeStateStore` and `InMemoryStateStore`.

### Files to Modify

1. **`src/shortcuts/markdown-comments/review-editor-view-provider.ts`**

   - Import `StateStore` (from `./state-store`).
   - Add a `private readonly stateStore: StateStore` field.
   - Change the constructor to accept `StateStore` instead of (or in addition to) `context: vscode.ExtensionContext`. The `context` parameter is still needed for `extensionUri` (webview resource roots), so keep it but create the `VscodeStateStore` at the call site:
     ```typescript
     constructor(
         private readonly context: vscode.ExtensionContext,
         private readonly commentsManager: CommentsManager,
         private readonly stateStore: StateStore,
         private readonly aiProcessManager?: IAIProcessManager
     ) { ... }
     ```
   - Replace all 8 `this.context.workspaceState.get(...)` / `.update(...)` calls with `this.stateStore.get(...)` / `.set(...)`:

     | Location | Before | After |
     |----------|--------|-------|
     | Line 150 | `this.context.workspaceState.get<string[]>(key, [])` | `this.stateStore.get<string[]>(key, []) ?? []` |
     | Line 158 | `await this.context.workspaceState.update(key, sections)` | `await this.stateStore.set(key, sections)` |
     | Line 1648 | `this.context.workspaceState.get<Array<...>>(RECENT_PROMPTS_KEY, [])` | `this.stateStore.get<Array<...>>(RECENT_PROMPTS_KEY) ?? []` |
     | Line 1682 | `await this.context.workspaceState.update(RECENT_PROMPTS_KEY, ...)` | `await this.stateStore.set(RECENT_PROMPTS_KEY, ...)` |
     | Line 1695 | `this.context.workspaceState.get<Array<...>>(RECENT_SKILLS_KEY, [])` | `this.stateStore.get<Array<...>>(RECENT_SKILLS_KEY) ?? []` |
     | Line 1717 | `await this.context.workspaceState.update(RECENT_SKILLS_KEY, ...)` | `await this.stateStore.set(RECENT_SKILLS_KEY, ...)` |
     | Line 1965 | `this.context.workspaceState.get<...>('followPrompt.lastSelection')` | `this.stateStore.get<...>('followPrompt.lastSelection')` |
     | Line 1979 | `this.context.workspaceState.update('followPrompt.lastSelection', ...)` | `this.stateStore.set('followPrompt.lastSelection', ...)` |

2. **Call sites that construct `ReviewEditorViewProvider`**

   Find all `new ReviewEditorViewProvider(context, ...)` calls and insert a `new VscodeStateStore(context.workspaceState)` argument in the new parameter position. Likely in `src/extension.ts` or a registration helper. The change is mechanical:

   ```typescript
   // Before
   new ReviewEditorViewProvider(context, commentsManager, aiProcessManager)
   // After
   new ReviewEditorViewProvider(context, commentsManager, new VscodeStateStore(context.workspaceState), aiProcessManager)
   ```

3. **`packages/pipeline-core/src/index.ts`**

   Add exports:
   ```typescript
   export { StateStore } from './state-store';
   export { FileStateStore } from './file-state-store';
   ```

## Implementation Notes

- **Interface location split:** The `StateStore` interface is defined in `pipeline-core` (no VS Code dependency) and re-exported from the extension-side `state-store.ts`. This lets `FileStateStore` in `pipeline-core` implement the same interface without importing from the extension.
- **Atomic writes:** `FileStateStore` follows the established `FileProcessStore` pattern — write to `.tmp` then `rename`. See `packages/pipeline-core/src/file-process-store.ts` lines 261–264.
- **Read caching:** `FileStateStore` caches the parsed JSON in memory after first read. Since serve mode is a single-process server, there are no external writers — the cache is always fresh. The cache is invalidated on every `set()`.
- **`get()` default value contract:** VS Code's `Memento.get(key, defaultValue)` returns `defaultValue` when the key is absent. Our `StateStore.get()` mirrors this signature. The `?? []` fallback in the provider handles the case where `defaultValue` is not passed.
- **No changes to webview scripts or message types.** The state abstraction is entirely server-side; the webview communicates via the same `postMessage` protocol.
- **`followPrompt.lastSelection` backward compat:** The `getLastFollowPromptSelection()` method handles legacy `'queued'` mode values. This logic stays in the provider unchanged — it's business logic, not a persistence concern.
- **Constructor parameter ordering:** Adding `stateStore` before the optional `aiProcessManager` parameter avoids breaking the optional-last convention. Since this is an internal API with very few call sites, the signature change is safe.

## Tests

Add `src/test/suite/state-store.test.ts` (Mocha, matching extension test conventions):

1. **InMemoryStateStore — get returns undefined for missing key** — `store.get('missing')` returns `undefined`.
2. **InMemoryStateStore — get returns defaultValue for missing key** — `store.get('missing', [])` returns `[]`.
3. **InMemoryStateStore — set then get round-trip** — Set a string value, get it back, assert equal.
4. **InMemoryStateStore — set then get complex object** — Set `{mode: 'background', model: 'gpt-4'}`, get it back, deep-equal.
5. **InMemoryStateStore — set overwrites previous value** — Set key twice with different values, verify last write wins.
6. **InMemoryStateStore — clear removes all keys** — Set two keys, call `clear()`, verify both return `undefined`.
7. **VscodeStateStore — delegates get to Memento** — Create a mock `Memento`, wrap in `VscodeStateStore`, call `get()`, verify `memento.get()` was called with correct args.
8. **VscodeStateStore — delegates set to Memento.update** — Call `set()`, verify `memento.update()` was called.

Add `packages/pipeline-core/test/file-state-store.test.ts` (Vitest, matching pipeline-core test conventions):

9. **FileStateStore — creates file on first set** — Set a key, verify JSON file exists with correct content.
10. **FileStateStore — get returns undefined when file does not exist** — New store pointing at non-existent file, `get('x')` returns `undefined`.
11. **FileStateStore — get returns defaultValue when file does not exist** — `get('x', 'fallback')` returns `'fallback'`.
12. **FileStateStore — round-trip multiple keys** — Set three keys with different types (string, number, array), read back, verify all correct.
13. **FileStateStore — atomic write leaves no .tmp file** — Set a key, verify no `.tmp` file remains after write completes.
14. **FileStateStore — creates parent directories** — Point store at `<tmpdir>/nested/dir/state.json`, set a key, verify file is created.
15. **FileStateStore — handles corrupt JSON gracefully** — Write invalid JSON to the file, call `get()`, verify returns `undefined` / default (no throw).
16. **FileStateStore — set overwrites single key without affecting others** — Set keys `a` and `b`, update only `a`, verify `b` unchanged.

## Acceptance Criteria

- [ ] `StateStore` interface exported from `pipeline-core`.
- [ ] `FileStateStore` in `pipeline-core` persists to JSON with atomic writes.
- [ ] `VscodeStateStore` wraps `Memento` with zero behaviour change.
- [ ] `InMemoryStateStore` works for tests with `get`/`set`/`clear`.
- [ ] `ReviewEditorViewProvider` uses `StateStore` — zero direct `workspaceState` calls remain.
- [ ] Constructor call sites updated to pass `VscodeStateStore`.
- [ ] All 8 state access points migrated (4 keys × get + set).
- [ ] Extension compiles with no errors (`npm run compile`).
- [ ] All existing extension tests pass (`npm test`).
- [ ] All pipeline-core tests pass (`npm run test:run` in `packages/pipeline-core/`).
- [ ] New test files added with ≥16 test cases total.

## Dependencies

Depends on **004** (extract router from ReviewEditorViewProvider) — the router is the primary consumer of `StateStore` in serve mode. However, the interface extraction and `VscodeStateStore` wiring can be done independently and merged first.
