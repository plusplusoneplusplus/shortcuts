---
status: pending
priority: high
commit: 4 of N
feature: Port Markdown Review Editor to CoC serve
package: coc
depends-on: []
---

# Commit 4: Extract Message Dispatcher from ReviewEditorViewProvider

Extract the ~280-line `handleWebviewMessage()` switch/if chain from `ReviewEditorViewProvider` into two new abstractions: a pure `EditorMessageRouter` (no VS Code deps) that maps message types to handler functions, and a `VscodeEditorHost` that implements an `EditorHost` interface wrapping all VS Code platform calls. The provider class becomes a thin shell: set up webview, delegate to router.

---

## Architecture Decisions

### Why a Router + Host Split

`handleWebviewMessage()` currently mixes two concerns in every `case` branch:

1. **Business logic** — deciding what to do (build prompt, construct queue task payload, compute clarification context, resolve file paths)
2. **Platform plumbing** — calling `vscode.window.showWarningMessage`, `vscode.env.clipboard.writeText`, `vscode.commands.executeCommand`, `webviewPanel.webview.postMessage`

Separating these makes the business logic testable without VS Code mocks and directly reusable in the CoC serve HTTP handler.

### EditorHost Interface

A dependency-injection boundary. The router never touches `vscode.*` — it calls host methods instead. Two implementations:

- `VscodeEditorHost` — production, wraps real VS Code APIs
- (Future) `HttpEditorHost` — CoC serve, maps operations to HTTP responses / WebSocket messages

### Router Owns Orchestration, Not State

The router does not own `CommentsManager`, `PromptGenerator`, or AI services. It receives them via constructor injection and coordinates calls between them. This keeps the router stateless and easy to test.

### Message Context Object

The router's `dispatch()` method receives a `MessageContext` bag instead of raw VS Code types (`TextDocument`, `WebviewPanel`). This bag contains only serializable/pure data: `documentText`, `documentPath`, `relativePath`, `fileDir`, `workspaceRoot`. The provider constructs this bag before calling dispatch.

---

## Interfaces to Define

### `EditorHost` Interface

```typescript
/**
 * Platform abstraction for editor operations.
 * Implementations wrap VS Code APIs or HTTP/WS transports.
 */
export interface EditorHost {
    // --- Notifications ---
    showInfo(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, options?: { modal?: boolean }, ...actions: string[]): Promise<string | undefined>;
    showError(message: string): void;

    // --- Clipboard ---
    copyToClipboard(text: string): Promise<void>;

    // --- File operations ---
    openFile(uri: string, lineNumber?: number): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
    readFile(filePath: string): Promise<string | undefined>;
    fileExists(filePath: string): Promise<boolean>;

    // --- Document editing ---
    replaceDocumentContent(documentUri: string, content: string): Promise<void>;

    // --- Dialogs ---
    showInputBox(options: { prompt: string; placeHolder?: string }): Promise<string | undefined>;
    showQuickPick<T extends { label: string }>(items: T[], options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }): Promise<T | undefined>;

    // --- Webview communication ---
    postMessage(message: unknown): void;

    // --- VS Code commands (abstracted) ---
    executeCommand(command: string, ...args: unknown[]): Promise<void>;

    // --- Image resolution ---
    resolveImageToWebviewUri(absolutePath: string): string | null;

    // --- State persistence ---
    getState<T>(key: string, defaultValue: T): T;
    setState(key: string, value: unknown): Promise<void>;

    // --- Configuration ---
    getConfig<T>(section: string, key: string, defaultValue: T): T;
}
```

### `MessageContext`

```typescript
/**
 * Pure-data context for message dispatching.
 * Constructed by the provider from VS Code types, consumed by the router.
 */
export interface MessageContext {
    /** Full text content of the document */
    documentText: string;
    /** Absolute path to the document (fsPath) */
    documentPath: string;
    /** Path relative to workspace root */
    relativePath: string;
    /** Directory containing the document */
    fileDir: string;
    /** Workspace root path */
    workspaceRoot: string;
}
```

