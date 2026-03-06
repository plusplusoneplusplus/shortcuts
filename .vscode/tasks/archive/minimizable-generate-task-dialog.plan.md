# Minimizable Generate Task Dialog

## Problem

The "Generate Task" dialog (`AITaskDialogService`) is a VS Code WebviewPanel that acts as a modal-style form. When the user closes it (Cancel, X, or Escape), the panel is **disposed** and all form content is lost. There is no way to temporarily dismiss the dialog to reference other files or do other work, then come back to it.

Key issues in current design:
- `retainContextWhenHidden: false` — webview content is destroyed when the tab is hidden
- Panel disposal on Cancel/Close resolves the pending promise with `cancelled: true`
- `showDialog()` returns `{ cancelled: true }` if the panel already exists, making re-reveal useless
- No form state persistence — all user input (prompt, name, folder selection, model, etc.) is lost

## Proposed Approach

**Strategy:** Use VS Code's native tab behavior — the webview panel is already a tab that can be backgrounded. Make it survive being hidden and support re-reveal with a working promise chain.

### Changes

#### 1. Enable `retainContextWhenHidden: true` (`ai-task-dialog.ts`)
- Change `retainContextWhenHidden` from `false` to `true` in `createWebviewPanel()`
- This preserves the webview DOM (and all form state) when the user switches to another tab

#### 2. Replace "Cancel" button with "Minimize" + "Cancel" (`ai-task-dialog.ts`)
- Rename the current "Cancel" button to "Close" (keeps current dispose behavior)
- Add a **"Minimize"** button (or icon) that sends a `minimize` message type
- The minimize handler should call `this.currentPanel.reveal()` → no, it should **hide** the panel. VS Code doesn't have a native `hide()` API, but we can use `vscode.commands.executeCommand('workbench.action.closeActiveEditor')` — **however**, this disposes the panel.
- **Better approach:** The "Minimize" action posts a message; the extension calls `vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup')` or simply relies on the user switching tabs. We add a status bar item or tree view indicator that the dialog is open and can be resumed.
- **Simplest approach:** Add a "Minimize" button that hides the dialog by moving focus away (`workbench.action.focusPreviousGroup` or revealing the explorer). The panel stays open as a tab. A status bar item shows "Generate Task ●" that re-reveals the panel on click.

#### 3. Fix `showDialog()` re-reveal logic (`ai-task-dialog.ts`)
Current code when panel exists:
```typescript
if (this.currentPanel) {
    this.currentPanel.reveal(vscode.ViewColumn.Active);
    return { cancelled: true, options: null };  // ← BUG: returns cancelled
}
```
Change to: when panel already exists, reveal it and return a **new promise** that will resolve when the user eventually submits or cancels:
```typescript
if (this.currentPanel) {
    this.currentPanel.reveal(vscode.ViewColumn.Active);
    return new Promise<AITaskDialogResult>((resolve) => {
        this.pendingResolve = resolve;
    });
}
```

#### 4. Add "Minimize" message handler (`ai-task-dialog.ts`)
```typescript
case 'minimize':
    // Move focus away from the dialog without disposing it
    vscode.commands.executeCommand('workbench.action.focusSideBar');
    break;
```
The pending promise remains unresolved, so the caller (`createTaskWithAIDialog`) stays awaiting.

#### 5. Add status bar indicator (`ai-task-dialog.ts` or new file)
- When the panel is created, show a status bar item: `$(edit) Generate Task`
- On click: `this.currentPanel.reveal()`
- When the panel is disposed: hide the status bar item
- This gives users a clear affordance to resume the minimized dialog

#### 6. Update keyboard shortcuts (`ai-task-dialog.ts` webview JS)
- **Escape:** Change from cancel/dispose to minimize (move focus away)
- **Shift+Escape** or explicit "Close" button: Cancel and dispose (current behavior)
- **Ctrl+Enter:** Submit (unchanged)

#### 7. Update `createTaskWithAIDialog` caller (`ai-task-commands.ts`)
- The current flow is: `const dialogResult = await dialogService.showDialog(...)` → blocks until resolved
- With minimize, the promise just stays pending longer — no change needed to the caller
- If `showDialog()` is called again while minimized, the panel is re-revealed (change in step 3)

### UI Layout Change (footer buttons)

**Before:**
```
[Cancel]  [Create Task]
```

**After:**
```
[Minimize]  [Close]  [Create Task]
```

Or alternatively with icons:
```
[↓ Minimize]  [✕ Close]  [Create Task]
```

## Files to Modify

| File | Change |
|------|--------|
| `src/shortcuts/tasks-viewer/ai-task-dialog.ts` | `retainContextWhenHidden: true`, add minimize handler, fix re-reveal logic, add status bar item, update HTML buttons |
| `src/shortcuts/tasks-viewer/ai-task-commands.ts` | No changes needed (promise-based flow naturally supports minimize) |

## Edge Cases

- **Multiple command invocations:** If user triggers "Create with AI" while dialog is minimized, should reveal existing dialog (not create a new one). The fixed `showDialog()` handles this.
- **Extension deactivation:** Panel disposal fires, promise resolves with `cancelled: true`. No leak.
- **Tab drag/move:** `retainContextWhenHidden` preserves state across tab moves.
- **Images pasted in prompt:** Retained in DOM since `retainContextWhenHidden: true`.

## Testing

- Verify form content (prompt text, selections, pasted images) survives tab switch
- Verify "Minimize" button moves focus away without disposing panel
- Verify status bar item appears/disappears with dialog lifecycle
- Verify re-invoking command reveals existing dialog instead of creating new one
- Verify "Close" still properly disposes and resolves with cancelled
- Verify Escape minimizes, Shift+Escape closes
- Verify Ctrl+Enter still submits
