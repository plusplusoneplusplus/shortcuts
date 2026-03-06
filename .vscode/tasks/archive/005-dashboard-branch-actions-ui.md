---
status: done
---

# 005: Dashboard UI — Branch Actions & Operations

## Summary

Add interactive branch operations to the SPA dashboard's git-branches page: create, switch, delete, rename, push, pull, fetch, merge, stash, and pop stash. This commit introduces modals, confirmation dialogs, action buttons, toast notifications, and loading states — making the branch management page fully functional after commit 4 laid the read-only foundation.

## Motivation

Commit 4 added the read-only branch list page (table, pagination, search, status banner). This commit wires every available API endpoint (commits 1–3) to UI affordances. The work is separated because interactive operations require substantially more client complexity: form validation, modal lifecycle, per-button loading/disabled states, error surfacing, and auto-refresh coordination after mutations.

## Changes

### Files to Modify

- `packages/coc-server/src/wiki/spa/html-template.ts` — Add modal HTML markup and action button markup.
- `packages/coc-server/src/wiki/spa/client/git-branches.ts` — Add all action handler functions, modal lifecycle, toast system, and loading state management.

### Files to Delete

- (none)

## Implementation Notes

### CSS & Patterns Discovery

Audit of `admin.ts` and `html-template.ts` reveals:

- **No modal/overlay system exists** — must be created from scratch.
- **Button classes:** `admin-btn admin-btn-save` (primary), `admin-btn admin-btn-reset` (secondary). Danger variant (`admin-btn-danger`) will be new.
- **Show/hide:** Universal pattern is `el.classList.add('hidden')` / `el.classList.remove('hidden')`. Use this for modals and toasts.
- **Inline status:** `admin-file-status`, `admin-file-status error`, `admin-file-status success` — existing feedback mechanism; toasts extend this pattern.
- **Async submit pattern:** `fetch()` → check `data.success` → inline status message. All new action handlers follow the same shape.

---

### HTML Template Changes (`html-template.ts`)

Add to the git-branches page section, after the existing status banner and branch table markup from commit 4.

#### 1. Modal overlay + container (shared by all dialogs)

```html
<div id="git-branch-modal-overlay" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
  <div id="git-branch-modal-container" style="background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--vscode-panel-border,#555);border-radius:6px;padding:24px;min-width:320px;max-width:480px;width:100%;">
    <!-- dialog content swapped by JS -->
  </div>
</div>
```

Only one modal is open at a time; all dialogs render inside `#git-branch-modal-container`.

#### 2. Dialog inner templates (hidden `<template>` elements or hidden `<div>` blocks)

**Create Branch dialog** (`id="git-branch-dialog-create"`):
```html
<div id="git-branch-dialog-create" class="hidden">
  <h3 class="modal-title">Create Branch</h3>
  <label>Branch name<input id="git-branch-create-name" type="text" class="admin-input" placeholder="feature/my-branch" /></label>
  <label><input id="git-branch-create-checkout" type="checkbox" checked /> Switch to branch after creating</label>
  <div class="admin-actions">
    <button id="git-branch-create-submit" class="admin-btn admin-btn-save">Create</button>
    <button id="git-branch-create-cancel" class="admin-btn admin-btn-reset">Cancel</button>
  </div>
  <div id="git-branch-create-status" class="admin-file-status"></div>
</div>
```

**Rename Branch dialog** (`id="git-branch-dialog-rename"`):
```html
<div id="git-branch-dialog-rename" class="hidden">
  <h3 class="modal-title">Rename Branch</h3>
  <p>Renaming: <strong id="git-branch-rename-old"></strong></p>
  <label>New name<input id="git-branch-rename-new" type="text" class="admin-input" /></label>
  <div class="admin-actions">
    <button id="git-branch-rename-submit" class="admin-btn admin-btn-save">Rename</button>
    <button id="git-branch-rename-cancel" class="admin-btn admin-btn-reset">Cancel</button>
  </div>
  <div id="git-branch-rename-status" class="admin-file-status"></div>
</div>
```