---

## Handler Classification

Every `case` in the current switch maps to one of three categories:

### Category A: Pure Business Logic → Router

Handlers that only call `CommentsManager`, `PromptGenerator`, or build data structures. No VS Code API calls (or only trivially delegatable ones).

| Message Type | Router Method | Notes |
|---|---|---|
| `addComment` | `handleAddComment()` | Calls `commentsManager.addComment()` |
| `editComment` | `handleEditComment()` | Calls `commentsManager.updateComment()` |
| `resolveComment` | `handleResolveComment()` | Calls `commentsManager.resolveComment()` |
| `reopenComment` | `handleReopenComment()` | Calls `commentsManager.reopenComment()` |
| `resolveAll` | `handleResolveAll()` | Calls `commentsManager.resolveAllComments()`, then `host.showInfo()` |
| `collapsedSectionsChanged` | `handleCollapsedSectionsChanged()` | Calls `host.setState()` |
| `generatePrompt` | `handleGeneratePrompt()` | Builds prompt via `PromptGenerator`, calls `host.executeCommand()` to open doc |
| `copyPrompt` | `handleCopyPrompt()` | Builds prompt, calls `host.copyToClipboard()` |
| `sendToChat` | `handleSendToChat()` | Builds prompt, calls `host.executeCommand()` for chat |
| `sendCommentToChat` | `handleSendCommentToChat()` | Builds single-comment prompt, sends to chat |
| `sendToCLIInteractive` | `handleSendToCLIInteractive()` | Builds prompt, delegates to interactive session manager |
| `sendToCLIBackground` | `handleSendToCLIBackground()` | Builds prompt, delegates to SDK service |
| `askAI` | `handleAskAI()` | Builds clarification context, delegates to `handleAIClarification()` |
| `askAIInteractive` | `handleAskAIInteractive()` | Builds prompt, starts interactive session |
| `askAIQueued` | `handleAskAIQueued()` | Builds queue task payload, submits to queue service |
| `executeWorkPlan` | `handleExecuteWorkPlan()` | Shows follow-prompt dialog via host |
| `executeWorkPlanWithSkill` | `handleExecuteWorkPlanWithSkill()` | Resolves skill path, shows dialog |
| `followPromptDialogResult` | `handleFollowPromptDialogResult()` | Routes to interactive/background execution |
| `copyFollowPrompt` | `handleCopyFollowPrompt()` | Builds prompt text, copies to clipboard |
| `updateDocument` | `handleUpdateDocument()` | Builds update prompt, starts interactive session |
| `refreshPlan` | `handleRefreshPlan()` | Reads file, builds refresh prompt, starts session |
| `promptSearch` | `handlePromptSearch()` | Uses `host.showQuickPick()` for prompt file selection |

### Category B: Platform-Heavy → Router delegates to Host

Handlers where the VS Code interaction IS the handler (dialog confirmation, webview postMessage). The router calls a host method.

| Message Type | Router Method | Host Methods Used |
|---|---|---|
| `deleteComment` | `handleDeleteComment()` | `host.showWarning()` (modal confirm), then `commentsManager.deleteComment()` |
| `deleteAll` | `handleDeleteAll()` | `host.showWarning()` (modal confirm), then `commentsManager.deleteAllComments()`, `host.showInfo()` |
| `requestUpdateDocumentDialog` | `handleRequestUpdateDocumentDialog()` | `host.postMessage({ type: 'showUpdateDocumentDialog' })` |
| `requestRefreshPlanDialog` | `handleRequestRefreshPlanDialog()` | `host.postMessage({ type: 'showRefreshPlanDialog' })` |
| `requestPromptFiles` | `handleRequestPromptFiles()` | `host.postMessage()` with prompt file data |
| `requestSkills` | `handleRequestSkills()` | `host.postMessage()` with skills data |

### Category C: Webview Lifecycle → Stays in Provider (thin delegation to router)

