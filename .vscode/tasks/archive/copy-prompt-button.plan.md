# Add Copy Prompt Button to Follow Prompt Dialog

## Problem
Users want to copy the generated prompt to clipboard directly from the Follow Prompt dialog, without executing it. Currently, only "Execute" and "Cancel" buttons are available.

## Proposed Approach
Add a "Copy Prompt" button next to the "Execute" button in the Follow Prompt dialog. This will allow users to copy the prompt content (including any additional context) to their clipboard for use elsewhere.

## Files to Modify

1. **`src/shortcuts/markdown-comments/webview-content.ts`** - Add the Copy Prompt button HTML
2. **`src/shortcuts/markdown-comments/webview-scripts/follow-prompt-dialog.ts`** - Add click handler for copy functionality
3. **`src/shortcuts/markdown-comments/webview-scripts/types.ts`** - Add new message type for copy action (if needed)
4. **`src/shortcuts/markdown-comments/review-editor-view-provider.ts`** - Handle the copy message from webview
5. **`media/styles/components.css`** - Style the new button (if needed)

## Workplan

- [x] Add "Copy Prompt" button HTML in `webview-content.ts` (modal-footer, next to Execute)
- [x] Add click handler in `follow-prompt-dialog.ts` for the copy button
- [x] Add message type for requesting prompt content from extension
- [x] Handle copy request in `review-editor-view-provider.ts` to generate and return prompt
- [x] Copy prompt text to clipboard (either via webview or extension side)
- [x] Add user feedback (e.g., button text change to "Copied!" or notification)
- [x] Test the feature manually
- [x] Ensure existing tests still pass

## Implementation Notes

### Button Placement
The button should be placed in the modal footer, styled as secondary (similar to Cancel):
```html
<div class="modal-footer">
    <button id="fpCancelBtn" class="btn btn-secondary">Cancel</button>
    <button id="fpCopyPromptBtn" class="btn btn-secondary">Copy Prompt</button>
    <button id="fpExecuteBtn" class="btn btn-primary">Execute</button>
</div>
```

### Copy Flow Options

**Option A: Extension-side clipboard (Recommended)**
1. Webview sends `copyPrompt` message with dialog options (additionalContext, model)
2. Extension generates full prompt using `PromptGenerator`
3. Extension copies to clipboard via `vscode.env.clipboard.writeText()`
4. Extension sends success message back to webview for UI feedback

**Option B: Webview-side clipboard**
1. Extension needs to send prompt content to webview first
2. Webview uses `navigator.clipboard.writeText()`
3. More complex due to async flow

### Considerations
- The prompt content depends on selected comments and prompt file content
- Need to include `additionalContext` from the dialog if provided
- Should work for both skill prompts and regular prompt files
- Button should provide visual feedback on successful copy
