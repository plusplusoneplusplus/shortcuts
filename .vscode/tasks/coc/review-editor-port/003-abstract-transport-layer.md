---
status: pending
commit: "003"
title: Create abstract transport layer for webview communication
---

# 003 — Create abstract transport layer for webview communication

## Goal

Decouple the webview messaging layer from `acquireVsCodeApi()` so the same editor UI can run over HTTP+WebSocket in CoC serve mode. All existing consumers must work unchanged.

## Current State

### Message flow (webview → extension)

1. `main.ts` calls `acquireVsCodeApi()` and stores it via `state.setVscode(vscode)`
2. `vscode-bridge.ts` exports 28 functions. The core is `postMessage()` which calls `postMessageToExtension(state.vscode, message)` — a helper from `shared/webview/base-vscode-bridge.ts` that calls `vscode.postMessage(message)`.
3. Every other exported function (27 of them) builds a typed `WebviewMessage` and passes it to `postMessage()`.
4. `setupMessageListener()` wraps `window.addEventListener('message', ...)` via `setupBaseMessageListener()`.

### Consumers of vscode-bridge.ts

| File | Imports |
|---|---|
| `dom-handlers.ts` | 18 functions (`openFile`, `requestAskAI`, `requestAskAIInteractive`, `requestAskAIQueued`, `requestCopyPrompt`, `requestDeleteAll`, `requestExecuteWorkPlan`, `requestExecuteWorkPlanWithSkill`, `requestPromptFiles`, `requestPromptSearch`, `requestRefreshPlan`, `requestResolveAll`, `requestSendToChat`, `requestSendToCLIBackground`, `requestSendToCLIInteractive`, `requestSkills`, `requestUpdateDocument`, `updateContent`) |
| `panel-manager.ts` | 6 functions (`addComment`, `deleteCommentMessage`, `editComment`, `reopenComment`, `requestSendCommentToChat`, `resolveComment`) |
| `main.ts` | 2 functions (`notifyReady`, `setupMessageListener`) |
| `image-handlers.ts` | 1 function (`resolveImagePath` as `requestResolveImagePath`) |
| `index.ts` | Re-exports all (`export * from './vscode-bridge'`) |

### Bypass paths (direct `state.vscode.postMessage()`)

7 calls bypass `vscode-bridge.ts` entirely:

- `heading-collapse-handlers.ts` — 3 calls (lines 80, 96, 112): sends `collapsedSectionsChanged` messages
- `follow-prompt-dialog.ts` — 2 calls (lines 168, 217): sends `followPromptDialogResult` and `copyFollowPrompt`
- `update-document-dialog.ts` — 1 call (line 129): sends `updateDocument`
- `refresh-plan-dialog.ts` — 1 call (line 127): sends `refreshPlan`

### Message types

- **Webview → Extension:** 34 message types (defined in `WebviewMessage` union in `types.ts`)
- **Extension → Webview:** 8 message types (defined in `ExtensionMessage` union in `types.ts`)

### Shared base layer

`src/shortcuts/shared/webview/base-vscode-bridge.ts` provides:
- `BaseVSCodeAPI` interface (`postMessage`, `getState`, `setState`)
- `postMessageToExtension<T>(vscode, message)` — null-safe `vscode.postMessage(message)`
- `setupBaseMessageListener<T>(handler)` — `window.addEventListener('message', ...)`

## Plan

### Step 1 — Define `EditorTransport` interface

Create `src/shortcuts/markdown-comments/webview-scripts/transport.ts`:

```typescript
import { ExtensionMessage, WebviewMessage } from './types';

/**
 * Abstract transport for webview↔host communication.
 * VscodeTransport wraps acquireVsCodeApi(); HttpTransport (commit 008) uses fetch+WebSocket.
 */
export interface EditorTransport {
    /** Send a message from the webview to the host (extension or server) */
    postMessage(message: WebviewMessage): void;
    /** Register a handler for messages from the host */
    onMessage(handler: (message: ExtensionMessage) => void): void;
}
```

### Step 2 — Create `VscodeTransport` implementation

In the same `transport.ts` file:

```typescript
import { VsCodeApi } from './types';

export class VscodeTransport implements EditorTransport {
    constructor(private readonly vscode: VsCodeApi) {}

    postMessage(message: WebviewMessage): void {
        this.vscode.postMessage(message);
    }

    onMessage(handler: (message: ExtensionMessage) => void): void {
        window.addEventListener('message', (event: MessageEvent) => {
            handler(event.data);
        });
    }
}
```

### Step 3 — Add transport to state manager

In `state.ts`, add a transport field alongside the existing `_vscode`:

```typescript
import { EditorTransport } from './transport';

// In WebviewStateManager:
private _transport: EditorTransport | null = null;

get transport(): EditorTransport {
    if (!this._transport) {
        throw new Error('Transport not initialized');
    }
    return this._transport;
}

setTransport(transport: EditorTransport): void {
    this._transport = transport;
}
```

Keep `_vscode` / `setVscode()` / `get vscode()` intact for now — existing bypass callers still reference `state.vscode`. Removing it is a follow-up (see Step 6).

