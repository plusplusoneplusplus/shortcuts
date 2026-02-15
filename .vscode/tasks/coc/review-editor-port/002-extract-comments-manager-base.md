---
status: pending
commit: "002"
title: "Extract CommentsManagerBase from VS Code dependencies"
---

# 002 — Extract CommentsManagerBase from VS Code dependencies

## Goal

Make `CommentsManagerBase` (currently in `src/shortcuts/markdown-comments/comments-manager-base.ts`) portable to pure Node.js by removing all `vscode` imports. The VS Code extension must continue to work unchanged after this refactor.

## Current vscode dependencies in `comments-manager-base.ts`

| Line(s) | Usage | Replacement |
|---------|-------|-------------|
| 7 | `import * as vscode from 'vscode'` | Remove entirely |
| 30 | `implements vscode.Disposable` | Inline `Disposable` interface: `{ dispose(): void }` |
| 34 | `fileWatcher?: vscode.FileSystemWatcher` | New `FileWatcher` interface (see below) |
| 37 | `new vscode.EventEmitter<TEvent>()` | Node.js `EventEmitter`-backed typed wrapper (see below) |
| 38 | `vscode.Event<TEvent>` | Typed listener signature `(listener: (e: TEvent) => void) => Disposable` |
| 414 | `new vscode.RelativePattern(...)` | Eliminated — pattern construction moves to the factory |
| 419 | `vscode.workspace.createFileSystemWatcher(pattern)` | Injected factory; base class no longer creates watchers directly |
| 430–438 | `this.fileWatcher.onDidChange/onCreate/onDidDelete` | Consumed via `FileWatcher` interface |
| 474 | `this._onDidChangeComments.dispose()` | Dispose on the typed emitter wrapper |

## Abstractions to introduce

### 1. `Disposable` interface (inline, no import needed)

```ts
export interface Disposable {
    dispose(): void;
}
```

Replaces `vscode.Disposable`. Matches the VS Code interface signature exactly, so VS Code callers don't break.

### 2. `TypedEventEmitter<T>` (minimal class)

A small class wrapping Node.js `EventEmitter` that exposes:

```ts
export class TypedEventEmitter<T> {
    /** Subscribe; returns a Disposable to unsubscribe */
    readonly event: (listener: (e: T) => void) => Disposable;
    /** Emit an event */
    fire(data: T): void;
    /** Clean up */
    dispose(): void;
}
```

This is a drop-in replacement for `vscode.EventEmitter<T>`. The `.event` property returns a function matching the `vscode.Event<T>` signature, so all consumers (`commentsManager.onDidChangeComments(...)`) keep working without changes.

Implementation: backed by a single `'event'` channel on `node:events` `EventEmitter`.

### 3. `FileWatcher` interface

```ts
export interface FileWatcher extends Disposable {
    onDidChange: (listener: () => void) => Disposable;
    onDidCreate: (listener: () => void) => Disposable;
    onDidDelete: (listener: () => void) => Disposable;
}
```

Matches the subset of `vscode.FileSystemWatcher` used in `setupFileWatcher()`.

### 4. `FileWatcherFactory` type

```ts
export type FileWatcherFactory = (configPath: string) => FileWatcher;
```

Accepts the config file path and returns a `FileWatcher`. The factory is responsible for constructing the watch pattern (glob, `RelativePattern`, `chokidar`, etc.).

## Changes file-by-file

### `src/shortcuts/markdown-comments/comments-manager-base.ts`

1. **Remove** `import * as vscode from 'vscode'` (line 7).

2. **Add** at top of file (or in a new `src/shortcuts/markdown-comments/event-utils.ts` — prefer inline to minimize file count):
   - `Disposable` interface
   - `TypedEventEmitter<T>` class (backed by `node:events`)
   - `FileWatcher` interface
   - `FileWatcherFactory` type

3. **Class declaration** (line 23–30):
   ```ts
   // Before:
   export abstract class CommentsManagerBase<...> implements vscode.Disposable {
   // After:
   export abstract class CommentsManagerBase<...> implements Disposable {
   ```

4. **Fields** (lines 34–38):
   ```ts
   // Before:
   protected fileWatcher?: vscode.FileSystemWatcher;
   protected readonly _onDidChangeComments = new vscode.EventEmitter<TEvent>();
   readonly onDidChangeComments: vscode.Event<TEvent> = this._onDidChangeComments.event;

   // After:
   protected fileWatcher?: FileWatcher;
   protected readonly _onDidChangeComments = new TypedEventEmitter<TEvent>();
   readonly onDidChangeComments = this._onDidChangeComments.event;
   ```

