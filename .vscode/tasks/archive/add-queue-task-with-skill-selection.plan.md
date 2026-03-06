# Add Queue Task Capability with Skill Selection

## Problem

The Queue tab in the CoC dashboard (`RepoQueueTab`) has no direct way to create/enqueue a new task. The global `EnqueueDialog` (triggered via `+ Enqueue` button in `ProcessesSidebar`) only supports freeform prompts without skill selection. Users need a way to queue tasks directly from the repo's Queue tab, with the ability to select a skill from the workspace's `.github/skills/` directory.

## Proposed Approach

Enhance the `EnqueueDialog` to support skill selection, and add a "+ Queue Task" button to the `RepoQueueTab` header. When a workspace is selected, the dialog fetches available skills from the existing `GET /api/workspaces/:id/skills` endpoint and displays them as selectable options. The selected skill modifies the queued task type and payload accordingly.

## Existing Infrastructure

| Component | File | Notes |
|-----------|------|-------|
| `EnqueueDialog` | `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Current freeform prompt dialog |
| `FollowPromptDialog` | `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx` | Already fetches skills via `/workspaces/:id/skills`, shows skill list with ⚡ icons |
| Skills API endpoint | `packages/coc/src/server/prompt-handler.ts` | `GET /api/workspaces/:id/skills` — returns `{ skills: SkillInfo[] }` |
| `QueueContext` | `packages/coc/src/server/spa/client/react/context/QueueContext.tsx` | Manages `OPEN_DIALOG` / `CLOSE_DIALOG` actions, `showDialog` state |
| `RepoQueueTab` | `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Workspace-scoped queue view, no enqueue button currently |
| Queue handler | `packages/coc/src/server/queue-handler.ts` | `POST /api/queue/enqueue` (legacy), `POST /api/queue/tasks` (follow-prompt with `skillName` payload) |

## Key Design Decisions

1. **Enhance `EnqueueDialog`** rather than creating a new dialog — keeps the codebase simple; the dialog already has model/workspace/folder selection
2. **Skill is optional** — users can still queue freeform prompts without selecting a skill
3. **When a skill is selected**, the task type becomes `follow-prompt` with `skillName` in the payload (matching the existing `FollowPromptDialog` contract)
4. **When no skill is selected**, behavior is unchanged — task type remains `chat` with freeform prompt
5. **Add entry point in `RepoQueueTab`** header — a "+ Queue Task" button that opens the dialog pre-scoped to the current workspace

## Tasks

### 1. Add "+ Queue Task" button to `RepoQueueTab` ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- Add a `Button` next to the filter dropdown and pause/resume button in the Queue tab header
- On click, dispatch `OPEN_DIALOG` with the current `workspaceId` pre-filled
- This requires extending the `OPEN_DIALOG` action to accept an optional `workspaceId` parameter

### 2. Extend `QueueContext` to support pre-filling workspace ✅

**File:** `packages/coc/src/server/spa/client/react/context/QueueContext.tsx`

- Add `dialogInitialWorkspaceId?: string` to the `OPEN_DIALOG` action type
- Store it in queue state so `EnqueueDialog` can read it as initial workspace selection
- On `CLOSE_DIALOG`, clear the initial workspace id

### 3. Add skill selection to `EnqueueDialog` ✅

**File:** `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx`

Changes:
- Add `skills` state and fetch skills from `GET /api/workspaces/:id/skills` when `workspaceId` changes (similar to how folders are fetched)
- Add a "Skill" dropdown/selector below the prompt field:
  - First option: "None" (freeform prompt, current behavior)
  - Remaining options: skills from the workspace, showing `name` and `description`
- Read `dialogInitialWorkspaceId` from queue state to pre-select workspace
- When a skill is selected:
  - The prompt textarea becomes optional (pre-filled with `"Use the {skillName} skill."` but editable)
  - Submit uses `POST /api/queue/tasks` with type `follow-prompt` and `skillName` in payload
- When no skill is selected:
  - Existing behavior — submit to `POST /api/queue/enqueue` with freeform prompt

### 4. Adjust submit handler for skill-based tasks ✅

**File:** `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx`

- When a skill is selected, build the request body as:
  ```json
  {
    "type": "follow-prompt",
    "priority": "normal",
    "displayName": "Skill: {skillName}",
    "payload": {
      "skillName": "{selectedSkill}",
      "promptContent": "{prompt text or default}",
      "workingDirectory": "{workspace rootPath}"
    },
    "config": { "model": "{selectedModel}" }
  }
  ```
- POST to `/api/queue/tasks` (the general queue endpoint) instead of `/api/queue/enqueue`
- When no skill is selected, preserve existing behavior (POST to `/api/queue/enqueue`)

### 5. Add tests ✅

**Files:**
- `packages/coc/src/server/spa/client/react/queue/__tests__/EnqueueDialog.test.tsx` — test skill fetching, skill selection UI, submit with skill vs without
- `packages/coc/src/server/spa/client/react/repos/__tests__/RepoQueueTab.test.tsx` — test "+ Queue Task" button renders and dispatches correctly

### 6. Verify end-to-end flow ✅

- Build the SPA (`npm run build` in `packages/coc`)
- Verify the Queue tab shows the "+ Queue Task" button
- Verify the dialog fetches and displays skills when a workspace is selected
- Verify submitting with a skill queues a `follow-prompt` task with correct payload

## UI Mockup (text)

```
┌─────────────────────────────────────────────┐
│  Enqueue AI Task                        [×] │
├─────────────────────────────────────────────┤
│                                             │
│  Prompt                                     │
│  ┌─────────────────────────────────────────┐│
│  │ Enter your prompt...                    ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
│                                             │
│  Skill (optional)                           │
│  ┌─────────────────────────────────────┐    │
│  │ None                            ▼   │    │
│  │ ──────────────────────────────────  │    │
│  │ ⚡ impl — Implementation tasks     │    │
│  │ ⚡ go-deep — Deep research          │    │
│  │ ⚡ draft — Draft UX specs           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Model                                      │
│  ┌─────────────────────────────────────┐    │
│  │ Default                         ▼   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Workspace                                  │
│  ┌─────────────────────────────────────┐    │
│  │ shortcuts                       ▼   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Folder                                     │
│  ┌─────────────────────────────────────┐    │
│  │ (root)                          ▼   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│              [Cancel]  [Enqueue]            │
└─────────────────────────────────────────────┘
```

## Notes

- The skill selector only appears when a workspace is selected (skills are workspace-scoped)
- Skills are fetched from the existing `GET /api/workspaces/:id/skills` endpoint — no backend changes needed
- The `FollowPromptDialog` already demonstrates the pattern for skill-based task submission; we reuse the same API contract
- The prompt field remains visible even when a skill is selected, allowing users to provide additional context or override the default skill prompt
