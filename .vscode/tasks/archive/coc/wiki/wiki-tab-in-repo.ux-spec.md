# UX Spec: Wiki Tab in Repo Detail Page

## User Story

As a developer browsing a repo in the CoC dashboard, I want to see and browse the wiki for that repo directly inside the repo detail page — without navigating away to the standalone Wiki section — so I can quickly reference architecture documentation alongside tasks, pipelines, and queue items.

## Entry Points

1. **Repo Detail Tab Bar** — A new **"Wiki"** tab appears after "Chat" in the `RepoDetail` sub-tab bar (Info · Pipelines · Tasks · Queue · Schedules · Chat · **Wiki**).
2. **Hash URL** — `#repos/{wsId}/wiki` deep-links directly to the Wiki tab for a repo.
3. **Deep-linking into components** — `#repos/{wsId}/wiki/component/{componentId}` opens the wiki tab with a specific component selected.
4. **Deep-linking into wiki sub-tabs** — `#repos/{wsId}/wiki/{browse|ask|graph|admin}` opens a specific wiki sub-view.

## Data Relationship & Wiki Resolution

Wiki resolution follows a **three-tier** strategy:

1. **Auto-link** — Find a registered wiki whose `repoPath` matches the workspace `rootPath` (normalized path comparison, consistent with `resolveWorkspaceForPath`).
2. **Subfolder detection** — Scan for a `component-graph.json` inside common wiki output locations under the repo (e.g., `docs/wiki/`, `.wiki/`, `wiki/`). If found, auto-register and load it.
3. **Manual link** — If neither of the above yields a wiki, the user can specify a wiki directory path or select from existing registered wikis.

Resolution result determines the UI state:
- **Wiki found & loaded** → embed `WikiDetail` directly.
- **Wiki found but pending** → show "Setup Required" with generate CTA.
- **No wiki found** → show empty state with options to link or create.

## User Flow

### Happy Path (Wiki Exists & Loaded)

1. User selects a repo from the sidebar → `RepoDetail` renders.
2. User clicks the **Wiki** tab.
3. Hash updates to `#repos/{wsId}/wiki`.
4. The tab content area renders the existing `WikiDetail` component (browse/ask/graph/admin sub-tabs), scoped to the matched wiki.
5. Navigating wiki sub-tabs updates hash to `#repos/{wsId}/wiki/{subTab}`.
6. Clicking a component updates hash to `#repos/{wsId}/wiki/component/{id}`.
7. The wiki's own top bar (← back button, project title) is **hidden** since the repo header already provides context.

### Wiki Registered but Pending (Setup Required)

1. User clicks **Wiki** tab.
2. The existing `WikiDetail` "Setup Required" empty state renders inline — same ⚠ icon, same "Run Setup Wizard" button.
3. Clicking "Run Setup Wizard" navigates to the wiki's admin tab **within the repo page**: `#repos/{wsId}/wiki/admin`.

### No Wiki Found — Empty State with Link/Create Options

1. User clicks **Wiki** tab.
2. Empty state shows:
   - 📖 icon
   - **"No Wiki Linked"**
   - "Link an existing wiki or generate a new one for this repository."
   - Two action rows:

**Option A — Link Existing Wiki**
   - A dropdown/select listing all registered wikis from `state.wikis` that are **not already linked** to another workspace. Each entry shows `wiki.name` and a truncated `wiki.wikiDir`.
   - Selecting a wiki and clicking **"Link"** calls `PATCH /api/wikis/{wikiId}` to set `repoPath = workspace.rootPath`, then reloads.

**Option B — Specify Wiki Directory**
   - A text input with placeholder `e.g., D:\projects\myrepo\docs\wiki` and a **"Browse…"** button (if the server supports directory listing, otherwise just the text field).
   - User pastes or types the path to a directory containing wiki output (must have `component-graph.json`).
   - Clicking **"Link Path"** calls `POST /api/wikis` with `{ id: auto-derived, repoPath: workspace.rootPath, wikiDir: userPath }` to register a new wiki from that directory.
   - If the path doesn't contain `component-graph.json`, show inline validation: "⚠ No component-graph.json found at this path. Generate a wiki first, or check the path."

**Option C — Generate New Wiki**
   - **"+ Generate Wiki"** button.
   - Clicking it auto-registers a wiki (POST `/api/wikis` with `repoPath = workspace.rootPath`, `id` derived from repo name) and navigates to the admin/generate tab: `#repos/{wsId}/wiki/admin`.

### Changing or Unlinking a Wiki

- Once a wiki is linked, a small **"⚙"** (settings) icon appears next to the Wiki tab label or in the embedded wiki header area.
- Clicking it opens an inline popover with:
  - **Current wiki**: `{wiki.name}` — `{wiki.wikiDir}`
  - **"Change Wiki…"** — returns to the link/select flow (same as empty state but as a modal/popover).
  - **"Unlink"** — removes the `repoPath` association (PATCH `/api/wikis/{wikiId}` with `repoPath: null`), returning the tab to the empty state. Does **not** delete the wiki data.
  - **"Open in Wiki Section →"** — navigates to `#wiki/{wikiId}` (the standalone wiki page).

## Technical Approach — Reuse Existing Code

### Type Changes (`dashboard.ts`)

```typescript
// Add 'wiki' to RepoSubTab
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'wiki';
```

### RepoDetail Changes

1. Add `{ key: 'wiki', label: 'Wiki' }` to `SUB_TABS` array.
2. Add a `RepoWikiTab` component to the tab content switch.
3. Pass `workspaceRootPath` to the new tab component.

