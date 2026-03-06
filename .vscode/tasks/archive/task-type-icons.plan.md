# Plan: Task-Type-Specific Icons in CoC SPA Queue Tab

## Problem

In `RepoQueueTab.tsx`, the `QueueTaskItem` component shows one of only two icons regardless of task type:
- All **running** non-chat tasks → 🔄
- All **queued** non-chat tasks → ⏳

Because the UI already groups tasks under "RUNNING TASKS" and "QUEUED TASKS" section headers, these status-based icons add no informational value. The user wants **task-type-specific icons** so the icon visually signals _what kind of work_ each task represents.

## Scope

- **In scope:** Replace the icon derivation logic in `QueueTaskItem` (and the analogous logic in the history section of `RepoQueueTab.tsx`) with a `getTaskTypeIcon()` helper that maps task type + payload fields to a distinct emoji.
- **Out of scope:** Backend changes, data model changes, status/state indicators (running spinner, frozen tint), other tabs.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Only file that needs to change. Contains `QueueTaskItem` (line ~578) and history item icon logic (line ~479). |
| `packages/coc/src/server/queue-handler.ts` | Read-only reference: defines `VALID_TASK_TYPES`, `TYPE_LABELS`, and `generateDisplayName`. |
| `packages/coc/src/server/queue-executor-bridge.ts` | Read-only reference: confirms `payload.skillName` / `payload.skillNames` fields. |
| `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Read-only reference: confirms `displayName: 'Skill: ${selectedSkill}'` pattern and `payload.skillName`. |

## Task Type → Icon Mapping

| Condition (checked in order) | Icon | Rationale |
|------------------------------|------|-----------|
| `task.type === 'chat' \|\| task.type === 'readonly-chat'` | 💬 | Chat/conversation (unchanged) |
| `task.type === 'follow-prompt' && payload.skillName` | 🔧 | Skill execution (wrench = "uses a skill") |
| `task.type === 'follow-prompt' && payload.promptFilePath` | ↩️ | Follow-up from a prompt file |
| `task.type === 'follow-prompt'` (fallback) | 📝 | Generic follow prompt |
| `task.type === 'code-review'` | 🔍 | Code inspection |
| `task.type === 'resolve-comments'` | 💬 | Comment handling (distinct from chat via type) |
| `task.type === 'ai-clarification'` | 💡 | AI thinking / clarification |
| `task.type === 'run-pipeline'` | ▶️ | Pipeline execution |
| `task.type === 'custom'` or fallback | 🤖 | Generic AI task |

> **Note on frozen state:** Frozen tasks already get `opacity-60 italic` CSS; the ❄️ icon will be removed from the type-icon path. If preserving a frozen indicator is desired, it can be shown as a secondary badge — but the primary icon should remain type-based.

## Implementation Steps

### 1. Add `getTaskTypeIcon` helper in `RepoQueueTab.tsx`

Insert a pure function above `QueueTaskItem`:

```typescript
function getTaskTypeIcon(task: any): string {
    const type = task.type as string;
    const payload = task.payload || {};
    if (type === 'chat' || type === 'readonly-chat') return '💬';
    if (type === 'follow-prompt') {
        if (payload.skillName || (Array.isArray(payload.skillNames) && payload.skillNames.length)) return '🔧';
        if (payload.promptFilePath) return '↩️';
        return '📝';
    }
    if (type === 'code-review') return '🔍';
    if (type === 'resolve-comments') return '💬';
    if (type === 'ai-clarification') return '💡';
    if (type === 'run-pipeline') return '▶️';
    return '🤖';
}
```

### 2. Replace icon derivation in `QueueTaskItem` (line ~578)

**Before:**
```typescript
const icon = task.type === 'chat' ? '💬' : status === 'running' ? '🔄' : task.frozen ? '❄️' : '⏳';
```

**After:**
```typescript
const icon = getTaskTypeIcon(task);
```

### 3. Replace icon derivation in the history item render (line ~479)

Locate the analogous icon expression for completed/failed history items and similarly replace it with `getTaskTypeIcon(task)`, keeping ✅/❌ only for the _status overlay_ if one exists, not the primary icon.

## Acceptance Criteria

- [ ] "Skill: impl" tasks show 🔧
- [ ] "Follow: impl on …" tasks show ↩️ (prompt-file follow-up)
- [ ] "Chat" tasks still show 💬
- [ ] "Code Review" tasks show 🔍
- [ ] "Run Pipeline" tasks show ▶️
- [ ] Frozen tasks retain `opacity-60 italic` visual but no longer show ❄️ as primary icon
- [ ] History tab task icons are consistent with queue tab
- [ ] No TypeScript compiler errors; `npm run build` passes