| Message Type | Handling |
|---|---|
| `ready` / `requestState` | Provider calls `updateWebview()` directly, then router handles pending scroll check |
| `updateContent` | Provider calls `setWebviewEdit()` timestamp, then `host.replaceDocumentContent()` |
| `resolveImagePath` | Router calls `host.resolveImageToWebviewUri()`, then `host.postMessage()` |
| `openFile` | Router resolves path via pure utils, then `host.openFile()` or `host.openExternalUrl()` |

---

## Files to Create

### 1. `src/shortcuts/markdown-comments/editor-host.ts`

New file (~40 lines). Contains `EditorHost` interface, `MessageContext` interface, and `DispatchResult` type.

```typescript
export interface EditorHost { /* as above */ }
export interface MessageContext { /* as above */ }

/** Returned by dispatch to let the provider know if side effects are needed */
export interface DispatchResult {
    /** True if the webview should be updated after this message */
    shouldUpdateWebview?: boolean;
    /** True if setWebviewEdit() should be called (updateContent) */
    shouldMarkWebviewEdit?: boolean;
}
```

### 2. `src/shortcuts/markdown-comments/vscode-editor-host.ts`

New file (~150 lines). Implements `EditorHost` using VS Code APIs.

```typescript
import * as vscode from 'vscode';
import { EditorHost } from './editor-host';

export class VscodeEditorHost implements EditorHost {
    constructor(
        private readonly webviewPanel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly document: vscode.TextDocument
    ) {}

    async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showInformationMessage(message, ...actions);
    }

    async showWarning(message: string, options?: { modal?: boolean }, ...actions: string[]): Promise<string | undefined> {
        if (options?.modal) {
            return vscode.window.showWarningMessage(message, { modal: true }, ...actions);
        }
        return vscode.window.showWarningMessage(message, ...actions);
    }

    showError(message: string): void {
        vscode.window.showErrorMessage(message);
    }

    async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
    }

    async openFile(filePath: string, lineNumber?: number): Promise<void> {
        // Delegates to openFileUri logic (markdown → review editor, others → text editor)
        const uri = vscode.Uri.file(filePath);
        if (filePath.endsWith('.md')) {
            await vscode.commands.executeCommand('vscode.openWith', uri, 'reviewEditorView');
        } else if (lineNumber !== undefined && lineNumber > 0) {
            const pos = new vscode.Position(lineNumber - 1, 0);
            await vscode.window.showTextDocument(uri, { selection: new vscode.Selection(pos, pos) });
        } else {
            await vscode.window.showTextDocument(uri);
        }
    }

    // ... remaining methods delegate to vscode.* APIs
}
```

### 3. `src/shortcuts/markdown-comments/editor-message-router.ts`

New file (~500 lines). The extracted routing logic.

