# Plan: Add "Last Used" Section to Follow Prompt Dialog

## Problem

The Follow Prompt dialog (CoC SPA) shows Model, Workspace, Prompts, and Skills sections. Users often re-use the same prompt/skill repeatedly, but must scroll through the full list each time. A "Last Used" section at the top would provide quick access to recently used items.

## Proposed Approach

Use the existing **preferences system** (`preferences.json` via `/api/preferences`) to persist an ordered list of recently-used prompt/skill entries. Display them in a new "Last Used" section at the top of the Follow Prompt dialog, before the Prompts and Skills sections.

### Why preferences-based (not queue-history-derived)?
- Fast: no need to fetch and filter potentially large queue history
- Reliable: survives queue history clearing
- Simple: reuses existing read/write preferences infrastructure
- Consistent: follows the same pattern as `lastModel` persistence

## Todos

### 1. Extend `UserPreferences` type (backend)
**File**: `packages/coc/src/server/preferences-handler.ts`
- Add `recentFollowPrompts` field to `UserPreferences` interface
- Each entry: `{ type: 'prompt' | 'skill', name: string, path?: string, description?: string, timestamp: number }`
- Update `validatePreferences()` to handle the new field (validate array, sanitize entries, cap at 10 items)
- No new routes needed — existing GET/PATCH `/api/preferences` handles it

### 2. Create `useRecentPrompts` hook (frontend)
**File**: `packages/coc/src/server/spa/client/react/hooks/useRecentPrompts.ts` (new)
- Reads `recentFollowPrompts` from preferences on mount
- Provides `trackUsage(type, name, path?, description?)` function that prepends to list, deduplicates by type+name, caps at 10, and PATCHes preferences
- Returns `{ recentItems, trackUsage, loaded }`

### 3. Update `FollowPromptDialog` component
**File**: `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx`
- Import and use `useRecentPrompts` hook
- Call `trackUsage()` inside `handleSubmit` before making the queue POST
- Render a "Last Used" section (same styling as Prompts/Skills) between the Workspace select and the Prompts section
- Each item shows its icon (📝 or ⚡) and name, clicking submits the same way as clicking a prompt/skill
- Section hidden when no recent items exist

### 4. Update `BulkFollowPromptDialog` component
**File**: `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx`
- Same pattern: import hook, track usage on submit, show "Last Used" section

### 5. Add tests
- **Backend**: Add validation tests for `recentFollowPrompts` in preferences-handler tests
- **Frontend**: Add tests for `useRecentPrompts` hook
- **Frontend**: Add tests for "Last Used" rendering in `FollowPromptDialog.test.tsx`

## Data Shape

```typescript
interface RecentFollowPromptEntry {
    type: 'prompt' | 'skill';
    name: string;
    path?: string;          // relativePath for prompts
    description?: string;   // description for skills
    timestamp: number;       // Date.now() of last use
}

interface UserPreferences {
    lastModel?: string;
    theme?: 'light' | 'dark' | 'auto';
    recentFollowPrompts?: RecentFollowPromptEntry[];  // max 10, newest first
}
```

## Notes

- The "Last Used" section should only appear when there are recent items (graceful empty state)
- Items that no longer exist in the workspace (prompt deleted, skill removed) still show; they'll fail at queue time with a clear error — this avoids expensive cross-checking on dialog open
- Cap at 10 recent items to keep the section concise
- Deduplication key: `type + name` (not path, since paths can change)
