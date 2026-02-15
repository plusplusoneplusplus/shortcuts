---
status: pending
---

# 001: Define Shared Interfaces for Platform Abstraction

## Summary

Define platform-agnostic interfaces (`EditorTransport`, `EditorHost`, `StateStore`) and a typed `EditorMessage` union in `packages/pipeline-core/src/editor/` so both the VS Code extension and the CoC standalone HTTP server can implement the Markdown Review Editor backend against a single contract.

## Motivation

The Markdown Review Editor is tightly coupled to VS Code APIs: `WebviewPanel.postMessage` for UI↔backend communication, `vscode.window.showWarningMessage`/`showInformationMessage` for dialogs, `context.workspaceState` for persistence, `vscode.EventEmitter` for events, and `vscode.FileSystemWatcher` for file changes. Extracting these behind interfaces is the atomic first step—every subsequent commit (comment manager port, webview adapter, HTTP transport) depends on these types existing. Doing this as a separate commit keeps the diff reviewable and lets CI validate that the types compile before any implementation begins.

## Changes

### Files to Create

- **`packages/pipeline-core/src/editor/types.ts`** — Core domain types (pure re-exports / duplicates of what today lives in the extension):
  - `CommentStatus` = `'open' | 'resolved' | 'pending'`
  - `CommentType` = `'user' | 'ai-suggestion' | 'ai-clarification' | 'ai-critique' | 'ai-question'`
  - `CommentSelection` — `{ startLine: number; startColumn: number; endLine: number; endColumn: number }`
  - `CommentAnchor` — `{ selectedText, contextBefore, contextAfter, originalLine, textHash }`
  - `MermaidContext` — `{ diagramId, nodeId?, nodeLabel?, edgeId?, edgeLabel?, edgeSourceNode?, edgeTargetNode?, diagramType?, elementType? }`
  - `MarkdownComment` — full shape with `id, filePath, selection, selectedText, comment, status, type?, createdAt, updatedAt, author?, tags?, mermaidContext?, anchor?`
  - `CommentsSettings` — `{ showResolved, highlightColor, resolvedHighlightColor, aiSuggestionHighlightColor, aiClarificationHighlightColor, aiCritiqueHighlightColor, aiQuestionHighlightColor }`
  - `CommentsConfig` — `{ version: number; comments: MarkdownComment[]; settings?: CommentsSettings }`
  - `isUserComment(comment: MarkdownComment): boolean` helper
  - `DEFAULT_COMMENTS_SETTINGS` and `DEFAULT_COMMENTS_CONFIG` constants

