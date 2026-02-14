# Update Document Action Feature

## Problem Statement
Currently, users must create comments to trigger AI actions on the markdown document. There's no easy way to provide document-level instructions without targeting specific lines. This feature adds an "Update Document" action in the AI Action dropdown that launches a dialog for document-level instructions and then starts an interactive AI session.

## Proposed Approach
Add a new menu item "Update Document" in the AI Action dropdown menu (alongside "Follow Prompt" and "Resolve Comments"). When clicked, it shows a dialog where users can enter a message describing what they want to change. The instruction is then sent to an interactive AI session with the full document context.

## Workplan

- [x] **1. Add "Update Document" menu item to AI Action dropdown**
  - File: `src/shortcuts/markdown-comments/webview-content.ts`
  - Add new menu item after "Follow Prompt" with icon 📝 and label "Update Document"
  - ID: `updateDocumentItem`

- [x] **2. Add message type for "Update Document" request**
  - File: `src/shortcuts/markdown-comments/webview-scripts/types.ts`
  - Add `updateDocument` to `WebviewMessage` union type with `instruction: string` field
  - Add `showUpdateDocumentDialog` to `ExtensionMessage` union type

- [x] **3. Create Update Document dialog UI (reuse Follow Prompt dialog pattern)**
  - File: `src/shortcuts/markdown-comments/webview-content.ts`
  - Add dialog HTML similar to Follow Prompt dialog but simpler:
    - Title: "Update Document"
    - Textarea for instruction input
    - Submit/Cancel buttons

- [x] **4. Create dialog handler in webview**
  - File: `src/shortcuts/markdown-comments/webview-scripts/update-document-dialog.ts` (new file)
  - Implement `initUpdateDocumentDialog()` and `showUpdateDocumentDialog()`
  - Handle submit: post message `{ type: 'updateDocument', instruction: string }`

- [x] **5. Wire up dialog in webview main.ts**
  - File: `src/shortcuts/markdown-comments/webview-scripts/main.ts`
  - Import and initialize the dialog
  - Handle `showUpdateDocumentDialog` message from extension

- [x] **6. Add menu item click handler**
  - File: `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts`
  - Add click handler for `updateDocumentItem` to show the dialog
  - Post message to extension to request showing dialog (to get model options if needed)

- [x] **7. Handle message in ReviewEditorViewProvider**
  - File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
  - Add case for `updateDocument` message type
  - Implement `handleUpdateDocument(instruction: string, filePath: string)` method:
    - Read current document content
    - Build prompt: instruction + full document content
    - Start interactive AI session with the prompt

- [x] **8. Add CSS styles for dialog**
  - File: `src/shortcuts/markdown-comments/webview-content.ts` (in styles section)
  - Style the update document dialog consistently with existing dialogs
  - (Reused existing modal styles from components.css)

## Implementation Notes

### Dialog Design
```
┌──────────────────────────────────────┐
│ 📝 Update Document              [X] │
├──────────────────────────────────────┤
│ What changes do you want to make?   │
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ │ (textarea for instruction)       │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│             [Cancel] [Update]        │
└──────────────────────────────────────┘
```

### Prompt Format
```
The user wants to update this markdown document with the following instruction:

{user instruction}

Current document content:
---
{full document content}
---

Please make the requested changes to the document.
```

### Interactive Session
- Uses existing `getInteractiveSessionManager()` 
- Working directory: workspace root (or src if exists)
- Tool: copilot (configurable)

## Testing Considerations
- Manual testing: verify dialog opens, input works, session launches
- Verify prompt contains document content and user instruction
- Verify interactive session starts correctly

## Files to Modify
1. `webview-content.ts` - Add menu item HTML and dialog HTML
2. `webview-scripts/types.ts` - Add message types
3. `webview-scripts/dom-handlers.ts` - Add click handler
4. `webview-scripts/main.ts` - Wire up dialog
5. `review-editor-view-provider.ts` - Handle message and launch session
6. (new) `webview-scripts/update-document-dialog.ts` - Dialog logic