```typescript
import { CommentsManager } from './comments-manager';
import { PromptGenerator } from './prompt-generator';
import { EditorHost, MessageContext, DispatchResult } from './editor-host';
import { handleAIClarification } from './ai-clarification-handler';
import { normalizeAskAIContextForDocument } from './ask-ai-context-utils';
import { isExternalUrl, parseLineFragment, resolveFilePath } from './file-path-utils';
import { isUserComment } from './types';
// AI service imports (pure function getters, no vscode deps)
import {
    getInteractiveSessionManager,
    getAIQueueService,
    getWorkingDirectory,
    IAIProcessManager,
    FollowPromptExecutionOptions
} from '../ai-service';
import { getCopilotSDKService, approveAllPermissions } from '@plusplusoneplusplus/pipeline-core';

export class EditorMessageRouter {
    private readonly promptGenerator: PromptGenerator;

    constructor(
        private readonly host: EditorHost,
        private readonly commentsManager: CommentsManager,
        private readonly aiProcessManager?: IAIProcessManager
    ) {
        this.promptGenerator = new PromptGenerator(commentsManager);
    }

    async dispatch(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        switch (message.type) {
            case 'addComment': return this.handleAddComment(message, ctx);
            case 'editComment': return this.handleEditComment(message);
            // ... all 28+ cases
        }
        return {};
    }

    // --- Comment CRUD ---
    private async handleAddComment(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleEditComment(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleDeleteComment(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleResolveComment(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleReopenComment(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleResolveAll(): Promise<DispatchResult> { ... }
    private async handleDeleteAll(): Promise<DispatchResult> { ... }

    // --- Prompt generation ---
    private async handleGeneratePrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleCopyPrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleSendToChat(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleSendCommentToChat(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleSendToCLIInteractive(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleSendToCLIBackground(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }

    // --- AI requests ---
    private async handleAskAI(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleAskAIInteractive(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleAskAIQueued(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }

    // --- Follow Prompt / Work Plan ---
    private async handleExecuteWorkPlan(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleExecuteWorkPlanWithSkill(message: WebviewMessage): Promise<DispatchResult> { ... }
    private async handleFollowPromptDialogResult(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleCopyFollowPrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }

    // --- Document operations ---
    private async handleUpdateDocument(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleRefreshPlan(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }

    // --- Webview communication ---
    private async handleRequestPromptFiles(): Promise<DispatchResult> { ... }
    private async handleRequestSkills(): Promise<DispatchResult> { ... }
    private async handlePromptSearch(ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleResolveImagePath(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleOpenFile(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }

    // --- State ---
    private async handleCollapsedSectionsChanged(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> { ... }
    private async handleRequestUpdateDocumentDialog(): Promise<DispatchResult> { ... }
    private async handleRequestRefreshPlanDialog(): Promise<DispatchResult> { ... }
}
```

---

## Files to Modify

### 4. `src/shortcuts/markdown-comments/review-editor-view-provider.ts`

The provider shrinks significantly. The changes:

**4a. Remove the `handleWebviewMessage()` method entirely (~280 lines).** Replace with a 10-line delegation:

```typescript
private async handleWebviewMessage(
    message: WebviewMessage,
    document: vscode.TextDocument,
    relativePath: string,
    webviewPanel: vscode.WebviewPanel,
    updateWebview: () => void,
    setWebviewEdit: () => void
): Promise<void> {
    const ctx: MessageContext = {
        documentText: document.getText(),
        documentPath: document.uri.fsPath,
        relativePath,
        fileDir: path.dirname(document.uri.fsPath),
        workspaceRoot: getWorkspaceRoot() || ''
    };

    // Handle ready/requestState locally (needs updateWebview callback)
    if (message.type === 'ready' || message.type === 'requestState') {
        updateWebview();
        // Delegate pending scroll check to router
        this.router.handlePendingScroll(ctx, webviewPanel);
        return;
    }

    const result = await this.router.dispatch(message, ctx);

    if (result.shouldMarkWebviewEdit) {
        setWebviewEdit();
    }
}
```

**4b. Remove all private handler methods** that move to the router (~1200 lines total):

- `handleAskAI()`
- `handleAskAIInteractive()`
- `handleAskAIQueued()`
- `generateAndShowPrompt()`
- `generateAndCopyPrompt()`
- `generateAndSendToChat()`
- `generateAndSendCommentToChat()`
- `generateAndSendToCLIInteractive()`
- `generateAndSendToCLIBackground()`
- `handleRequestPromptFiles()`
- `handleRequestSkills()`
- `handlePromptSearch()`
- `handleExecuteWorkPlan()`
- `handleExecuteWorkPlanWithSkill()`
- `showFollowPromptDialog()`
- `executeFollowPrompt()`
- `executeFollowPromptInteractive()`
- `executeFollowPromptInBackground()`
- `copyFollowPromptToClipboard()`
- `handleUpdateDocument()`
- `handleRefreshPlan()`
- `resolveAndSendImagePath()`
- `openFileFromPath()`
- `openFileUri()`

**4c. Remove helper methods** that move to the router or host:

