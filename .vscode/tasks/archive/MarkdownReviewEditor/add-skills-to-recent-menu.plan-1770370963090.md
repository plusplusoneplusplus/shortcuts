# Add Skills Support to Recent Menu

## Problem Statement

The "Follow Prompt → Recent" submenu in the AI Action dropdown currently only supports recently used prompt files. Users should also see recently used skills in the Recent section for quick access.

## Current Behavior

- **Recent section** shows up to 3 recently used `.prompt.md` files
- Skills appear in a separate section below prompts (under "🎯 Skills" header)
- Only prompts are tracked in workspace state (`workspaceShortcuts.recentPrompts` key)
- When a skill is executed via `executeWorkPlanWithSkill`, its usage is not tracked

## Proposed Approach

Add skill usage tracking and display recently used skills alongside prompts in the Recent section.

### Design Options

**Option A: Unified Recent List (Recommended)**
- Combine prompts and skills in a single recent list
- Differentiate by icon: 📝 for prompts, 🎯 for skills
- Store both in a unified type with a `type` discriminator

**Option B: Separate Recent Lists**
- Keep separate storage for recent prompts and recent skills
- Show two sections in Recent: "Recent Prompts" and "Recent Skills"

I recommend **Option A** for better UX - users see all their recent items together, sorted by recency.

---

## Work Plan

### Phase 1: Backend - Skill Usage Tracking

- [x] 1.1 Add `RecentItem` type to support both prompts and skills
  - File: `src/shortcuts/markdown-comments/webview-scripts/types.ts`
  - Add `RecentItem` type with `type: 'prompt' | 'skill'` discriminator
  - Keep backward compatibility with existing `RecentPrompt` type

- [x] 1.2 Create skill tracking method in `ReviewEditorViewProvider`
  - File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
  - Add `trackSkillUsage(skillName: string)` method
  - Add separate storage key `RECENT_SKILLS_KEY` or update to unified storage
  - Track skill usage when `executeWorkPlanWithSkill` is handled

- [x] 1.3 Update `handleRequestPromptFiles` to include recent skills
  - File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
  - Merge recent prompts and recent skills
  - Sort by `lastUsed` timestamp
  - Return unified list to webview

### Phase 2: Frontend - Display Skills in Recent Menu

- [x] 2.1 Update `ExtensionMessage` type to support unified recent items
  - File: `src/shortcuts/markdown-comments/webview-scripts/types.ts`
  - Update `promptFilesResponse` message type

- [x] 2.2 Update `updateExecuteWorkPlanSubmenu` to handle skill recent items
  - File: `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts`
  - Display skills in Recent section with 🎯 icon
  - Click handler should call `requestExecuteWorkPlanWithSkill` for skills

- [x] 2.3 Validate skill items in Recent against available skills
  - Similar to how prompts are filtered: `validRecent = recentItems.filter(...)`
  - Skills must exist in the `skills` array to be shown

### Phase 3: Testing

- [x] 3.1 Add unit tests for skill tracking
  - Test `trackSkillUsage` method
  - Test merged recent list sorting

- [x] 3.2 Add integration tests for Recent menu with skills
  - Test that clicking a skill in Recent triggers correct handler
  - Test that invalid skills are filtered out

---

## Technical Details

### Type Changes

```typescript
// New unified type
export interface RecentItem {
    type: 'prompt' | 'skill';
    /** For prompts: absolute file path; for skills: skill name */
    identifier: string;
    /** Display name */
    name: string;
    /** Relative path (prompts only) */
    relativePath?: string;
    /** Timestamp when last used */
    lastUsed: number;
}
```

### Storage Key Options

1. **New unified key**: `workspaceShortcuts.recentItems`
2. **Separate skill key**: `workspaceShortcuts.recentSkills`

If using unified key, need migration from existing `recentPrompts` key.

### Files to Modify

1. `src/shortcuts/markdown-comments/webview-scripts/types.ts` - Types
2. `src/shortcuts/markdown-comments/review-editor-view-provider.ts` - Backend tracking
3. `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` - Frontend display
4. `src/test/suite/prompt-recent-search.test.ts` - Tests (if exists)

---

## Notes

- Keep backward compatibility with existing `RecentPrompt` data
- Skills use name as identifier (not path) since they're discovered by name
- Max combined recent items: 5 (configurable via `MAX_RECENT_PROMPTS`)
