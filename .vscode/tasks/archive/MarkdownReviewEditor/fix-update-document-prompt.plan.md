# Fix: Update Document Prompt Missing File Path & Redundant Content

## Problem

The **"Update Document"** AI action (from the AI action dropdown in the Markdown Review Editor) builds a prompt that:

1. **Does not include the file path** of the current document — the AI session has no way to know *which* file to edit.
2. **Includes the full document content** inline in the prompt, which is unnecessary since the AI CLI tool can read the file itself via its toolset.

Compare with `handleRefreshPlan` (line ~2183), which correctly includes the file path in its prompt (e.g., `Edit the file in-place at: ${filePath}`).

## Root Cause

In `src/shortcuts/markdown-comments/review-editor-view-provider.ts`, the `handleUpdateDocument` method (line ~2128):

```typescript
private async handleUpdateDocument(instruction: string, filePath: string): Promise<void> {
    const documentContent = await fs.promises.readFile(filePath, 'utf-8');

    const prompt = `The user wants to update this markdown document with the following instruction:

${instruction}

Current document content:
---
${documentContent}
---

Please make the requested changes to the document.`;
    // ...
}
```

- `filePath` is received but never included in the prompt text.
- `documentContent` is read from disk and embedded, bloating the prompt when the AI can read it directly.

## Proposed Fix

### File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`

**Method:** `handleUpdateDocument` (line ~2128)

Replace the prompt construction to:
1. **Include the file path** so the AI knows which file to edit.
2. **Remove the inline document content** — instruct the AI to read it instead.
3. **Add output requirements** (similar to `handleRefreshPlan`) telling the AI to edit in-place.

```typescript
private async handleUpdateDocument(instruction: string, filePath: string): Promise<void> {
    try {
        const fileName = path.basename(filePath);

        // Build the prompt — no need to embed content, AI can read the file
        const prompt = `The user wants to update the following markdown document:

File: ${fileName}
Path: ${filePath}

## User Instruction
${instruction}

## Output Requirements

**CRITICAL:** Read the file and then edit it in-place at: ${filePath}

- Make only the changes described in the instruction
- Preserve markdown format and any frontmatter
- Do NOT create new files or write to session state/temp directories
- Do NOT output the full file content to stdout`;

        // ... rest of method unchanged (session manager, tool config, etc.)
    }
}
```

**Key changes:**
- Remove `fs.promises.readFile` call (no longer needed).
- Add `filePath` and `fileName` to prompt text.
- Add "Output Requirements" section with in-place edit instruction (consistent with `handleRefreshPlan`).

### File: `src/test/suite/update-document-dialog.test.ts`

Update the `buildUpdateDocumentPrompt` helper and related tests:
- Remove `documentContent` parameter from `buildUpdateDocumentPrompt`.
- Add `filePath` parameter instead.
- Update assertions to check for file path presence instead of content presence.
- Update the "Prompt Building" suite tests accordingly.

## Scope

| Area | Change |
|------|--------|
| `review-editor-view-provider.ts` | Rewrite prompt in `handleUpdateDocument` |
| `update-document-dialog.test.ts` | Update prompt-building tests |

No changes needed to webview-side code (`update-document-dialog.ts`, `dom-handlers.ts`, `vscode-bridge.ts`, `types.ts`) — the message format (`{ type: 'updateDocument', instruction }`) remains the same.

## Acceptance Criteria

- [ ] The AI prompt includes the full file path of the document being edited
- [ ] The AI prompt does NOT include the full document content inline
- [ ] The prompt instructs the AI to read and edit the file in-place
- [ ] Existing tests updated and passing
- [ ] No regressions in other AI actions (Refresh Plan, Execute Work Plan, etc.)