- `readPromptFile()` → `host.readFile()`
- `readSkillPrompt()` → router helper
- `readSkillDescription()` → router helper
- `getRecentPrompts()` / `trackPromptUsage()` → router with `host.getState()` / `host.setState()`
- `getRecentSkills()` / `trackSkillUsage()` → router with `host.getState()` / `host.setState()`
- `getSkillPromptPath()` → router helper using `host.fileExists()`
- `getLastFollowPromptSelection()` / `saveLastFollowPromptSelection()` → router with `host.getState()` / `host.setState()`
- `resolveWorkPlanWorkingDirectory()` → router helper using `host.getConfig()`
- `directoryExists()` → `host.fileExists()` (directory variant)

**4d. Add router instantiation** in constructor and `resolveCustomTextEditor`:

```typescript
constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly commentsManager: CommentsManager,
    private readonly aiProcessManager?: IAIProcessManager
) {
    // PromptGenerator now owned by router
}
```

In `resolveCustomTextEditor`, create host and router per editor instance:

```typescript
const host = new VscodeEditorHost(webviewPanel, this.context, document);
const router = new EditorMessageRouter(host, this.commentsManager, this.aiProcessManager);
```

**4e. Keep in provider** (not extracted):

- `resolveCustomTextEditor()` — webview lifecycle, event listeners, HTML setup
- `getWebviewContentOptions()` — VS Code theme detection
- `getCollapsedSections()` / `setCollapsedSections()` — move to host via `getState`/`setState`
- Static methods: `register()`, `requestScrollToComment()`, `activeWebviews`, `pendingScrollRequests`

**Net effect:** Provider drops from ~2280 lines to ~500 lines (webview setup + static lifecycle).

---

## AI Service Dependency Analysis

The router needs access to these AI service singletons. All are accessed via getter functions (not VS Code types), so they can be imported directly:

| Getter | Package | VS Code Dep? | Router Usage |
|---|---|---|---|
| `getInteractiveSessionManager()` | `ai-service` | No (returns pure interface) | `handleAskAIInteractive`, `handleSendToCLIInteractive`, `executeFollowPromptInteractive` |
| `getAIQueueService()` | `ai-service` | No (returns pure interface) | `handleAskAIQueued`, `executeFollowPromptInBackground` |
| `getCopilotSDKService()` | `pipeline-core` | No | `handleSendToCLIBackground` |
| `getAICommandRegistry()` | `ai-service` | No | Used in `updateWebview` (stays in provider) |
| `getWorkingDirectory()` | `ai-service` | No | Multiple handlers |
| `getAvailableModels()` | `ai-service` | No | `showFollowPromptDialog` |
| `getFollowPromptDefaultMode()` | `ai-service` | **Yes** (reads `vscode.workspace.getConfiguration`) | Router uses `host.getConfig()` instead |
| `getFollowPromptDefaultModel()` | `ai-service` | **Yes** (reads `vscode.workspace.getConfiguration`) | Router uses `host.getConfig()` instead |
| `getFollowPromptRememberSelection()` | `ai-service` | **Yes** (reads `vscode.workspace.getConfiguration`) | Router uses `host.getConfig()` instead |
| `getPromptFiles()` | `shared/prompt-files-utils` | No (filesystem only) | `handleRequestPromptFiles`, `handlePromptSearch` |
| `getSkills()` | `shared/skill-files-utils` | No (filesystem only) | `handleRequestPromptFiles`, `handleRequestSkills` |

**Key insight:** Three config getters (`getFollowPromptDefaultMode`, `getFollowPromptDefaultModel`, `getFollowPromptRememberSelection`) read VS Code configuration. The router should call `host.getConfig()` instead, making them platform-agnostic. Alternatively, the router can accept a `RouterConfig` object with these values pre-resolved by the provider.

---

## Method Migration Map

