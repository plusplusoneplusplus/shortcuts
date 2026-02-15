---
status: pending
---

# 005 — Add AI action dropdown button and shell to CoC SPA task rows

## Summary

Add a `🤖` AI action button to each file row (single documents and document-group documents) in the Miller columns UI of `tasks.ts`. Clicking the button opens a positioned dropdown menu with two stub items ("📝 Follow Prompt" and "✏️ Update Document"). The dropdown is implemented in a new `ai-actions.ts` module. CSS for the dropdown is added to `styles.css`. The new module is imported from `index.ts`. Dropdown actions are stubs — wired to real functionality in commits 006 and 007.

## Dependencies

- **Depends on:** None (pure UI shell; dropdown actions are stubs wired in 006 and 007)

---

## File Changes

### 1. CREATE `packages/coc/src/server/spa/client/ai-actions.ts`

New module responsible for the AI action dropdown lifecycle.

**Exports:**
- `showAIActionDropdown(button: HTMLElement, wsId: string, taskPath: string): void`
- `hideAIActionDropdown(): void`

**Implementation detail:**

```typescript
/**
 * AI action dropdown for task file rows in the Miller columns UI.
 * Stub shell — menu items wired to real handlers in 006/007.
 */

import { escapeHtmlClient } from './utils';

let activeDropdown: HTMLElement | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Show the AI action dropdown positioned near the trigger button.
 * Only one dropdown can be open at a time.
 */
export function showAIActionDropdown(button: HTMLElement, wsId: string, taskPath: string): void {
    // Close any already-open dropdown first
    hideAIActionDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'ai-action-dropdown';
    dropdown.setAttribute('data-ws-id', wsId);
    dropdown.setAttribute('data-task-path', taskPath);

    dropdown.innerHTML =
        '<button class="ai-action-menu-item" data-ai-action="follow-prompt">' +
            '<span class="ai-action-menu-icon">📝</span>' +
            '<span class="ai-action-menu-label">Follow Prompt</span>' +
        '</button>' +
        '<button class="ai-action-menu-item" data-ai-action="update-document">' +
            '<span class="ai-action-menu-icon">✏️</span>' +
            '<span class="ai-action-menu-label">Update Document</span>' +
        '</button>';

    // Position relative to the trigger button
    document.body.appendChild(dropdown);
    const rect = button.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();

    // Default: below and left-aligned to button
    let top = rect.bottom + 4;
    let left = rect.left;

    // If dropdown would overflow right edge, align to right edge of button
    if (left + dropdownRect.width > window.innerWidth - 8) {
        left = rect.right - dropdownRect.width;
    }
    // If dropdown would overflow bottom, show above the button
    if (top + dropdownRect.height > window.innerHeight - 8) {
        top = rect.top - dropdownRect.height - 4;
    }

    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';

    activeDropdown = dropdown;

    // Menu item clicks — stubs for now (006/007 wire real handlers)
    dropdown.addEventListener('click', (e: Event) => {
        const item = (e.target as HTMLElement).closest('[data-ai-action]') as HTMLElement | null;
        if (!item) return;
        const action = item.getAttribute('data-ai-action');
        // Stub: log to console. 006/007 will replace with real calls.
        console.log('[ai-actions] stub action:', action, 'path:', taskPath, 'ws:', wsId);
        hideAIActionDropdown();
    });

    // Close on outside click (deferred to next tick so the opening click doesn't close it)
    requestAnimationFrame(() => {
        outsideClickHandler = (e: MouseEvent) => {
            if (activeDropdown && !activeDropdown.contains(e.target as Node)) {
                hideAIActionDropdown();
            }
        };
        document.addEventListener('click', outsideClickHandler, true);
    });
}

/** Remove the active dropdown and clean up listeners. */
export function hideAIActionDropdown(): void {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler, true);
        outsideClickHandler = null;
    }
}
```

**Key design decisions:**
- Dropdown is appended to `document.body` (not inside the Miller column) to avoid overflow clipping by `.miller-column { overflow: hidden }`.
- Uses `position: fixed` in CSS so coordinates from `getBoundingClientRect()` work directly.
- `requestAnimationFrame` defers the outside-click listener so the button click that opens the dropdown doesn't immediately close it.
- Only one dropdown at a time — calling `showAIActionDropdown` when one is open closes the existing one first.
- Menu item click uses event delegation on the dropdown container via `[data-ai-action]`.
- Stub actions log to console; commits 006 and 007 replace with real API calls.

---