### New Component: `RepoWikiTab`

```
RepoWikiTab({ workspaceId, rootPath })
├── Phase 1: Resolve wiki
│   ├── Check state.wikis for repoPath match → found? use it
│   ├── No match? Check state.wikis for wikiDir under rootPath → found? use it
│   └── Still no match? → show LinkWikiPanel
├── Phase 2: Render
│   ├── Wiki resolved → <WikiDetail wikiId={wiki.id} embedded hashPrefix={...} />
│   └── No wiki → <LinkWikiPanel workspaceId rootPath onLinked={refetch} />
└── WikiDetail receives `embedded` prop to:
    ├── Hide the ← back button
    ├── Hide the top-level wiki header bar (name, status badge)
    └── Let hash updates go to #repos/{wsId}/wiki/... instead of #wiki/...
```

### New Component: `LinkWikiPanel`

```
LinkWikiPanel({ workspaceId, rootPath, onLinked })
├── Empty state icon + messaging
├── Section A: "Link Existing Wiki"
│   ├── <select> populated from state.wikis (unlinked wikis)
│   └── "Link" button → PATCH /api/wikis/{id} { repoPath }
├── Section B: "Specify Wiki Path"
│   ├── <input type="text"> for directory path
│   ├── Client-side hint: "Must contain component-graph.json"
│   └── "Link Path" button → POST /api/wikis { id, wikiDir, repoPath }
├── Section C: "Generate New"
│   └── "+ Generate Wiki" button → POST /api/wikis + navigate to admin
└── All actions call onLinked() on success to trigger re-resolution
```

### Router Changes

- Extend repo sub-tab parsing in `Router.tsx` to recognize `wiki` as a valid sub-tab.
- Add `VALID_REPO_SUB_TABS`: include `'wiki'`.
- Parse deeper segments: `#repos/{wsId}/wiki/component/{id}` and `#repos/{wsId}/wiki/{subTab}`.

### API Changes

- **`PATCH /api/wikis/:wikiId`** — Update wiki fields (at minimum: `repoPath`). If this endpoint doesn't exist yet, add it to `wiki-routes.ts`. Only allows updating mutable fields (`repoPath`, `name`, `color`, `aiEnabled`).
- **Existing `POST /api/wikis`** — Already supports `wikiDir` + `repoPath`, used by "Specify Wiki Path" and "Generate New" flows.

### WikiDetail Embedded Mode

Add an `embedded?: boolean` prop and an optional `hashPrefix?: string` prop to `WikiDetail`:

- When `embedded=true`:
  - The top header bar (← back, project name, status badge) is **not rendered**.
  - The wiki tab pills (Browse, Ask, Graph, Admin) still render but update hash using `hashPrefix` (e.g., `#repos/{wsId}/wiki/`) instead of `#wiki/{wikiId}/`.
- When `embedded=false` (default): current behavior, no changes.

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| Wiki deleted externally while tab open | Next API call fails → show "Wiki unavailable" inline with "Refresh" button |
| Multiple wikis match same repoPath | Use the first loaded one; if none loaded, use the first registered one |
| Workspace has no rootPath | Hide the Wiki tab entirely (no path to match against) |
| Wiki generation completes while tab open | WebSocket event updates `state.wikis` → component re-renders with loaded wiki |
| User switches repos while wiki is loading | Standard React cleanup — abort fetch on unmount |
| User specifies path without component-graph.json | Inline validation error; do not register the wiki |
| User links a wiki already linked to another repo | Allow it — a wiki can serve multiple repos (show info note) |
| User unlinks a wiki | PATCH sets `repoPath: null`; tab returns to empty state; wiki data preserved |
| PATCH /api/wikis fails (server error) | Toast/inline error "Failed to link wiki. Please try again." |

## Visual Design

- **Tab appearance**: Identical to existing tabs (same font, underline, spacing).
- **Badge on Wiki tab**: Show a green dot or "✓" when wiki is loaded; show "⚠" when pending setup. No count badge.
- **Embedded WikiDetail**: Same two-pane layout (sidebar tree + content) but without the redundant header. The wiki content fills the full sub-tab content area.
- **Settings gear icon**: Small `⚙` button (12px, muted color) positioned to the right of the wiki tab pills row, only visible when a wiki is linked. Opens a popover for change/unlink/open-standalone actions.
- **Empty state (LinkWikiPanel)**: Centered layout, consistent with other dashboard empty states. Three sections stacked vertically with subtle dividers:
  - Section A (dropdown + Link button) — for power users who have wikis registered elsewhere
  - Section B (text input + Link Path button) — for users pointing to a local wiki directory
  - Section C (Generate button) — primary CTA for first-time users, styled with `variant="primary"`
- **Path validation**: Inline red text below the input field when validation fails.

## Settings & Configuration

- **Wiki-to-repo association** is persisted server-side on the wiki record (`repoPath` field). No new config files needed.
- The wiki's own admin settings (seeds, AI config) remain accessible through the Admin sub-tab within the embedded wiki.
- **Change/Unlink** actions available via the ⚙ popover once a wiki is linked.

## Discoverability

- The **Wiki** tab is always visible in the tab bar (even when no wiki exists) so users discover the feature naturally.
- The empty state presents three clear options (link existing, specify path, generate new) — no dead ends.
- Existing wiki users see their wiki content inline without any extra setup (auto-link).
- The ⚙ icon makes it clear the association can be changed at any time.