5. **Constructor** (lines 40–49): Add optional `fileWatcherFactory` parameter:
   ```ts
   constructor(
       workspaceRoot: string,
       configFileName: string,
       defaultConfig: TConfig,
       protected readonly fileWatcherFactory?: FileWatcherFactory
   )
   ```

6. **`setupFileWatcher()`** (lines 412–439): Replace body:
   ```ts
   protected setupFileWatcher(): void {
       if (!this.fileWatcherFactory) {
           return; // No watcher in pure Node.js environments
       }

       this.fileWatcher = this.fileWatcherFactory(this.configPath);

       const handleChange = () => {
           if (this.debounceTimer) {
               clearTimeout(this.debounceTimer);
           }
           this.debounceTimer = setTimeout(() => {
               this.loadComments();
           }, 300);
       };

       this.fileWatcher.onDidChange(handleChange);
       this.fileWatcher.onDidCreate(handleChange);
       this.fileWatcher.onDidDelete(() => {
           this.config = this.getDefaultConfig();
           this.fireEvent({
               type: 'comments-loaded',
               comments: []
           } as unknown as Partial<TEvent>);
       });
   }
   ```

7. **`dispose()`** (lines 467–475): No logic change needed — `this.fileWatcher?.dispose()` and `this._onDidChangeComments.dispose()` already match the new interfaces.

8. **Logger**: The `getExtensionLogger()` call (line 83, 104) comes from `../shared` which uses vscode internally. Replace with an injected logger or `console.warn`/`console.error` fallback. Two options:
   - **Option A (preferred):** Add optional `logger` parameter to constructor with a `Logger` interface matching pipeline-core's `Logger` (`packages/pipeline-core/src/logger.ts:37`). Default to `console`-based no-op.
   - **Option B:** Use `console.error` directly (the existing calls are error-only in the base class). The subclasses in the extension can override `loadComments`/`saveComments` to use the extension logger.
   
   Go with **Option A**: accept `Logger` from pipeline-core, default to `consoleLogger`.

### `src/shortcuts/markdown-comments/comments-manager.ts`

**No changes required.** This file:
- Already has zero `vscode` imports
- Calls `super(workspaceRoot, COMMENTS_CONFIG_FILE, { ...DEFAULT_COMMENTS_CONFIG })` — the new optional `fileWatcherFactory` param defaults to `undefined`, so this still compiles
- In the VS Code extension context, the factory is provided by the extension wiring (see below)

### `src/shortcuts/git-diff-comments/diff-comments-manager.ts`

**No changes required.** Same reasoning as `CommentsManager` — calls `super(workspaceRoot, ...)` with no watcher factory; zero vscode imports already.

### VS Code extension wiring — provide the factory

A one-line change where `CommentsManager` and `DiffCommentsManager` are instantiated (likely in `src/extension.ts` or a setup file). Create a VS Code file watcher factory helper:

```ts
// src/shortcuts/markdown-comments/vscode-file-watcher.ts (new file)
import * as vscode from 'vscode';
import * as path from 'path';
import { FileWatcher, FileWatcherFactory, Disposable } from './comments-manager-base';

export function createVSCodeFileWatcherFactory(): FileWatcherFactory {
    return (configPath: string): FileWatcher => {
        const pattern = new vscode.RelativePattern(
            path.dirname(configPath),
            path.basename(configPath)
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        return {
            onDidChange: (listener: () => void): Disposable => watcher.onDidChange(listener),
            onDidCreate: (listener: () => void): Disposable => watcher.onDidCreate(listener),
            onDidDelete: (listener: () => void): Disposable => watcher.onDidDelete(listener),
            dispose: () => watcher.dispose()
        };
    };
}
```

Then at each instantiation site, pass the factory:

```ts
// Before:
const commentsManager = new CommentsManager(workspaceRoot);
// After:
const commentsManager = new CommentsManager(workspaceRoot, createVSCodeFileWatcherFactory());
```

**But wait** — `CommentsManager`'s constructor is `(workspaceRoot: string)` and calls `super(workspaceRoot, COMMENTS_CONFIG_FILE, defaultConfig)`. To pass the factory through, the subclass constructors need an optional second parameter:

