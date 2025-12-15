# Research: AI Context Clarification Menu

**Feature**: `001-ai-context-clarify`
**Date**: 2025-12-15

## Research Questions & Findings

### 1. VSCode Terminal API for CLI Invocation

**Question**: How to invoke Copilot CLI from a VSCode extension?

**Decision**: Use `vscode.window.createTerminal()` with `sendText()` to execute the `copilot` command.

**Rationale**:
- The VSCode Terminal API provides a platform-agnostic way to execute CLI commands
- `createTerminal()` creates a visible terminal where users can see the Copilot CLI interaction
- `sendText()` sends the command string to the terminal for execution
- This approach works across Windows, macOS, and Linux
- User can see the full AI conversation in the terminal

**Implementation Pattern**:
```typescript
const terminal = vscode.window.createTerminal({
    name: 'Copilot Clarification',
    hideFromUser: false
});
terminal.show();
terminal.sendText(`copilot --allow-all-tools -p "${escapedPrompt}"`);
```

**Alternatives Considered**:
- `child_process.exec()`: Would run in background without user visibility; not suitable for interactive CLI
- VS Code Tasks API: Overkill for single command execution; meant for build tasks

### 2. Prompt Escaping for Shell Commands

**Question**: How to safely escape prompt text for shell command execution?

**Decision**: Escape special characters and use proper quoting strategy.

**Rationale**:
- The prompt will contain user-selected markdown text which may include quotes, newlines, and special characters
- Shell injection is a concern when constructing command strings
- Using single quotes with internal quote escaping is the safest approach

**Implementation Pattern**:
```typescript
function escapeForShell(text: string): string {
    // Replace single quotes with escaped version: ' -> '\''
    // This ends the current string, adds an escaped quote, and reopens the string
    return text.replace(/'/g, "'\\''");
}

// Usage: copilot --allow-all-tools -p '${escapeForShell(prompt)}'
```

**Alternatives Considered**:
- JSON encoding: Would add extra quotes and escape characters visible to user
- Base64 encoding: Adds complexity and requires decoding on Copilot's end

### 3. Context Menu Extension in Webview

**Question**: How to add new items to the existing context menu?

**Decision**: Follow the existing pattern in `webview-content.ts` and `dom-handlers.ts`.

**Rationale**:
- The context menu HTML structure is in `webview-content.ts` (lines 129-151)
- Menu items are `<div class="context-menu-item">` elements with IDs
- Event handlers are set up in `dom-handlers.ts` in `setupContextMenuEventListeners()`
- Selection state is managed via `state.savedSelectionForContextMenu`
- The "Ask AI" option should behave like "Add Comment" (requires selection)

**Implementation Pattern**:
1. Add HTML in `webview-content.ts`:
```html
<div class="context-menu-separator"></div>
<div class="context-menu-item" id="contextMenuAskAI">
    <span class="context-menu-icon">🤖</span> Ask AI
</div>
```

2. Add handler in `dom-handlers.ts`:
```typescript
contextMenuAskAI.addEventListener('click', () => {
    hideContextMenu();
    handleAskAI();
});
```

3. Add message type in `vscode-bridge.ts`:
```typescript
export function requestAskAI(selectedText: string, context: DocumentContext): void {
    postMessage({ type: 'askAI', selectedText, context });
}
```

### 4. Document Context Extraction

**Question**: How to extract surrounding context (headers, paragraphs) for the prompt?

**Decision**: Reuse and extend the existing content structure from the webview state.

**Rationale**:
- The webview `state` already has access to `currentContent` (full document text)
- Selection position (line numbers) is available from `savedSelectionForContextMenu`
- Headers can be extracted by parsing lines starting with `#`
- Surrounding paragraphs can be captured using a line window (e.g., ±5 lines)

