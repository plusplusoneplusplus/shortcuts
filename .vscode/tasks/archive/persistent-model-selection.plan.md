# Feature Plan: Persistent AI Model Selection in Task Creation Dialog

## Problem Statement

Currently, the AI Task Creation dialog always defaults to "claude-sonnet-4.5" regardless of what model the user selected previously. This forces users to repeatedly select their preferred model for each new task, creating unnecessary friction.

**Expected Behavior:**
- The dialog should remember the last model used
- On subsequent dialog opens, use the last-selected model as the default
- Persist across VS Code sessions

---

## Current Implementation Analysis

### Key Files
- **`ai-task-dialog.ts`** (line 92): Calls `getFollowPromptDefaultModel()` to get default model
- **`ai-config-helpers.ts`**: Contains `getFollowPromptDefaultModel()` function (returns static default)

### Current Flow
1. Dialog opens → calls `getFollowPromptDefaultModel()`
2. Returns hardcoded default (likely "claude-sonnet-4.5")
3. User selects different model → selection not persisted
4. Next dialog open → back to hardcoded default

---

## Proposed Solution

### Architecture: Use Workspace State (Memento)

Store the last-used model in VS Code's workspace state for automatic persistence.

**Data Structure:**
```typescript
interface AIModelPreferences {
  lastUsedModel: string;        // e.g., "gpt-5.1-codex"
  lastUpdated: string;          // ISO timestamp
}
```

**Storage Key:** `workspaceShortcuts.aiTask.lastUsedModel`

---

## Implementation Tasks

### [x] Phase 1: Add Persistence Layer

**File:** `src/shortcuts/ai-service/ai-config-helpers.ts`

1. **Add new functions:**
   ```typescript
   // Get last-used model from workspace state, fallback to config default
   export function getLastUsedAIModel(context: vscode.ExtensionContext): string

   // Save model selection to workspace state
   export function saveLastUsedAIModel(context: vscode.ExtensionContext, model: string): void
   ```

2. **Update `getFollowPromptDefaultModel()`:**
   - Accept optional `ExtensionContext` parameter
   - If context provided, check workspace state first
   - Fallback to configuration setting
   - Fallback to hardcoded "claude-sonnet-4.5"

### [x] Phase 2: Update Dialog Service

**File:** `src/shortcuts/tasks-viewer/ai-task-dialog.ts`

1. **Constructor changes:**
   - Add `private readonly context: vscode.ExtensionContext` parameter
   - Store for later use

2. **Update `createWebviewPanel()` (line 92):**
   ```typescript
   // OLD:
   const defaultModel = getFollowPromptDefaultModel();
   
   // NEW:
   const defaultModel = getLastUsedAIModel(this.context);
   ```

3. **Update message handler:**
   - When webview sends 'submit' message with model selection
   - Call `saveLastUsedAIModel(this.context, selectedModel)`
   - Save before resolving the dialog result

### [x] Phase 3: Update Initialization

**File:** `src/shortcuts/tasks-viewer/task-commands.ts` (or wherever AITaskDialogService is instantiated)

1. **Pass ExtensionContext to constructor:**
   ```typescript
   const dialogService = new AITaskDialogService(
     taskManager,
     extensionUri,
     context  // Add this parameter
   );
   ```

### [x] Phase 4: Testing

1. **Manual Testing:**
   - Open AI Task dialog
   - Select non-default model (e.g., "gpt-5.1-codex")
   - Submit task
   - Reopen dialog → verify selected model is default
   - Reload VS Code → verify persistence

2. **Unit Tests** (`src/test/suite/ai-task-dialog.test.ts`):
   - Test `getLastUsedAIModel()` with no saved state (returns fallback)
   - Test `saveLastUsedAIModel()` stores correctly
   - Test `getLastUsedAIModel()` retrieves saved model
   - Test fallback chain (workspace state → config → hardcoded)

---

## Edge Cases & Considerations

1. **Model Availability:**
   - What if saved model is no longer available? (e.g., deprecated)
   - **Solution:** Validate against `getAvailableModels()`, fallback if invalid

2. **Multi-Workspace:**
   - Should preference be global or per-workspace?
   - **Recommendation:** Per-workspace (current approach with workspace state)
   - Allows different defaults for different projects

3. **Configuration Setting:**
   - Keep `workspaceShortcuts.followPrompt.defaultModel` as ultimate fallback
   - Precedence: Workspace State > Config Setting > Hardcoded Default

4. **Backward Compatibility:**
   - No breaking changes
   - Users without saved preference get current behavior

---

## Files to Modify

| File | Changes |
|------|---------|
| `ai-config-helpers.ts` | Add `getLastUsedAIModel()`, `saveLastUsedAIModel()` functions |
| `ai-task-dialog.ts` | Accept context, use persisted model, save on submit |
| `task-commands.ts` (or initialization) | Pass context to dialog service |
| `ai-task-dialog.test.ts` | Add tests for persistence logic |

---

## Success Criteria

- [x] Dialog defaults to last-used model after first selection
- [x] Preference persists across VS Code reloads
- [x] Falls back gracefully if saved model unavailable
- [x] Existing tests pass
- [x] New unit tests cover persistence logic
- [x] No impact on other AI dialog features

---

## Implementation Notes

**Why Workspace State (Memento)?**
- ✅ Built-in VS Code API (no file I/O)
- ✅ Automatic persistence
- ✅ Per-workspace isolation
- ✅ Syncs with VS Code Settings Sync (if enabled)

**Alternative Considered:**
- Config file: More manual, requires I/O, harder to manage

**Risk Assessment:** Low
- Non-breaking change
- Self-contained feature
- Falls back gracefully