**Delete Branch confirmation dialog** (`id="git-branch-dialog-delete"`):
```html
<div id="git-branch-dialog-delete" class="hidden">
  <h3 class="modal-title">Delete Branch</h3>
  <p>Delete branch <strong id="git-branch-delete-name"></strong>?</p>
  <label><input id="git-branch-delete-force" type="checkbox" /> Force delete (even if unmerged)</label>
  <div class="admin-actions">
    <button id="git-branch-delete-confirm" class="admin-btn admin-btn-danger">Delete</button>
    <button id="git-branch-delete-cancel" class="admin-btn admin-btn-reset">Cancel</button>
  </div>
  <div id="git-branch-delete-status" class="admin-file-status"></div>
</div>
```

**Merge Branch dialog** (`id="git-branch-dialog-merge"`):
```html
<div id="git-branch-dialog-merge" class="hidden">
  <h3 class="modal-title">Merge Branch into Current</h3>
  <label>Branch to merge<input id="git-branch-merge-source" type="text" class="admin-input" placeholder="feature/branch-name" /></label>
  <div class="admin-actions">
    <button id="git-branch-merge-submit" class="admin-btn admin-btn-save">Merge</button>
    <button id="git-branch-merge-cancel" class="admin-btn admin-btn-reset">Cancel</button>
  </div>
  <div id="git-branch-merge-status" class="admin-file-status"></div>
</div>
```

#### 3. Page-level action buttons (in the branches page header)

Add a button toolbar between the page title and the search/table area:

```html
<div id="git-branch-actions" class="admin-actions" style="flex-wrap:wrap;gap:8px;margin-bottom:12px;">
  <button id="git-branch-btn-create"  class="admin-btn admin-btn-save">Create Branch</button>
  <button id="git-branch-btn-push"    class="admin-btn admin-btn-reset">Push</button>
  <button id="git-branch-btn-pull"    class="admin-btn admin-btn-reset">Pull</button>
  <button id="git-branch-btn-fetch"   class="admin-btn admin-btn-reset">Fetch</button>
  <button id="git-branch-btn-stash"   class="admin-btn admin-btn-reset">Stash</button>
  <button id="git-branch-btn-pop"     class="admin-btn admin-btn-reset">Pop Stash</button>
  <button id="git-branch-btn-merge"   class="admin-btn admin-btn-reset">Merge…</button>
</div>
```

#### 4. Toast notification container

Add a fixed-position toast area (top-right corner) just before `</body>`:

```html
<div id="git-toast-container" style="position:fixed;top:16px;right:16px;z-index:2000;display:flex;flex-direction:column;gap:8px;"></div>
```

Individual toasts are created dynamically by JS; no static HTML needed.

#### 5. Per-branch-row action buttons

The branch table rendered by `git-branches.ts` (commit 4) builds rows dynamically. Add an "Actions" column with buttons per row. Each row's action cell contains:

```html
<td class="branch-row-actions">
  <button class="admin-btn admin-btn-save branch-action-switch"  data-branch="NAME" title="Switch">Switch</button>
  <button class="admin-btn admin-btn-reset branch-action-rename" data-branch="NAME" title="Rename">Rename</button>
  <button class="admin-btn admin-btn-danger branch-action-delete" data-branch="NAME" title="Delete">Delete</button>
</td>
```

The "Switch" button is hidden (or replaced by a "Current" badge) when `data-branch` matches the current branch. The "Delete" button is disabled for the current branch.

---

### Client Module Changes (`git-branches.ts`)

All handlers follow the existing `admin.ts` async-fetch pattern. Prefix all element IDs with `git-branch-` to avoid conflicts.

#### Modal lifecycle

```typescript
function showDialog(dialogId: string): void {
    // Hide all dialog divs, show the requested one
    document.querySelectorAll('[id^="git-branch-dialog-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById(dialogId)?.classList.remove('hidden');
    // Move it into the modal container, show overlay
    const container = document.getElementById('git-branch-modal-container')!;
    const dialog = document.getElementById(dialogId)!;
    container.appendChild(dialog);
    document.getElementById('git-branch-modal-overlay')!.classList.remove('hidden');
}

function hideDialog(): void {
    document.getElementById('git-branch-modal-overlay')!.classList.add('hidden');
    // Clear status messages inside the dialog
    document.querySelectorAll('[id$="-status"]').forEach((el: Element) => {
        (el as HTMLElement).textContent = '';
        el.className = 'admin-file-status';
    });
}
```

Close on overlay backdrop click:
```typescript
document.getElementById('git-branch-modal-overlay')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideDialog();
});
```

#### Toast system

