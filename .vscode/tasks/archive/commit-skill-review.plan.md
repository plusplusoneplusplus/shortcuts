# Commit/Branch Skill Review — Plan

## Problem

In the CoC dashboard Git tab, users can view commit history and branch changes but cannot take action on them. There is no way to run a skill (e.g., code review) against a single commit's diff or a branch's cumulative changes.

## Proposed Approach

Add a **right-click context menu** to commit rows in the HISTORY list and to the BRANCH CHANGES header in the Git tab. The menu exposes a **"Use Skill ▸"** submenu that dynamically lists all available skills from `.github/skills/`. Selecting a skill enqueues a `follow-prompt` task with the skill name and git diff context, triggering execution through the existing queue system.

### UX Flow

1. User right-clicks a commit row in HISTORY → context menu appears
2. Menu shows **"Use Skill ▸"** item with a submenu arrow
3. Submenu lists all discovered skills (fetched from `/api/workspaces/:id/skills`)
4. User clicks a skill (e.g., "code-review") → task is enqueued
5. A toast/notification confirms the job was queued
6. The job appears in the Queue tab and executes via the existing queue executor

Same flow applies to right-clicking the **BRANCH CHANGES** section, but the diff covers the entire branch range (all commits ahead of base).

---

## Implementation Todos

### 1. Fetch skills in RepoGitTab

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

- Add a `useEffect` that fetches skills from `/api/workspaces/${workspaceId}/skills` when the Git tab mounts (same pattern as `RepoChatTab.tsx` and `EnqueueDialog.tsx`).
- Store in state: `skills: Array<{ name: string; description?: string }>`.
- Cache across tab switches (fetch once per workspace selection).

### 2. Add context menu state to RepoGitTab

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

- Add state: `contextMenu: { x: number; y: number; type: 'commit' | 'branch-range'; commitHash?: string } | null`.
- Add `closeContextMenu` callback.
- Build `contextMenuItems` via `useMemo`:
  - Single top-level item: **"Use Skill ▸"** with `children` submenu (the `ContextMenu` component already supports nested `children` for submenus).
  - Each child = one skill from the fetched list, with `onClick` that calls the enqueue handler.
- Render the shared `<ContextMenu>` component conditionally (same pattern as `RepoQueueTab.tsx`).

### 3. Add onContextMenu handler to CommitList

**File:** `packages/coc/src/server/spa/client/react/repos/CommitList.tsx`

- Accept a new prop: `onCommitContextMenu?: (e: React.MouseEvent, commitHash: string) => void`.
- Attach `onContextMenu` to each commit row `<div>` (the clickable row element).
- Call `e.preventDefault()` + `e.stopPropagation()` and invoke the callback with the commit's hash.

### 4. Add onContextMenu handler to BranchChanges

**File:** `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx`

- Accept a new prop: `onBranchContextMenu?: (e: React.MouseEvent) => void`.
- Attach `onContextMenu` to the branch changes header row (the "BRANCH CHANGES: MAIN" clickable area).
- Call `e.preventDefault()` + `e.stopPropagation()` and invoke the callback.

### 5. Wire context menu in RepoGitTab

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

- Pass `onCommitContextMenu` to `<CommitList>` that sets context menu state with `type: 'commit'` and the commit hash.
- Pass `onBranchContextMenu` to `<BranchChanges>` that sets context menu state with `type: 'branch-range'`.
- Build context menu items dynamically from the skills list.

### 6. Implement enqueue handler for skill execution

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

- When a skill is selected from the context menu:
  1. **Fetch the diff** based on context type:
     - For `commit`: `GET /api/workspaces/:id/git/commits/:hash/diff`
     - For `branch-range`: `GET /api/workspaces/:id/git/branch-range/diff`
  2. **Build the prompt** with the diff as context:
     ```
     Review the following git changes.

     Commit: {hash} — {subject}
     Author: {author}

     <diff>
     {diff content}
     </diff>
     ```
     For branch range:
     ```
     Review the following branch changes ({ahead} commits ahead of {baseRef}).

     <diff>
     {diff content}
     </diff>
     ```
  3. **Enqueue the task** via `POST /api/queue/tasks`:
     ```json
     {
       "type": "follow-prompt",
       "priority": "normal",
       "displayName": "Skill: {skillName} — commit {shortHash}",
       "payload": {
         "skillName": "{selectedSkill}",
         "promptContent": "{constructed prompt with diff}",
         "workingDirectory": "{workspace.rootPath}"
       }
     }
     ```
  4. **Show confirmation** toast/notification that the job was enqueued.

### 7. Add "Copy Hash" and "View Diff" to context menu (bonus)

While adding the context menu infrastructure, include two additional non-skill items:
- **Copy Hash** — copies the full commit hash to clipboard (mirrors tooltip button).
- **View Diff** — selects the commit (equivalent to clicking it), useful for discoverability.

These are separated from the skill submenu by a `separator` item.

---

## Key Architecture Decisions

### Why `follow-prompt` with inline diff (not a new task type)?

- The `follow-prompt` task type already supports `skillName` and `promptContent`. The skill directives are automatically prepended by `applySkillContent()` in `queue-executor-bridge.ts`.
- No backend changes needed — the entire feature is frontend-only (fetching diff, building prompt, enqueuing task).
- Skills are designed to work with natural-language prompts. Including the diff as prompt context is the expected pattern.

### Why fetch diff client-side?

- The diff APIs already exist and are used by the commit detail panel.
- Avoids adding new backend payload fields or executor logic.
- The client can truncate very large diffs before sending (e.g., cap at 100KB).

### Diff size handling

- For very large diffs, truncate with a note: `[Diff truncated — showing first N lines of M total]`.
- Default truncation threshold: 100KB or ~3000 lines.
- The AI skill can still provide useful review on truncated diffs.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Skills fetch, context menu state, enqueue handler, render `<ContextMenu>` |
| `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` | New `onCommitContextMenu` prop, attach to commit rows |
| `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` | New `onBranchContextMenu` prop, attach to header |

## Files Referenced (no changes needed)

| File | Why |
|------|-----|
| `packages/coc/src/server/spa/client/react/tasks/comments/ContextMenu.tsx` | Shared context menu component with submenu support |
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Reference pattern for context menu usage |
| `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Reference pattern for skills fetch + task enqueue |
| `packages/coc-server/src/task-types.ts` | `FollowPromptPayload` type definition |
| `packages/coc/src/server/queue-executor-bridge.ts` | `applySkillContent()` for skill directive injection |
| `packages/coc/src/server/prompt-handler.ts` | Skills API endpoint (`GET /api/workspaces/:id/skills`) |

## Testing

- Verify context menu appears on right-click of a commit row.
- Verify context menu appears on right-click of BRANCH CHANGES header.
- Verify skills submenu lists all skills from `.github/skills/`.
- Verify selecting a skill enqueues a task that appears in the Queue tab.
- Verify the enqueued task executes successfully with the correct diff context.
- Verify large diffs are truncated gracefully.
- Verify the context menu closes on outside click, Escape, or scroll.
