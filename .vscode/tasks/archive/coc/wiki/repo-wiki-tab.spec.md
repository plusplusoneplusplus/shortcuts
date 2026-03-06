# UX Spec: Wiki Sub-Tab in Repo Detail View

## User Story

As a developer using the CoC dashboard, I want to access a workspace's wiki directly from its repo detail view, so I can browse documentation, ask AI questions, and manage wiki generation without leaving the repo context.

Currently, wikis live under a separate top-level "Wiki" tab. When I'm working in a repo detail view (Info, Git, Pipelines, Tasks, Queue, Schedules, Chat), there's no way to access the associated wiki. I have to navigate away to the top-level Wiki tab, find the right wiki, then lose my repo context.

## Entry Points

- **Repo Detail Sub-Tab**: A "Wiki" tab appears in the repo detail tab bar alongside Info, Git, Pipelines, Tasks, Queue, Schedules, Chat.
- **Keyboard Shortcut**: Follows the existing pattern — pressing `W` while in the repo detail view switches to the Wiki tab (matches existing single-key shortcuts like `C` for Chat).

## Data Model Context

Each wiki has an optional `repoPath` field that links it to a workspace. The repo wiki tab filters wikis by matching `wiki.repoPath` against the current workspace's root path.

A workspace may have **zero, one, or multiple** associated wikis.

## User Flow

### State 1: No Wiki Exists for This Repo

1. User selects a repo and clicks the "Wiki" tab.
2. Tab shows an empty state with:
   - Icon and message: "No wiki for this workspace"
   - A **"Generate Wiki"** button that opens the wiki creation flow pre-filled with this repo's path.
3. Clicking "Generate Wiki" creates a new wiki registration with `repoPath` set to the current workspace, then navigates to the wiki admin/generate view inline.

### State 2: One Wiki Exists (Common Case)

1. User clicks the "Wiki" tab.
2. The wiki detail view renders **inline** — no intermediate list. Shows the same sub-tabs as the top-level wiki detail:
   - **Browse**: Component tree (left) + article content (right)
   - **Ask**: AI Q&A about the codebase
   - **Graph**: Visual dependency graph
   - **Admin**: Generate, seeds, config, delete
3. The component tree, article rendering, ask/graph features all work identically to the top-level Wiki detail view.

### State 3: Multiple Wikis Exist

1. User clicks the "Wiki" tab.
2. A compact wiki selector (dropdown or pill bar) appears at the top showing all wikis for this repo.
3. Selecting a wiki loads its detail view inline (same as State 2).
4. The most recently generated wiki is selected by default.

## Tab Badge

- **No badge** when no wiki exists or wiki status is "loaded" (ready).
- **Pulsing/spinner badge** when a wiki is actively generating (`status === 'generating'`).
- **Warning dot** when wiki status is "error" or "pending" (setup required).

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Wiki is generating | Show progress indicator inline. Browse/Ask/Graph tabs disabled with "Generation in progress…" message. Admin tab accessible. |
| Wiki generation fails | Show error banner with retry option. Admin tab accessible for reconfiguration. |
| Wiki deleted from top-level | Tab reverts to empty state (State 1). |
| Wiki created from top-level with matching repoPath | Tab automatically picks it up on next data refresh. |
| Repo has no `rootPath` | Wiki tab still appears but "Generate Wiki" is disabled with tooltip explaining a repo path is required. |

## Visual Design Considerations

- **Tab position**: Wiki tab placed **after Chat**, as the last tab. Wiki is a reference resource, not a primary workflow tab.
- **Inline rendering**: The wiki detail view reuses existing `WikiDetail` / `WikiComponentTree` / `WikiAsk` / `WikiGraph` / `WikiAdmin` components. No new visual patterns needed.
- **Empty state**: Matches the existing empty-state pattern used elsewhere in the dashboard (centered icon + message + action button).
- **Wiki selector** (multi-wiki case): A small dropdown above the wiki content area, styled consistently with other selectors in the dashboard.

## Settings & Configuration

No new settings required. Wiki configuration is managed through the existing wiki admin panel (seeds, config, generation options), which will be accessible from the inline Admin sub-tab.

## Discoverability

- The tab is always visible in the repo detail tab bar (not hidden when empty). The empty state with "Generate Wiki" guides first-time users.
- Badge indicators draw attention when a wiki needs action (error, pending setup).

## URL Routing

Follows existing pattern: `#repos/{workspaceId}/wiki` for the tab, with optional deeper linking: `#repos/{workspaceId}/wiki/{wikiId}/browse`, `#repos/{workspaceId}/wiki/{wikiId}/component/{componentId}`.

## Scope Boundary

- This feature **reuses** existing wiki components — it does not duplicate them.
- Wiki CRUD operations (create, edit, delete) continue to work through existing dialogs/APIs.
- The top-level Wiki tab remains unchanged; this is an additional entry point, not a replacement.
