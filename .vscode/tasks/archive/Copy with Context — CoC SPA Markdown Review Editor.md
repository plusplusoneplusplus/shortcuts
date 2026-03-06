# UX Spec: Copy with Context — CoC SPA Markdown Review Editor

## 1. User Story

As a developer using the CoC SPA Markdown review editor, I want to right-click on selected text (or anywhere in the document when nothing is selected) and choose **"Copy with Context"**, so that I can paste the text into a chat or ticket with the file path already included — giving the reader full context without manual formatting.

---

## 2. Entry Points

### Primary: Context Menu (right-click)
- Right-clicking anywhere in the **Preview pane** of `MarkdownReviewEditor` opens the existing `ContextMenu` (already has "Add comment" and "Ask AI" items).
- A new item **"Copy with Context"** is added to this menu.
- The item is **always enabled** — regardless of whether text is selected.
  - With selection → copies selected text + file path.
  - Without selection → copies the full document + file path.

### No keyboard shortcut or toolbar button needed (matches VS Code extension behaviour).

---

## 3. User Flow

### Happy Path — With Selection
1. User opens a file in the Markdown review editor (via conversation file-path link or Tasks panel).
2. User selects some text in the preview pane.
3. User right-clicks → context menu appears.
4. User clicks **"Copy with Context"**.
5. Clipboard is populated with:
   ```
   <filePath>
   ```
   <selected text>
   ```
   ```
6. A brief **success toast / snackbar** appears: _"Copied with context"_ (auto-dismisses in ~2 s).

### Happy Path — No Selection (Full Document)
1. User right-clicks anywhere in the preview pane with nothing selected.
2. User clicks **"Copy with Context"**.
3. Clipboard is populated with the full raw markdown content + file path in the same format.
4. Same success toast appears.

### Success State
Clipboard contains:
```
{filePath}
```
{text}
```
```
This matches the format used by the VS Code extension counterpart.

---

## 4. Edge Cases & Error Handling

| Scenario | Behaviour |
|---|---|
| `filePath` is empty/unknown | Copy proceeds; file path line is omitted or shown as `(unknown file)` |
| Clipboard write fails (browser permission denied) | Toast shows _"Failed to copy — clipboard access denied"_ |
| Document content not yet loaded | Menu item is **disabled** with a tooltip: _"Content loading…"_ |
| Selection spans across comment sidebar (not inside preview pane) | Treat as no-selection; copy full document |

---

## 5. Visual Design Considerations

### Context Menu Item
- Label: **"Copy with Context"**
- Icon: 📋 (clipboard) or a copy icon consistent with existing menu items
- Position: **between** "Add comment" and the separator before "Ask AI" — placing it near other non-AI actions
- Always visible; only **disabled** when content hasn't loaded yet

### Success Toast
- Reuse the existing notification/toast pattern in the CoC SPA dashboard (if one exists); otherwise a small fade-in/fade-out overlay anchored to the bottom of the editor pane.
- Message: _"Copied with context"_
- Duration: ~2 seconds, no manual dismiss needed

### No new icons or assets required beyond what the existing context menu already uses.

---

## 6. Settings & Configuration

No new settings needed. The output format (file path + fenced code block) is fixed to match the VS Code extension, keeping the experience consistent across both surfaces.

---

## 7. Discoverability

- The item lives in the right-click context menu that users already interact with (for "Add comment" and "Ask AI").
- No separate onboarding needed — the label is self-explanatory.
- Consistency with the VS Code extension means users familiar with one surface will intuitively try it in the other.

---

## 8. Scope / Out of Scope

| In Scope | Out of Scope |
|---|---|
| Preview pane context menu | Source (raw edit) pane |
| `MarkdownReviewEditor` component | Other SPA editors or viewers |
| Browser clipboard API | Custom format options or configurable templates |

---

## 9. Implementation Hints (for planning phase)

Key files expected to change:
- `MarkdownReviewEditor.tsx` — add menu item; call `navigator.clipboard.writeText()`
- `tasks/comments/ContextMenu.tsx` — add new `ContextMenuItem` entry
- Toast utility — reuse or create minimal feedback mechanism

`filePath` is already available as a prop on `MarkdownReviewEditor` and stamped on the DOM as `data-source-file`. `savedSelection.text` (or raw content fallback) provides the text. No new API calls or backend changes required.
