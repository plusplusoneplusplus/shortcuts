# Add "Ask AI Interactively" to AI Action Dropdown

## Problem

The Markdown Review Editor's AI Action dropdown (`🤖 AI Action ▼`) currently offers actions like **Follow Prompt**, **Update Document**, **Refresh Plan**, and the **Resolve Comments** submenu. However, the **Ask AI Interactively** action — which is already available in the context menu — is missing from the top-level AI Action dropdown. Users should be able to start an interactive AI session directly from the toolbar dropdown without needing to first select text and right-click.

Additionally, the **Refresh Plan** action should be included alongside the new interactive option within the dropdown for a coherent workflow.

## Approach

Add an **"Ask AI Interactively"** menu item to the AI Action dropdown in the toolbar. This item should trigger the same interactive AI flow currently used by the context menu's "Ask AI Interactively" submenu — opening a Copilot chat session or CLI interactive session where the user can converse with the AI about the current document.

### Key Design Decisions

- Reuse the existing `askAIInteractive` message type and handler from the context menu flow
- Place the new item logically in the dropdown (e.g., between "Update Document" and "Refresh Plan", or as a new group)
- Ensure "Refresh Plan" remains visible and accessible in the dropdown
- Support the same execution mode options (chat, CLI interactive) as the context menu version

## Acceptance Criteria

- [x] "Ask AI Interactively" appears as a top-level item in the AI Action dropdown menu
- [x] Clicking it opens an interactive AI session (Copilot chat or CLI interactive)
- [x] The action works without requiring a text selection (operates on the full document context)
- [x] "Refresh Plan" remains in the AI Action dropdown and functions correctly
- [x] The dropdown layout is visually consistent with existing items (icons, separators, hover styles)
- [x] No regressions in existing AI Action dropdown functionality (Follow Prompt, Update Document, Resolve Comments)
- [x] Works correctly when AI service is both enabled and disabled (graceful fallback / disabled state)

## Subtasks

### 1. Update Webview HTML Template
- **File:** `src/shortcuts/markdown-comments/webview-content.ts`
- Add a new `.ai-action-item` for "Ask AI Interactively" inside the `.ai-action-menu` container
- Position it appropriately with separator if needed
- Use a suitable icon/label consistent with the existing context menu version

### 2. Add Event Handling for New Menu Item
- **File:** `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts`
- Register click handler in `setupAIActionDropdown()` for the new menu item
- On click, send the appropriate message to the extension via vscode bridge
- Handle menu hide after selection

### 3. Wire Up VSCode Bridge Communication
- **File:** `src/shortcuts/markdown-comments/webview-scripts/vscode-bridge.ts`
- Ensure `requestAskAIInteractive()` (or equivalent) is called when the new item is clicked
- Pass the full document context (not just selected text) as the prompt payload

### 4. Handle Message in Extension
- **File:** `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
- Verify that `handleWebviewMessage()` correctly processes the `askAIInteractive` message type when triggered from the dropdown (not just context menu)
- Ensure it works without a text selection — fall back to full document or current section

### 5. Verify Refresh Plan Placement
- Confirm "Refresh Plan" is present and correctly ordered in the dropdown
- Ensure no duplicate entries if it was previously in a different location

### 6. Testing
- Manually test the new dropdown item with AI service enabled
- Test with AI service disabled (item should be hidden or show appropriate message)
- Verify existing dropdown items still work
- Test on different themes (light/dark) for visual consistency

## Notes

- The context menu already supports "Ask AI Interactively" via `ContextMenuManager` with mode `'interactive'` — the toolbar dropdown should reuse the same underlying logic
- The `WebviewMessage` type union in `types.ts` already includes `askAIInteractive` — no new message type should be needed
- Consider whether the dropdown item should show a submenu for execution mode (chat vs CLI interactive) or default to the preferred mode
- The `vscode-bridge.ts` already has `requestSendToCLIInteractive()` — evaluate whether to reuse this or create a dedicated function for the toolbar-triggered flow