### 2. MODIFY `packages/coc/src/server/spa/client/tasks.ts`

#### 2a. Add import at top of file

After the existing import of `escapeHtmlClient` from `'./utils'` (line 10), add:

```typescript
import { showAIActionDropdown, hideAIActionDropdown } from './ai-actions';
```

#### 2b. Add 🤖 button to document-group file rows in `renderColumn()`

In the `renderColumn()` function, inside the `folder.documentGroups` loop (lines 419–429), the file rows are rendered. After the status span and before the closing `'</div>'` of each row, insert an AI action button.

**Current code (lines 425–429):**
```typescript
                html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                    '<span class="task-tree-icon">📄</span>' +
                    '<span class="miller-row-name">' + escapeHtmlClient(displayName) + '</span>' +
                    (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
                '</div>';
```

**New code:**
```typescript
                html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                    '<span class="task-tree-icon">📄</span>' +
                    '<span class="miller-row-name">' + escapeHtmlClient(displayName) + '</span>' +
                    (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
                    '<span class="task-tree-actions"><button class="task-action-btn" data-action="ai-action" data-path="' + escapeHtmlClient(docPath) + '" title="AI Actions">🤖</button></span>' +
                '</div>';
```

**What changed:** Added a `<span class="task-tree-actions">` containing a `<button>` with `data-action="ai-action"` and `data-path` set to the document's relative path. The button uses the existing `.task-action-btn` class (already styled for hover-reveal in `.task-tree-actions`). Uses the 🤖 emoji as the icon.

#### 2c. Add 🤖 button to single-document file rows in `renderColumn()`

Same change in the `folder.singleDocuments` loop (lines 436–442).

**Current code (lines 439–442):**
```typescript
            html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                '<span class="task-tree-icon">📄</span>' +
                '<span class="miller-row-name">' + escapeHtmlClient(doc.baseName) + '</span>' +
                (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
            '</div>';
```

**New code:**
```typescript
            html += '<div class="miller-row miller-file-row' + (isActive ? ' miller-row-selected' : '') + '" data-file-path="' + escapeHtmlClient(docPath) + '">' +
                '<span class="task-tree-icon">📄</span>' +
                '<span class="miller-row-name">' + escapeHtmlClient(doc.baseName) + '</span>' +
                (doc.status ? '<span class="miller-status task-status-' + escapeHtmlClient(doc.status) + '">' + (STATUS_ICONS[doc.status] || '') + '</span>' : '') +
                '<span class="task-tree-actions"><button class="task-action-btn" data-action="ai-action" data-path="' + escapeHtmlClient(docPath) + '" title="AI Actions">🤖</button></span>' +
            '</div>';
```

#### 2d. Handle `'ai-action'` click in `attachMillerEventListeners()`

In the `attachMillerEventListeners()` function (lines 456–483), add a new case **before** the folder navigation check (before line 462). The `data-action="ai-action"` button click must be intercepted before the `[data-file-path]` or `[data-nav-folder]` delegation would swallow it.

**Current code (lines 457–461):**
```typescript
    container.addEventListener('click', (e: Event) => {
        const wsId = taskPanelState.selectedWorkspaceId;
        if (!wsId) return;
        const target = e.target as HTMLElement;
```

**Insert after `const target = e.target as HTMLElement;` (line 460), before the folder navigation comment (line 462):**

```typescript
        // 0. AI action button — show dropdown
        const aiActionBtn = target.closest('[data-action="ai-action"]') as HTMLElement | null;
        if (aiActionBtn) {
            e.stopPropagation();
            const taskPath = aiActionBtn.getAttribute('data-path') || '';
            showAIActionDropdown(aiActionBtn, wsId, taskPath);
            return;
        }
```

**Why `e.stopPropagation()`:** Prevents the click from bubbling to the `[data-file-path]` handler which would open the file preview instead of showing the dropdown.

---

### 3. MODIFY `packages/coc/src/server/spa/client/index.ts`

Add `ai-actions` import after the existing `tasks` import (line 36).

**Current code (lines 35–36):**
```typescript
// 9. Tasks (workspace task CRUD, tree rendering)
import './tasks';
```

**New code:**
```typescript
// 9. Tasks (workspace task CRUD, tree rendering)
import './tasks';

// 10. AI Actions (dropdown for task AI operations)
import './ai-actions';
```

Also renumber the existing `// 10. WebSocket` comment to `// 11.`:

**Current (line 39):**
```typescript
// 10. WebSocket (calls connectWebSocket())
```

**New:**
```typescript
// 11. WebSocket (calls connectWebSocket())
```