### Step 4 — Refactor `vscode-bridge.ts` to use transport

Replace the `postMessage()` function body:

```typescript
// Before:
export function postMessage(message: WebviewMessage): void {
    postMessageToExtension(state.vscode, message);
}

// After:
export function postMessage(message: WebviewMessage): void {
    state.transport.postMessage(message);
}
```

Replace `setupMessageListener()`:

```typescript
// Before:
export function setupMessageListener(handler: MessageHandler): void {
    setupBaseMessageListener<ExtensionMessage>(handler);
}

// After:
export function setupMessageListener(handler: MessageHandler): void {
    state.transport.onMessage(handler);
}
```

Remove the now-unused imports of `postMessageToExtension` and `setupBaseMessageListener` from `base-vscode-bridge`. Keep `CommonMessageTypes` import (still used by `notifyReady()`).

### Step 5 — Update `main.ts` initialization

```typescript
import { VscodeTransport } from './transport';

function init(): void {
    const vscode = acquireVsCodeApi();
    state.setVscode(vscode);                        // keep for bypass callers
    state.setTransport(new VscodeTransport(vscode)); // new: set transport

    // ... rest unchanged
}
```

### Step 6 — Migrate bypass callers to use `postMessage()` from vscode-bridge

Refactor the 7 direct `state.vscode.postMessage()` calls to use the centralized `postMessage()` from `vscode-bridge.ts`:

- **`heading-collapse-handlers.ts`** (3 calls): Import `postMessage` from `./vscode-bridge`, replace `state.vscode.postMessage({type: 'collapsedSectionsChanged', ...})` with `postMessage({type: 'collapsedSectionsChanged', ...} as any)`.
- **`follow-prompt-dialog.ts`** (2 calls): Same pattern for `followPromptDialogResult` and `copyFollowPrompt` messages.
- **`update-document-dialog.ts`** (1 call): Same pattern for `updateDocument` message.
- **`refresh-plan-dialog.ts`** (1 call): Same pattern for `refreshPlan` message.

This ensures 100% of outbound messages flow through the transport layer. The `as any` cast is temporary — these message types are already in the `WebviewMessage` union so the cast shouldn't actually be needed; verify during implementation.

### Step 7 — Remove `state.vscode` dependency

After Step 6, `state.vscode` is only used in `main.ts` (the `setVscode(vscode)` call). If no other consumers reference it, remove:

- `_vscode`, `get vscode()`, `setVscode()` from `WebviewStateManager`
- The `VsCodeApi` import in `state.ts` (if no longer needed)

If some consumers still need `getState()`/`setState()` from the VS Code API (e.g., for webview state persistence), either:
- Add `getState()`/`setState()` to `EditorTransport`, or
- Keep `state.vscode` but mark it `@deprecated` with a comment pointing to transport

Check all files for `state.vscode` references before removing.

## Files Changed

| File | Change |
|---|---|
| `webview-scripts/transport.ts` | **New** — `EditorTransport` interface + `VscodeTransport` class |
| `webview-scripts/state.ts` | Add `_transport` field, getter, setter |
| `webview-scripts/vscode-bridge.ts` | Use `state.transport` instead of `state.vscode` / `base-vscode-bridge` helpers |
| `webview-scripts/main.ts` | Create `VscodeTransport` and call `state.setTransport()` |
| `webview-scripts/heading-collapse-handlers.ts` | Replace 3× `state.vscode.postMessage()` with `postMessage()` |
| `webview-scripts/follow-prompt-dialog.ts` | Replace 2× `state.vscode.postMessage()` with `postMessage()` |
| `webview-scripts/update-document-dialog.ts` | Replace 1× `state.vscode.postMessage()` with `postMessage()` |
| `webview-scripts/refresh-plan-dialog.ts` | Replace 1× `state.vscode.postMessage()` with `postMessage()` |
| `webview-scripts/index.ts` | Add re-export of `EditorTransport` and `VscodeTransport` from `./transport` |

## Invariants

- All 28 exported functions in `vscode-bridge.ts` continue to work with identical signatures
- All consumer imports (`dom-handlers`, `panel-manager`, `main`, `image-handlers`) require **zero changes** to their import statements
- Extension→webview messages still arrive via the same `handleMessage` callback in `main.ts`
- The `VscodeTransport` is the only implementation for now; `HttpTransport` comes in commit 008
- No changes to the extension-side code (`ReviewEditorViewProvider` etc.)

## Testing

- `npm run compile` must succeed (webpack bundles webview-scripts)
- Open any `.md` file with "Markdown Review Editor" → verify comments work (add, edit, resolve, delete)
- Verify AI menu actions still send messages (Ask AI, Execute Work Plan)
- Verify heading collapse persistence works (exercises the migrated bypass callers)
- Verify Follow Prompt dialog, Update Document dialog, and Refresh Plan dialog still function

## Dependencies

- None (this commit is self-contained; does not depend on commits 001 or 002)
- Commit 008 depends on this commit (will add `HttpTransport` implementing `EditorTransport`)