```typescript
function showToast(message: string, type: 'success' | 'error'): void {
    const container = document.getElementById('git-toast-container')!;
    const toast = document.createElement('div');
    toast.style.cssText = `padding:10px 16px;border-radius:4px;color:#fff;max-width:360px;word-break:break-word;cursor:pointer;` +
        (type === 'error' ? 'background:#c0392b;' : 'background:#27ae60;');
    toast.textContent = message;
    container.appendChild(toast);

    // Success: auto-dismiss after 4s. Error: dismiss on click only.
    if (type === 'success') {
        setTimeout(() => toast.remove(), 4000);
    }
    toast.addEventListener('click', () => toast.remove());
}
```

#### Loading state helpers

```typescript
function setLoading(btn: HTMLButtonElement, loading: boolean): void {
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText ?? btn.textContent ?? '';
    btn.textContent = loading ? '…' : btn.dataset.originalText;
}

// Disable all page-level action buttons during an operation
function setPageActionsLoading(loading: boolean): void {
    document.querySelectorAll('#git-branch-actions button').forEach(el =>
        setLoading(el as HTMLButtonElement, loading));
}
```

#### `handleCreateBranch()`

```typescript
async function handleCreateBranch(): Promise<void> {
    showDialog('git-branch-dialog-create');
    (document.getElementById('git-branch-create-name') as HTMLInputElement).value = '';

    const submitBtn = document.getElementById('git-branch-create-submit') as HTMLButtonElement;
    submitBtn.onclick = async () => {
        const name = (document.getElementById('git-branch-create-name') as HTMLInputElement).value.trim();
        const checkout = (document.getElementById('git-branch-create-checkout') as HTMLInputElement).checked;
        if (!name) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(`${apiBase}/git/branches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, checkout }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast(`Branch "${name}" created`, 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-create-status', data.error || 'Failed to create branch', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-create-status', `Error: ${err.message}`, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-create-cancel')!.onclick = hideDialog;
}
```

#### `handleSwitchBranch(name: string)`

```typescript
async function handleSwitchBranch(name: string): Promise<void> {
    setPageActionsLoading(true);
    try {
        const res = await fetch(`${apiBase}/git/branches/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Switched to "${name}"`, 'success');
            await refreshAll();
        } else {
            showToast(data.error || 'Switch failed', 'error');
        }
    } catch (err: any) {
        showToast(`Error: ${err.message}`, 'error');
    } finally {
        setPageActionsLoading(false);
    }
}
```

#### `handleDeleteBranch(name: string)`

```typescript
async function handleDeleteBranch(name: string): Promise<void> {
    (document.getElementById('git-branch-delete-name') as HTMLElement).textContent = name;
    (document.getElementById('git-branch-delete-force') as HTMLInputElement).checked = false;
    showDialog('git-branch-dialog-delete');

    const confirmBtn = document.getElementById('git-branch-delete-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
        const force = (document.getElementById('git-branch-delete-force') as HTMLInputElement).checked;
        setLoading(confirmBtn, true);
        try {
            const url = `${apiBase}/git/branches/${encodeURIComponent(name)}${force ? '?force=true' : ''}`;
            const res = await fetch(url, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast(`Branch "${name}" deleted`, 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-delete-status', data.error || 'Delete failed', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-delete-status', `Error: ${err.message}`, true);
        } finally {
            setLoading(confirmBtn, false);
        }
    };
    document.getElementById('git-branch-delete-cancel')!.onclick = hideDialog;
}
```

#### `handleRenameBranch(name: string)`

```typescript
async function handleRenameBranch(name: string): Promise<void> {
    (document.getElementById('git-branch-rename-old') as HTMLElement).textContent = name;
    (document.getElementById('git-branch-rename-new') as HTMLInputElement).value = name;
    showDialog('git-branch-dialog-rename');

    const submitBtn = document.getElementById('git-branch-rename-submit') as HTMLButtonElement;
    submitBtn.onclick = async () => {
        const newName = (document.getElementById('git-branch-rename-new') as HTMLInputElement).value.trim();
        if (!newName || newName === name) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(`${apiBase}/git/branches/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName: name, newName }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast(`Renamed to "${newName}"`, 'success');
                await refreshAll();
            } else {
                setDialogStatus('git-branch-rename-status', data.error || 'Rename failed', true);
            }
        } catch (err: any) {
            setDialogStatus('git-branch-rename-status', `Error: ${err.message}`, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-rename-cancel')!.onclick = hideDialog;
}
```

#### `handleMergeBranch()`

Merge conflicts need prominent display (not just a toast). Use the dialog's status div with full error text.

```typescript
async function handleMergeBranch(): Promise<void> {
    (document.getElementById('git-branch-merge-source') as HTMLInputElement).value = '';
    showDialog('git-branch-dialog-merge');

    const submitBtn = document.getElementById('git-branch-merge-submit') as HTMLButtonElement;
    submitBtn.onclick = async () => {
        const source = (document.getElementById('git-branch-merge-source') as HTMLInputElement).value.trim();
        if (!source) return;
        setLoading(submitBtn, true);
        try {
            const res = await fetch(`${apiBase}/git/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch: source }),
            });
            const data = await res.json();
            if (data.success) {
                hideDialog();
                showToast(`Merged "${source}" into current branch`, 'success');
                await refreshAll();
            } else {
                // Conflict errors stay visible in the dialog (not auto-dismissed)
                const msg = data.error || 'Merge failed';
                setDialogStatus('git-branch-merge-status', msg, true);
                // Also refresh — the repo may be in a conflicted state the status banner should reflect
                await refreshAll();
            }
        } catch (err: any) {
            setDialogStatus('git-branch-merge-status', `Error: ${err.message}`, true);
        } finally {
            setLoading(submitBtn, false);
        }
    };
    document.getElementById('git-branch-merge-cancel')!.onclick = hideDialog;
}
```

#### Remote operation handlers (Push / Pull / Fetch)

All three follow the same shape. Push example:

```typescript
async function handlePush(): Promise<void> {
    const btn = document.getElementById('git-branch-btn-push') as HTMLButtonElement;
    setLoading(btn, true);
    try {
        const res = await fetch(`${apiBase}/git/push`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Push successful', 'success');
        } else {
            showToast(data.error || 'Push failed', 'error');
        }
    } catch (err: any) {
        showToast(`Error: ${err.message}`, 'error');
    } finally {
        setLoading(btn, false);
    }
}
```

Pull additionally calls `refreshAll()` on success (remote changes may affect the local branch list).
Fetch additionally calls `refreshBranchList()` on success (remote branch list may change).

#### Stash handlers

```typescript
async function handleStash(): Promise<void> { /* POST /git/stash, refreshStatus() on success */ }
async function handlePopStash(): Promise<void> { /* POST /git/stash/pop, refreshStatus() on success */ }
```

#### Refresh helpers

```typescript
// Thin wrappers that call commit 4's data-loading functions with current state
function refreshBranchList(): Promise<void> {
    return loadBranches(currentType, currentLimit, currentOffset, currentSearch);
}

function refreshStatus(): Promise<void> {
    return loadBranchStatus();
}

// Refresh both branch list and status banner
async function refreshAll(): Promise<void> {
    await Promise.all([refreshBranchList(), refreshStatus()]);
}
```

`refreshBranchList()` and `refreshStatus()` are new thin wrappers defined in this commit that delegate to `loadBranches()` and `loadBranchStatus()` from commit 4, using the module-level `currentType`, `currentLimit`, `currentOffset`, `currentSearch` state variables.

#### `setDialogStatus(id, message, isError)` helper

```typescript
function setDialogStatus(statusId: string, message: string, isError: boolean): void {
    const el = document.getElementById(statusId)!;
    el.textContent = message;
    el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
}
```

#### Row action wiring

After the branch table is rendered (in the existing `renderBranchTable()` function from commit 4), wire up per-row buttons using event delegation:

```typescript
document.getElementById('git-branches-table-container')!.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('button[data-branch]') as HTMLButtonElement | null;
    if (!btn) return;
    const branchName = btn.dataset.branch!;
    if (btn.classList.contains('branch-action-switch')) await handleSwitchBranch(branchName);
    if (btn.classList.contains('branch-action-rename')) await handleRenameBranch(branchName);
    if (btn.classList.contains('branch-action-delete')) await handleDeleteBranch(branchName);
});
```

#### Wiring page-level buttons (call in `initGitBranchesPage()`)

```typescript
document.getElementById('git-branch-btn-create')!.addEventListener('click', handleCreateBranch);
document.getElementById('git-branch-btn-push')!.addEventListener('click', handlePush);
document.getElementById('git-branch-btn-pull')!.addEventListener('click', handlePull);
document.getElementById('git-branch-btn-fetch')!.addEventListener('click', handleFetch);
document.getElementById('git-branch-btn-stash')!.addEventListener('click', handleStash);
document.getElementById('git-branch-btn-pop')!.addEventListener('click', handlePopStash);
document.getElementById('git-branch-btn-merge')!.addEventListener('click', handleMergeBranch);
```

#### New CSS to add (inline in `html-template.ts` `<style>` block)

```css
.admin-btn-danger {
    background: #c0392b;
    color: #fff;
    border: 1px solid #922b21;
}
.admin-btn-danger:hover { background: #922b21; }

.modal-title { margin: 0 0 16px; font-size: 1.1em; }

.admin-input {
    display: block;
    width: 100%;
    margin: 6px 0 12px;
    padding: 6px 8px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 3px;
    font-size: 13px;
    box-sizing: border-box;
}

.branch-row-actions { white-space: nowrap; }
.branch-row-actions .admin-btn { padding: 2px 8px; font-size: 12px; margin-right: 4px; }
```

---

### Current Branch Guards

When rendering each row, check `branch.name === currentBranch`:
- If true: hide the "Switch" button (replace with a "✓ Current" badge), disable the "Delete" button with `disabled` attribute and title `"Cannot delete current branch"`.

---

### Error surfacing strategy

| Scenario | Display |
|---|---|
| Success | Auto-dismissing green toast (4 s) |
| Non-conflict error (push/pull/stash) | Persistent red toast (click to dismiss) |
| Merge conflict | Error text in merge dialog status div (stays visible until user closes) |
| Network failure (fetch throws) | Persistent red toast |
| Dialog form validation | Inline dialog status div |

---

## Tests

Client-side unit tests are out of scope for SPA modules. Validation is:

1. **Build check:** `npm run build` must succeed with no TypeScript errors.
2. **HTML structure check:** Manually verify all `id` attributes referenced in `git-branches.ts` are present in `html-template.ts`.
3. **Visual testing:** Load the dashboard, navigate to the git-branches page, exercise each button.
4. **API integration tests** from commits 1–3 cover the actual backend operations.

Verify the module compiles in isolation:
```bash
cd packages/coc-server && npx tsc --noEmit
```

## Acceptance Criteria

- [ ] "Create Branch" button opens dialog; creates branch on submit; refreshes list
- [ ] Clicking "Switch" on a branch row switches to it; status banner updates
- [ ] "Delete" action shows confirmation dialog; deletes branch on confirm; refreshes list
- [ ] "Delete" button is disabled for the current branch
- [ ] "Rename" action opens dialog with branch name pre-filled; renames on submit; refreshes list
- [ ] Push/Pull/Fetch buttons trigger the correct API calls and show success/error toasts
- [ ] Pull refreshes branch list after success
- [ ] Fetch refreshes remote branches after success
- [ ] "Merge…" dialog opens; on success shows toast and refreshes; on conflict shows error in dialog
- [ ] Stash and Pop Stash buttons work; status refreshes after each
- [ ] Loading states (disabled buttons, `…` text) active during in-flight requests
- [ ] Error messages: toast for non-critical, inline dialog for merge conflicts
- [ ] Branch list and status banner auto-refresh after every mutation
- [ ] Toast auto-dismisses after 4 s for success; persists for errors until clicked
- [ ] `npm run build` succeeds with no type errors

## Dependencies

- Depends on: commit 4 (git-branches page with read-only branch list, pagination, search, status banner)
- Depends on: commits 1–3 (all git API endpoints: branches CRUD, switch, rename, merge, push, pull, fetch, stash)

## Assumed Prior State

The git-branches SPA page exists with:
- A branch table rendered by `renderBranchTable()` in `git-branches.ts`
- A status banner showing the current branch
- `loadBranches(type, limit, offset, search)` and `loadBranchStatus()` functions defined (commit 005 should add thin wrappers `refreshBranchList()` and `refreshStatus()` that call these with current state)
- `apiBase` variable constructed from `config.workspaceId` (e.g., `'/api/workspaces/' + encodeURIComponent(config.workspaceId)`)
- Branch table is rendered dynamically inside `#git-branches-table-container` — use event delegation on that container for row action buttons
- All git operation endpoints registered in `api-handler.ts`
