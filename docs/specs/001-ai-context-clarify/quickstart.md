# Quickstart: AI Context Clarification Menu

**Feature**: `001-ai-context-clarify`
**Branch**: `001-ai-context-clarify`

## Prerequisites

- Node.js 18+
- VS Code 1.95.0+
- GitHub Copilot CLI installed (`copilot` command available in PATH)

## Setup

```bash
# Clone and checkout branch
git checkout 001-ai-context-clarify

# Install dependencies
npm install

# Compile
npm run compile
```

## Development Workflow

### 1. Run Extension in Debug Mode

Press `F5` in VS Code or run:
```bash
npm run watch
```

Then launch "Run Extension" from the Debug panel.

### 2. Test the Feature

1. Open a markdown file in the Extension Development Host
2. Right-click → "Open with Review Editor"
3. Select some text in the review editor
4. Right-click → "Ask AI"
5. Verify:
   - A terminal opens named "Copilot Clarification"
   - The `copilot --allow-all-tools -p '...'` command is executed
   - The prompt includes selected text and document context

### 3. Test Clipboard Fallback

1. Open VS Code Settings
2. Set `workspaceShortcuts.aiClarification.tool` to `clipboard`
3. Repeat the "Ask AI" action
4. Verify the prompt is copied to clipboard with notification

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/shortcuts/markdown-comments/webview-content.ts` | Add "Ask AI" context menu HTML |
| `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` | Add click handler for "Ask AI" |
| `src/shortcuts/markdown-comments/webview-scripts/vscode-bridge.ts` | Add `requestAskAI()` function |
| `src/shortcuts/markdown-comments/webview-scripts/types.ts` | Add `askAI` message type |
| `src/shortcuts/markdown-comments/review-editor-view-provider.ts` | Handle `askAI` message |
| `src/shortcuts/markdown-comments/ai-clarification-handler.ts` | **NEW** - CLI invocation logic |
| `src/shortcuts/markdown-comments/types.ts` | Add `ClarificationContext` type |
| `package.json` | Add settings schema |
| `src/test/suite/ai-clarification.test.ts` | **NEW** - Unit tests |

## Implementation Order

1. **Types First**: Add types to `types.ts` and `webview-scripts/types.ts`
2. **Webview UI**: Add context menu item in `webview-content.ts`
3. **Webview Logic**: Add handlers in `dom-handlers.ts` and `vscode-bridge.ts`
4. **Extension Handler**: Add message handler in `review-editor-view-provider.ts`
5. **AI Handler**: Create `ai-clarification-handler.ts` with prompt building and CLI invocation
6. **Settings**: Add configuration to `package.json`
7. **Tests**: Add test cases

## Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npm run compile-tests && npx mocha out/test/suite/ai-clarification.test.js

# Lint
npm run lint
```

## Verification Checklist

- [ ] "Ask AI" appears in context menu when text is selected
- [ ] "Ask AI" is disabled when no text is selected
- [ ] Terminal opens with correct copilot command
- [ ] Prompt includes selected text, file path, and surrounding context
- [ ] Prompt does not exceed 8000 characters
- [ ] Clipboard fallback works when configured
- [ ] User notification shown after action
- [ ] Works on Windows, macOS, and Linux (path handling)
- [ ] All existing tests still pass
- [ ] No TypeScript errors (`npm run compile`)
- [ ] No ESLint errors (`npm run lint`)

## Architecture Notes

```
User selects text → Right-click → "Ask AI"
         ↓
    [Webview]
    dom-handlers.ts: handleAskAI()
         ↓
    Extracts context from state
         ↓
    vscode-bridge.ts: postMessage({ type: 'askAI', context })
         ↓
    [Extension]
    review-editor-view-provider.ts: handleWebviewMessage()
         ↓
    ai-clarification-handler.ts: handleClarificationRequest()
         ↓
    Builds prompt (max 8000 chars)
         ↓
    [Tool Selection]
    ├── copilot-cli: vscode.window.createTerminal() → sendText()
    └── clipboard: vscode.env.clipboard.writeText() → showInformationMessage()
```

## Common Issues

### Copilot CLI not found

If you see "copilot: command not found" in the terminal:
1. Install GitHub Copilot CLI: https://docs.github.com/copilot/using-github-copilot/using-github-copilot-in-the-command-line
2. Or change setting to `clipboard` fallback

### Prompt too long

If prompt is truncated, you'll see a warning notification. The context is reduced while preserving the full selected text.

### Special characters in selection

The handler escapes shell special characters. If issues persist, use the clipboard option.