---

### 4. MODIFY `packages/coc/src/server/spa/client/styles.css`

Append the following CSS block at the end of the file (after the `.task-preview-error` block):

```css
/* ================================================================
   AI Action Dropdown (positioned menu on 🤖 button click)
   ================================================================ */

.ai-action-dropdown {
    position: fixed;
    z-index: 300;
    min-width: 180px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
    display: flex;
    flex-direction: column;
}

html[data-theme="dark"] .ai-action-dropdown {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.ai-action-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background-color 0.12s;
}

.ai-action-menu-item:hover {
    background: var(--hover-bg);
}

.ai-action-menu-item:active {
    background: var(--active-bg);
}

.ai-action-menu-icon {
    flex-shrink: 0;
    font-size: 14px;
    width: 20px;
    text-align: center;
}

.ai-action-menu-label {
    flex: 1;
    white-space: nowrap;
}

/* Show AI action button on miller file row hover */
.miller-file-row .task-tree-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
    margin-left: auto;
}

.miller-file-row:hover .task-tree-actions {
    opacity: 1;
}
```

**CSS design notes:**
- `.ai-action-dropdown` uses `position: fixed` and `z-index: 300` (above the `enqueue-overlay` at `z-index: 200`) because it's appended to `document.body`.
- `.ai-action-menu-item` is a `<button>` element (not `<a>`) for accessibility; styled as a menu row with icon + label layout.
- `.miller-file-row .task-tree-actions` inherits the show-on-hover pattern from the existing `.task-tree-row:hover .task-tree-actions` rule (lines 1363–1365), adapted for the Miller row context.
- Dark theme shadow override provides stronger shadow for better contrast.

---

## HTML Structure Reference

The complete HTML structure of a Miller file row **after this change**:

```html
<div class="miller-row miller-file-row" data-file-path="feature/task1.plan.md">
    <span class="task-tree-icon">📄</span>
    <span class="miller-row-name">task1.plan</span>
    <span class="miller-status task-status-pending">○</span>
    <span class="task-tree-actions">
        <button class="task-action-btn"
                data-action="ai-action"
                data-path="feature/task1.plan.md"
                title="AI Actions">🤖</button>
    </span>
</div>
```

The dropdown (appended to `<body>`) when open:

```html
<div class="ai-action-dropdown"
     data-ws-id="abc123"
     data-task-path="feature/task1.plan.md"
     style="position:fixed; top:200px; left:400px;">
    <button class="ai-action-menu-item" data-ai-action="follow-prompt">
        <span class="ai-action-menu-icon">📝</span>
        <span class="ai-action-menu-label">Follow Prompt</span>
    </button>
    <button class="ai-action-menu-item" data-ai-action="update-document">
        <span class="ai-action-menu-icon">✏️</span>
        <span class="ai-action-menu-label">Update Document</span>
    </button>
</div>
```

---

## Build & Verification

1. **Build client bundle:**
   ```bash
   cd packages/coc && node scripts/build-client.mjs
   ```
   Verify `src/server/spa/client/dist/bundle.js` includes `ai-action-dropdown` class name and `showAIActionDropdown` function.

2. **Build CoC package:**
   ```bash
   cd packages/coc && npm run build
   ```

3. **Run tests:**
   ```bash
   cd packages/coc && npm run test:run
   ```
   No test changes expected — this is a pure UI addition with stub actions.

4. **Manual verification:**
   - `coc serve --no-open`, navigate to a workspace with tasks
   - Hover over a file row in the Miller columns → 🤖 button appears
   - Click 🤖 → dropdown appears positioned near button
   - Click "📝 Follow Prompt" → console logs stub action, dropdown closes
   - Click "✏️ Update Document" → console logs stub action, dropdown closes
   - Click outside dropdown → dropdown closes
   - Click a file row (not the button) → file preview opens as before (no regression)
   - Verify dropdown does not appear on folder rows (only on `miller-file-row` elements)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| 🤖 button click bubbles to `[data-file-path]` handler | `e.stopPropagation()` in the `ai-action` case prevents this |
| Dropdown clipped by `.miller-column { overflow: hidden }` | Dropdown appended to `document.body` with `position: fixed` |
| Multiple dropdowns open simultaneously | `showAIActionDropdown` calls `hideAIActionDropdown` first |
| Outside-click listener fires on the opening click itself | `requestAnimationFrame` defers listener registration by one frame |
| Dropdown overflows viewport edge | Position calculation checks right/bottom bounds and flips alignment |