**Implementation Pattern**:
```typescript
interface DocumentContext {
    filePath: string;
    selectedText: string;
    selectionRange: { startLine: number; endLine: number };
    surroundingContent: string;  // Lines around selection
    headings: string[];          // All # headers in document
    nearestHeading: string | null;  // Heading above selection
}

function extractDocumentContext(): DocumentContext {
    const lines = state.currentContent.split('\n');
    const { startLine, endLine } = state.savedSelectionForContextMenu;

    // Get surrounding lines (5 before, 5 after)
    const contextStart = Math.max(0, startLine - 6);
    const contextEnd = Math.min(lines.length, endLine + 5);
    const surroundingContent = lines.slice(contextStart, contextEnd).join('\n');

    // Extract headers
    const headings = lines.filter(l => l.startsWith('#'));

    // Find nearest heading above selection
    let nearestHeading = null;
    for (let i = startLine - 1; i >= 0; i--) {
        if (lines[i].startsWith('#')) {
            nearestHeading = lines[i];
            break;
        }
    }

    return { ... };
}
```

### 5. Prompt Size Management

**Question**: How to enforce the 8000 character limit?

**Decision**: Truncate context (not selection) when limit exceeded; show warning.

**Rationale**:
- The spec requires preserving the full selected text
- Context can be reduced without losing the user's core question
- User should be informed when truncation occurs

**Implementation Pattern**:
```typescript
const MAX_PROMPT_SIZE = 8000;

function buildPrompt(selection: string, context: DocumentContext): { prompt: string; truncated: boolean } {
    const basePrompt = formatPrompt(selection, context);

    if (basePrompt.length <= MAX_PROMPT_SIZE) {
        return { prompt: basePrompt, truncated: false };
    }

    // Truncate context while preserving selection
    const selectionPart = formatSelection(selection);
    const remainingBudget = MAX_PROMPT_SIZE - selectionPart.length - 200; // buffer for headers
    const truncatedContext = context.surroundingContent.substring(0, remainingBudget);

    return {
        prompt: formatPrompt(selection, { ...context, surroundingContent: truncatedContext }),
        truncated: true
    };
}
```

### 6. VS Code Settings Integration

**Question**: How to add configuration for AI tool selection?

**Decision**: Add new setting in `package.json` under `contributes.configuration`.

**Rationale**:
- Follows existing pattern used for sync and markdown comments settings
- Users can configure via Settings UI or settings.json
- Setting can be read via `vscode.workspace.getConfiguration()`

**Implementation Pattern**:

In `package.json`:
```json
{
  "workspaceShortcuts.aiClarification.tool": {
    "type": "string",
    "enum": ["copilot-cli", "clipboard"],
    "default": "copilot-cli",
    "description": "AI tool for clarification requests"
  }
}
```

In extension code:
```typescript
const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiClarification');
const tool = config.get<string>('tool', 'copilot-cli');
```

### 7. Fallback Behavior

**Question**: How to detect if Copilot CLI is unavailable and fallback gracefully?

**Decision**: Try terminal execution; if copilot command fails, copy to clipboard with notification.

**Rationale**:
- We cannot reliably detect if `copilot` is installed before execution
- Letting the terminal show the error is acceptable user experience
- Clipboard fallback ensures feature always works
- User notification guides them on what to do next

**Implementation Pattern**:
```typescript
async function invokeAI(prompt: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiClarification');
    const tool = config.get<string>('tool', 'copilot-cli');

    if (tool === 'clipboard') {
        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('Clarification prompt copied to clipboard');
        return;
    }

    // Try Copilot CLI
    const terminal = vscode.window.createTerminal({
        name: 'Copilot Clarification',
        hideFromUser: false
    });
    terminal.show();
    terminal.sendText(`copilot --allow-all-tools -p '${escapeForShell(prompt)}'`);

    vscode.window.showInformationMessage('Sent to Copilot CLI. If copilot is not installed, install it or change the setting to clipboard.');
}
```

## Summary

All research questions have been resolved. The implementation approach:

1. **Context Menu**: Extend existing HTML and handlers following established patterns
2. **Message Passing**: Add new `askAI` message type to webview-extension bridge
3. **Context Extraction**: Parse document content in webview before sending
4. **Prompt Building**: New function in extension to format prompt with 8000 char limit
5. **CLI Invocation**: Use VSCode Terminal API with proper shell escaping
6. **Settings**: Standard VS Code configuration pattern
7. **Fallback**: Clipboard copy with user notification