| Current Method in Provider | Lines | Destination | New Method |
|---|---|---|---|
| `handleWebviewMessage()` | 473–755 | **deleted** (replaced by router dispatch) | `EditorMessageRouter.dispatch()` |
| `handleAskAI()` | 760–832 | router | `handleAskAI()` |
| `handleAskAIInteractive()` | 838–915 | router | `handleAskAIInteractive()` |
| `handleAskAIQueued()` | 921–976 | router | `handleAskAIQueued()` |
| `directoryExists()` | 981–988 | host | `fileExists()` (directory variant) |
| `readPromptFile()` | 995–1003 | host | `readFile()` |
| `readSkillPrompt()` | 1011–1027 | router helper | `readSkillPrompt()` |
| `resolveAndSendImagePath()` | 1032–1097 | router | `handleResolveImagePath()` |
| `openFileFromPath()` | 1105–1136 | router | `handleOpenFile()` |
| `openFileUri()` | 1143–1164 | host | `openFile()` |
| `generateAndShowPrompt()` | 1170–1197 | router | `handleGeneratePrompt()` |
| `generateAndCopyPrompt()` | 1203–1226 | router | `handleCopyPrompt()` |
| `generateAndSendToChat()` | 1234–1283 | router | `handleSendToChat()` |
| `generateAndSendCommentToChat()` | 1290–1335 | router | `handleSendCommentToChat()` |
| `generateAndSendToCLIInteractive()` | 1344–1386 | router | `handleSendToCLIInteractive()` |
| `generateAndSendToCLIBackground()` | 1395–1469 | router | `handleSendToCLIBackground()` |
| `handleRequestPromptFiles()` | 1476–1554 | router | `handleRequestPromptFiles()` |
| `handleRequestSkills()` | 1560–1581 | router | `handleRequestSkills()` |
| `readSkillDescription()` | 1588–1606 | router helper | `readSkillDescription()` |
| `handlePromptSearch()` | 1612–1637 | router | `handlePromptSearch()` |
| `getRecentPrompts()` | 1642–1654 | router (via host state) | `getRecentPrompts()` |
| `trackPromptUsage()` | 1659–1686 | router (via host state) | `trackPromptUsage()` |
| `getRecentSkills()` | 1691–1699 | router (via host state) | `getRecentSkills()` |
| `trackSkillUsage()` | 1704–1721 | router (via host state) | `trackSkillUsage()` |
| `showFollowPromptDialog()` | 1732–1779 | router | `showFollowPromptDialog()` |
| `getSkillPromptPath()` | 1787–1812 | router helper | `getSkillPromptPath()` |
| `executeFollowPrompt()` | 1823–1839 | router | `executeFollowPrompt()` |
| `executeFollowPromptInteractive()` | 1849–1885 | router | `executeFollowPromptInteractive()` |
| `copyFollowPromptToClipboard()` | 1894–1909 | router | `handleCopyFollowPrompt()` |
| `executeFollowPromptInBackground()` | 1915–1959 | router | `executeFollowPromptInBackground()` |
| `getLastFollowPromptSelection()` | 1964–1973 | router (via host state) | `getLastFollowPromptSelection()` |
| `saveLastFollowPromptSelection()` | 1978–1980 | router (via host state) | `saveLastFollowPromptSelection()` |
| `handleExecuteWorkPlan()` | 1987–2035 | router (deprecated, kept) | `handleExecuteWorkPlan()` |
| `handleExecuteWorkPlanWithSkill()` | 2042–2112 | router (deprecated, kept) | `handleExecuteWorkPlanWithSkill()` |
| `handleUpdateDocument()` | 2128–2178 | router | `handleUpdateDocument()` |
| `handleRefreshPlan()` | 2188–2260 | router | `handleRefreshPlan()` |
| `resolveWorkPlanWorkingDirectory()` | 2262–2280 | router helper | `resolveWorkPlanWorkingDirectory()` |

---

## Interaction Patterns

### Pattern 1: Simple CRUD (addComment, editComment, resolveComment, reopenComment)

```
Provider → router.dispatch(message, ctx)
  Router → commentsManager.addComment(...)
  Router → return { shouldUpdateWebview: false }
           (CommentsManager fires onDidChangeComments, provider updates via listener)
```

### Pattern 2: Confirm-then-act (deleteComment, deleteAll)