- **`packages/pipeline-core/src/editor/messages.ts`** — Typed message unions for the editor protocol:
  - `WebviewSettings` — `{ showResolved, askAIEnabled?, aiCommands?, aiMenuConfig?, predefinedComments?, collapsedSections? }` (re-uses `SerializedAICommand`/`SerializedAIMenuConfig` already in pipeline-core)
  - `PendingSelection` — extends `CommentSelection` with `selectedText` and optional `mermaidContext`
  - `AskAIContext` — `{ selectedText, startLine, endLine, surroundingLines, nearestHeading, allHeadings, instructionType, customInstruction?, mode, promptFilePath?, skillName? }`
  - `PromptFileInfo` — `{ absolutePath, relativePath, name, sourceFolder }`
  - `SkillInfo` — `{ absolutePath, relativePath, name, description? }`
  - `RecentItem` — `{ type: 'prompt'|'skill', identifier, name, relativePath?, lastUsed }`
  - `AIModelOption` — `{ id, label, description?, isDefault? }`
  - `FollowPromptDialogOptions` — `{ mode: 'interactive'|'background', model, additionalContext? }`
  - `LineChange` — `{ line: number; type: 'added' | 'modified' }`
  - **`WebviewToBackendMessage`** (34 variants) — discriminated union on `type`:
    1. `{ type: 'ready' }`
    2. `{ type: 'requestState' }`
    3. `{ type: 'addComment'; selection: PendingSelection; comment: string; mermaidContext?: MermaidContext }`
    4. `{ type: 'editComment'; commentId: string; comment: string }`
    5. `{ type: 'deleteComment'; commentId: string }`
    6. `{ type: 'resolveComment'; commentId: string }`
    7. `{ type: 'reopenComment'; commentId: string }`
    8. `{ type: 'resolveAll' }`
    9. `{ type: 'deleteAll' }`
    10. `{ type: 'updateContent'; content: string }`
    11. `{ type: 'generatePrompt'; promptOptions: { format: string } }`
    12. `{ type: 'copyPrompt'; promptOptions: { format: string } }`
    13. `{ type: 'sendToChat'; promptOptions: { format: string; newConversation?: boolean } }`
    14. `{ type: 'sendCommentToChat'; commentId: string; newConversation: boolean }`
    15. `{ type: 'sendToCLIInteractive'; promptOptions: { format: string } }`
    16. `{ type: 'sendToCLIBackground'; promptOptions: { format: string } }`
    17. `{ type: 'resolveImagePath'; path: string; imgId: string }`
    18. `{ type: 'openFile'; path: string }`
    19. `{ type: 'askAI'; context: AskAIContext }`
    20. `{ type: 'askAIInteractive'; context: AskAIContext }`
    21. `{ type: 'askAIQueued'; context: AskAIContext }`
    22. `{ type: 'collapsedSectionsChanged'; collapsedSections: string[] }`
    23. `{ type: 'requestPromptFiles' }`
    24. `{ type: 'requestSkills' }`
    25. `{ type: 'executeWorkPlan'; promptFilePath: string }`
    26. `{ type: 'executeWorkPlanWithSkill'; skillName: string }`
    27. `{ type: 'promptSearch' }`
    28. `{ type: 'showFollowPromptDialog'; promptFilePath: string; promptName: string; skillName?: string }`
    29. `{ type: 'followPromptDialogResult'; promptFilePath: string; skillName?: string; options: FollowPromptDialogOptions }`
    30. `{ type: 'copyFollowPrompt'; promptFilePath: string; skillName?: string; additionalContext?: string }`
    31. `{ type: 'updateDocument'; instruction: string }`
    32. `{ type: 'requestUpdateDocumentDialog' }`
    33. `{ type: 'requestRefreshPlanDialog' }`
    34. `{ type: 'refreshPlan'; additionalContext?: string }`
  - **`BackendToWebviewMessage`** (7 variants) — discriminated union on `type`:
    1. `{ type: 'update'; content: string; comments: MarkdownComment[]; filePath: string; fileDir?: string; workspaceRoot?: string; settings?: WebviewSettings; isExternalChange?: boolean; lineChanges?: LineChange[] }`
    2. `{ type: 'imageResolved'; imgId: string; uri?: string; alt?: string; error?: string }`
    3. `{ type: 'scrollToComment'; commentId: string }`
    4. `{ type: 'promptFilesResponse'; promptFiles: PromptFileInfo[]; recentPrompts?: RecentPrompt[]; recentItems?: RecentItem[]; skills?: SkillInfo[] }`
    5. `{ type: 'skillsResponse'; skills: SkillInfo[] }`
    6. `{ type: 'showFollowPromptDialog'; promptName: string; promptFilePath: string; skillName?: string; availableModels: AIModelOption[]; defaults: { mode: 'interactive'|'background'; model: string } }`
    7. `{ type: 'showUpdateDocumentDialog' }`
    8. `{ type: 'showRefreshPlanDialog' }`
  - `EditorMessage` = `WebviewToBackendMessage | BackendToWebviewMessage` (convenience alias)

- **`packages/pipeline-core/src/editor/transport.ts`** — Transport abstraction:
  ```typescript
  /** Callback for receiving messages */
  type MessageListener<T> = (message: T) => void;

  /** Abstracts the bidirectional message channel between UI and backend */
  interface EditorTransport {
      /** Send a message from backend to the UI */
      postMessage(message: BackendToWebviewMessage): void;
      /** Register a handler for messages coming from the UI */
      onMessage(listener: MessageListener<WebviewToBackendMessage>): Disposable;
      /** Whether the transport is currently connected */
      readonly isConnected: boolean;
      /** Fires when connection state changes */
      onDidChangeConnection?(listener: (connected: boolean) => void): Disposable;
  }
  ```
  Where `Disposable` is the simple `{ dispose(): void }` already exported from pipeline-core.

- **`packages/pipeline-core/src/editor/host.ts`** — Platform host abstraction:
  ```typescript
  /** Abstracts platform-specific operations that differ between VS Code and HTTP server */
  interface EditorHost {
      /** Show an informational notification */
      showInformation(message: string): void;
      /** Show a warning notification */
      showWarning(message: string): void;
      /** Show an error notification */
      showError(message: string): void;
      /** Show a confirmation dialog; resolves to the chosen option or undefined */
      showConfirmation(message: string, options: string[]): Promise<string | undefined>;
      /** Copy text to clipboard */
      copyToClipboard(text: string): Promise<void>;
      /** Open a file in the platform's editor/viewer */
      openFile(filePath: string): Promise<void>;
      /** Resolve a relative image path to a URI the webview can load */
      resolveImageUri(relativePath: string, documentUri: string): string | undefined;
      /** Get the workspace root path */
      getWorkspaceRoot(): string;
  }
  ```

