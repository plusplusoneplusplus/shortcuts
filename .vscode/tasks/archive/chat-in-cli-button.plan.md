# Plan: Add "Chat In CLI" Button to Task Document Viewer

## Problem

The task document viewer (Preview/Source webview) has no quick way to start an interactive CLI chat session about the currently open file. The existing CLI interactive option is buried inside the AI Action dropdown and only works with open comments. The user wants a prominent, easily accessible button—placed next to the Preview/Source toggle—that starts a CLI chat with just the file path, then lets the AI ask the user what they want to know.

## Proposed Approach

Add a new **"Chat In CLI"** button to the toolbar row, positioned **after the Preview/Source mode toggle** and **before the AI Action dropdown**. When clicked, it launches an interactive CLI session with a minimal prompt containing the file path, instructing the AI to ask the user what they'd like help with.

## Key Files to Modify

| File | Change |
|------|--------|
| `src/shortcuts/markdown-comments/webview-content.ts` | Add the "Chat In CLI" button HTML in the toolbar, after the mode toggle `<div>` |
| `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` | Add click handler for the new button, send a message to the extension host |
| `src/shortcuts/markdown-comments/editor-message-router.ts` | Handle the new `chatInCLI` message type; construct a file-path-based prompt and launch interactive session |
| `media/styles/webview.css` (or `components.css`) | Style the new button to match the toolbar aesthetic |

## Implementation Details

### 1. Toolbar Button HTML (`webview-content.ts`)

Insert a new button inside the first `toolbar-group`, right after the mode toggle div (after line ~128):

```html
<button id="chatInCliBtn" class="toolbar-btn chat-cli-btn" title="Chat about this file in CLI">
    <span class="icon">💬</span> Chat In CLI
</button>
```

### 2. Click Handler (`dom-handlers.ts`)

Add an event listener for `#chatInCliBtn` that posts a message to the extension host:

```typescript
document.getElementById('chatInCliBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'chatInCLI' });
});
```

### 3. Message Router Handler (`editor-message-router.ts`)

Add a new handler method `handleChatInCLI`:

```typescript
private async handleChatInCLI(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
    const filePath = ctx.document.uri.fsPath;
    const prompt = [
        `The user has opened the file: ${filePath}`,
        ``,
        `Please ask the user what they would like to know or do with this file.`,
        `Be helpful and proactive — suggest relevant questions based on the file type and content.`
    ].join('\n');

    const sessionManager = getInteractiveSessionManager();
    const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

    const sessionId = await sessionManager.startSession({
        workingDirectory,
        tool: 'copilot',
        initialPrompt: prompt
    });

    if (sessionId) {
        await this.host.showInfo('CLI chat session started for this file.');
    } else {
        await this.host.copyToClipboard(prompt);
        await this.host.showWarning('Failed to start CLI session. Prompt copied to clipboard.');
    }
    return {};
}
```

Register the route in the dispatch map:

```typescript
'chatInCLI': (msg, ctx) => this.handleChatInCLI(msg, ctx),
```

### 4. Button Styling (`webview.css` or `components.css`)

Style the button consistently with the existing mode toggle buttons, but as a standalone action button:

```css
.chat-cli-btn {
    margin-left: 8px;
    /* Match existing toolbar button style */
}
```

## Todos

1. ~~**toolbar-button-html** — Add "Chat In CLI" button HTML to the toolbar in `webview-content.ts`~~ ✅
2. ~~**click-handler** — Add click event handler in `dom-handlers.ts` to post `chatInCLI` message~~ ✅
3. ~~**message-router** — Add `handleChatInCLI` handler in `editor-message-router.ts` with file-path-based prompt~~ ✅
4. ~~**button-styling** — Style the new button in the CSS to match toolbar aesthetics~~ ✅
5. ~~**test-and-verify** — Build, run tests, and verify the button appears and works correctly~~ ✅

## Notes

- The prompt is intentionally minimal: just the file path + instruction for the AI to ask the user what they need. No comments or file content are included.
- This button should be **always visible** (not gated by `toolbar-review-only`) since it's relevant in both Preview and Source modes.
- The existing `handleSendToCLIInteractive` constructs a prompt from open comments. This new handler is fundamentally different—it uses only the file path.
- Falls back to copying the prompt to clipboard if the interactive session fails to start (consistent with existing pattern).