```
Provider → router.dispatch(message, ctx)
  Router → host.showWarning("Are you sure?", { modal: true }, "Delete")
    Host → vscode.window.showWarningMessage(...)
  Router ← "Delete" | undefined
  Router → if confirmed: commentsManager.deleteComment(...)
  Router → return {}
```

### Pattern 3: Generate + Send (copyPrompt, sendToChat, sendToCLI*)

```
Provider → router.dispatch(message, ctx)
  Router → commentsManager.getCommentsForFile(ctx.relativePath)
  Router → promptGenerator.generatePromptForComments(ids, opts)
  Router → host.copyToClipboard(prompt) or host.executeCommand('workbench.action.chat.open', { query: prompt })
  Router → host.showInfo("Prompt copied!")
  Router → return {}
```

### Pattern 4: AI Background (sendToCLIBackground)

```
Provider → router.dispatch(message, ctx)
  Router → build prompt via promptGenerator
  Router → getCopilotSDKService().sendMessage({ prompt, ... })
  Router → aiProcessManager.registerProcess() / completeProcess() / failProcess()
  Router → host.showInfo("AI response ready!", "Copy to Clipboard", "View Output")
    Host ← user choice
  Router → if "Copy": host.copyToClipboard(response)
  Router → return {}
```

### Pattern 5: Webview Dialog (requestUpdateDocumentDialog, requestRefreshPlanDialog)

```
Provider → router.dispatch(message, ctx)
  Router → host.postMessage({ type: 'showUpdateDocumentDialog' })
  Router → return {}
```

---

## Testing Strategy

### Unit Tests for EditorMessageRouter

Create `src/test/suite/editor-message-router.test.ts` (~300 lines).

Use a **mock `EditorHost`** — a plain object implementing the interface with jest-style stubs (or sinon stubs). This tests routing logic without VS Code.

Test cases:

- **Comment CRUD:** Verify `commentsManager` methods called with correct args
- **Delete confirmation flow:** Verify `host.showWarning()` called; verify delete NOT called when user cancels
- **Prompt generation:** Verify prompt text built correctly, clipboard/chat called
- **AI routing:** Verify correct AI service called (interactive vs background vs queued)
- **Follow prompt dialog:** Verify `host.postMessage()` called with correct dialog data
- **Image resolution:** Verify `host.resolveImageToWebviewUri()` called, result posted back
- **Open file:** Verify external URLs → `host.openExternalUrl()`, local files → `host.openFile()`
- **State persistence:** Verify `host.setState()` called for collapsed sections, recent prompts

### Integration Tests

Existing `ReviewEditorViewProvider` tests continue to pass — the provider still delegates to the same logic, just through the router indirection.

---

## Acceptance Criteria

- [ ] `EditorHost` interface defined in `editor-host.ts` with all platform operations
- [ ] `VscodeEditorHost` implements `EditorHost` using VS Code APIs
- [ ] `EditorMessageRouter` handles all 28+ message types via `dispatch()`
- [ ] `ReviewEditorViewProvider.handleWebviewMessage()` reduced to <15 lines (context construction + dispatch)
- [ ] All ~35 private handler/helper methods removed from provider
- [ ] Provider drops from ~2280 to ~500 lines
- [ ] Router has zero `import * as vscode` statements
- [ ] Router has zero direct references to `vscode.window.*`, `vscode.env.*`, `vscode.workspace.*`, `vscode.commands.*`
- [ ] All configuration reads go through `host.getConfig()` not `vscode.workspace.getConfiguration()`
- [ ] All state reads/writes go through `host.getState()` / `host.setState()` not `context.workspaceState`
- [ ] `WebviewMessage` type exported from a shared location (not private to provider)
- [ ] `AskAIContext` type exported from a shared location
- [ ] Existing extension tests pass (`npm test`)
- [ ] New unit tests for `EditorMessageRouter` with mock host (~15 test cases minimum)
- [ ] No regressions in Review Editor functionality (manual test: add/edit/delete/resolve comments, generate prompts, Ask AI, Follow Prompt, Update Document, Refresh Plan)