- **`packages/pipeline-core/src/editor/state-store.ts`** — State persistence abstraction:
  ```typescript
  /** Abstracts key-value state persistence (replaces vscode context.workspaceState) */
  interface StateStore {
      /** Get a value by key, returning defaultValue if not found */
      get<T>(key: string, defaultValue: T): T;
      /** Set a value by key */
      update(key: string, value: unknown): Promise<void>;
      /** List all keys (optional, for debugging/migration) */
      keys?(): string[];
  }
  ```

- **`packages/pipeline-core/src/editor/index.ts`** — Barrel re-export of all types from the four files above.

### Files to Modify

- **`packages/pipeline-core/src/index.ts`** — Add a new `// Editor Abstractions` section that re-exports everything from `./editor`.

### Files to Delete

(none)

## Implementation Notes

1. **No runtime code in this commit** — all files are pure TypeScript interfaces, type aliases, and constants. Zero runtime dependencies.

2. **Naming convention**: The webview types file currently calls them `WebviewMessage` (webview→extension) and `ExtensionMessage` (extension→webview). The shared interfaces use direction-agnostic names (`WebviewToBackendMessage` / `BackendToWebviewMessage`) since "extension" is a VS Code concept.

3. **`Disposable` reuse**: pipeline-core already exports `Disposable = { dispose(): void }` from `src/utils`. Reuse that rather than defining a new one.

4. **`AICommandMode` already in pipeline-core**: The type `'comment' | 'interactive' | 'background' | 'queued'` and `SerializedAICommand` / `SerializedAIMenuConfig` are already exported from `packages/pipeline-core/src/ai/`. Import from there rather than duplicating.

5. **Domain types duplication strategy**: The types in `src/shortcuts/markdown-comments/types.ts` (e.g., `MarkdownComment`, `CommentSelection`) are duplicated into `packages/pipeline-core/src/editor/types.ts` rather than moved. A follow-up commit will update the extension to import from pipeline-core and delete the originals. This avoids a massive cross-cutting change in commit 001.

6. **`LineChange` type**: Currently defined in `src/shortcuts/markdown-comments/line-change-tracker.ts`. Only the type shape `{ line: number; type: 'added' | 'modified' }` is needed; the tracker logic stays in the extension.

7. **`RecentPrompt` type**: Include in messages.ts for the `promptFilesResponse` message variant (same shape as `RecentItem` but with different fields).

## Tests

- **Type compilation test** (`packages/pipeline-core/test/editor/types.test.ts`):
  - Verify `WebviewToBackendMessage` discriminated union is exhaustive by writing a `switch` over all 34 `type` values with `never` default
  - Verify `BackendToWebviewMessage` discriminated union is exhaustive (8 variants)
  - Verify `MarkdownComment` satisfies the expected shape (construct a valid literal)
  - Verify `DEFAULT_COMMENTS_CONFIG` has correct defaults

- **Interface contract test** (`packages/pipeline-core/test/editor/interfaces.test.ts`):
  - Create a mock `EditorTransport` implementation and verify `postMessage` / `onMessage` round-trip
  - Create a mock `StateStore` and verify `get`/`update` contract
  - Create a mock `EditorHost` and verify method signatures exist
  - Assert `Disposable` from pipeline-core is compatible with `onMessage` return type

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/editor/` directory exists with `types.ts`, `messages.ts`, `transport.ts`, `host.ts`, `state-store.ts`, and `index.ts`
- [ ] All 34 `WebviewToBackendMessage` variants match exactly the `case` branches in `review-editor-view-provider.ts` `handleWebviewMessage`
- [ ] All 8 `BackendToWebviewMessage` variants match exactly the `postMessage` calls in the provider
- [ ] `EditorTransport`, `EditorHost`, and `StateStore` interfaces have zero VS Code imports
- [ ] `packages/pipeline-core/src/index.ts` re-exports the editor module
- [ ] `npm run build` in `packages/pipeline-core/` succeeds with no errors
- [ ] All existing pipeline-core tests still pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] New type-level tests pass in `packages/pipeline-core/test/editor/`
- [ ] No changes to any extension source files (`src/` is untouched)

## Dependencies

- Depends on: None (first commit in the series)