```ts
// CommentsManager
constructor(workspaceRoot: string, fileWatcherFactory?: FileWatcherFactory) {
    super(workspaceRoot, COMMENTS_CONFIG_FILE, { ...DEFAULT_COMMENTS_CONFIG }, fileWatcherFactory);
}

// DiffCommentsManager
constructor(workspaceRoot: string, fileWatcherFactory?: FileWatcherFactory) {
    super(workspaceRoot, DIFF_COMMENTS_CONFIG_FILE, {...}, fileWatcherFactory);
}
```

### Callers of `onDidChangeComments` — compatibility check

All consumers use this pattern:
```ts
commentsManager.onDidChangeComments((event) => { ... })
// or
commentsManager.onDidChangeComments(() => { ... })
```

The return type is `Disposable` (with `dispose(): void`). The `TypedEventEmitter.event` function returns `{ dispose(): void }`, which is structurally identical to `vscode.Disposable`. **No consumer changes needed.**

Key callers verified (no changes):
- `src/shortcuts/shared/comments-tree-provider-base.ts:33` — pushes into `vscode.Disposable[]`, structural typing matches
- `src/extension.ts:2667` — inline usage
- `src/shortcuts/markdown-comments/review-editor-view-provider.ts:417`
- `src/shortcuts/git-diff-comments/diff-review-editor-provider.ts:83`
- `src/shortcuts/git/tree-data-provider.ts:121`
- All test files — verified compatible

### `src/shortcuts/shared/prompt-generator-base.ts` and `comments-tree-provider-base.ts`

Both import `CommentsManagerBase` and type-constrain it as `CommentsManagerBase<any, any, any, any, any, any>`. These continue to work — the base class's public API shape is unchanged. **No changes needed.**

### `base-types.ts`

Already has zero vscode dependencies. **No changes.**

## Export strategy

The new types (`Disposable`, `TypedEventEmitter`, `FileWatcher`, `FileWatcherFactory`) should be exported from `comments-manager-base.ts` so that:
1. `vscode-file-watcher.ts` can import them
2. Future `pipeline-core` or `coc` consumers can import them

## Files changed (summary)

| File | Action |
|------|--------|
| `src/shortcuts/markdown-comments/comments-manager-base.ts` | Remove vscode import; add `Disposable`, `TypedEventEmitter`, `FileWatcher`, `FileWatcherFactory`; make constructor accept optional factory + logger; rewrite `setupFileWatcher()` |
| `src/shortcuts/markdown-comments/comments-manager.ts` | Add optional `fileWatcherFactory` param to constructor, pass through to `super()` |
| `src/shortcuts/git-diff-comments/diff-comments-manager.ts` | Add optional `fileWatcherFactory` param to constructor, pass through to `super()` |
| `src/shortcuts/markdown-comments/vscode-file-watcher.ts` | **New file** — VS Code `FileWatcherFactory` implementation |
| Extension instantiation sites (`src/extension.ts` or equivalent) | Pass `createVSCodeFileWatcherFactory()` when constructing managers |

## Files NOT changed

- `base-types.ts` — no vscode deps
- `comment-anchor.ts` — no vscode deps
- `types.ts` (markdown) — no vscode deps
- `types.ts` (diff) — no vscode deps
- `comments-tree-provider-base.ts` — still VS Code-only, not being extracted
- `prompt-generator-base.ts` — same, stays in extension layer
- All test files — structural typing ensures compatibility

## Testing

- All existing Mocha extension tests must pass unchanged (backward compat)
- Specifically: `markdown-comments.test.ts`, `markdown-comments-integration.test.ts`, `diff-comments-manager.test.ts`, `git-diff-comments-integration.test.ts`
- The `onDidChangeComments` event subscription/firing pattern must work identically
- `CommentsManager` and `DiffCommentsManager` instantiated **without** a factory should still work (no file watching, but load/save/CRUD all functional)

## Risk assessment

- **Low risk**: The refactor is purely structural — extracting an import and replacing with compatible interfaces
- **Key invariant**: `TypedEventEmitter.event` must return a function with signature `(listener: (e: T) => void) => Disposable` to match `vscode.Event<T>` structurally
- **Key invariant**: All `dispose()` return types must be `void` (matching `vscode.Disposable`)
