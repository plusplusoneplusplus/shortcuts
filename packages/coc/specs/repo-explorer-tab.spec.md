# Repository Explorer Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Explorer Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Explorer tab.  
**Version:** 1.1.0

---

## 1. Overview

The **Repository Explorer Tab** provides a file browser for navigating, searching, previewing, and editing files in the repository. It features a resizable sidebar with a recursive file tree, breadcrumb navigation, search with server-side results, and a preview pane with Monaco Editor integration for text editing. Quick Open (Ctrl/Cmd+P) and Exact Open (Ctrl/Cmd+O) modals provide fast file access.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Explorer` |
| Tab position | Sixth in `RepoDetail` (Classic order); reorders in `dev-workflow` UI layout mode but keeps `explorer` between `schedules` and `workflows` |
| Keyboard shortcut | `Alt+E` to switch to Explorer when `RepoDetail` is focused |
| Default tab | No |
| URL fragment | `#repos/<workspaceId>/explorer` |
| Deep-link URL | `#repos/<workspaceId>/explorer/<filePath>` (paths whose last segment contains a `.` are auto-opened in the preview pane) |
| Component panel | `ExplorerPanel` (`features/repo-detail/explorer/ExplorerPanel.tsx`) backed by `explorerApi` (`getSpaCocClient().explorer`) |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers browsing and editing repository files | Navigate file tree, preview and edit files |
| **Reviewer** | Team members inspecting specific files | Quick-open files, read source code |
| **Explorer** | Users unfamiliar with the repo structure | Search for files, browse directories |

---

## 3. User Stories

### 3.1 File Navigation

**US-01 — Browse the file tree**
> As a developer, I want to navigate the repository file tree so I can find files.

- **Given** the Explorer tab is open
- **When** the tree loads
- **Then** the root directory is shown with depth-2 expansion; directories have expand chevrons; files show appropriate icons

---

**US-02 — Expand directories lazily**
> As a developer, I want directories to load their contents on demand.

- **Given** a collapsed directory is visible
- **When** the user clicks the expand chevron
- **Then** the directory's children are fetched from `GET /api/repos/:repoId/tree?path=<dir>` and displayed with a loading spinner during fetch

---

**US-03 — Navigate with breadcrumbs**
> As a developer, I want breadcrumb navigation to move up the directory hierarchy.

- **Given** a nested directory is selected
- **When** the user clicks a breadcrumb segment
- **Then** the tree navigates to that directory level

---

**US-04 — Deep-link to a file**
> As a developer sharing a link, I want a URL that opens a specific file.

- **Given** a URL of the form `#repos/<workspaceId>/explorer/<filePath>`
- **When** the user navigates to that URL
- **Then** the Explorer tab opens with the file's parent directories expanded and the file previewed

---

### 3.2 Search

**US-05 — Filter the tree by name**
> As an explorer, I want to filter the file tree by typing a name.

- **Given** the search input is focused
- **When** the user types a query
- **Then** after a 150ms debounce, the tree filters locally by name substring and auto-expands directories with matches

---

**US-06 — Server-side search**
> As a developer, I want to search for files across the entire repository.

- **Given** the user types in the search input
- **When** the debounce fires (300ms for server search)
- **Then** `GET /api/repos/:repoId/search?q=<query>&limit=100` is called; results are merged into the tree and ancestors are auto-expanded

---

**US-07 — Quick Open**
> As a developer, I want to quickly open a file by name using a keyboard shortcut.

- **Given** the Explorer tab is active
- **When** the user presses Ctrl/Cmd+P
- **Then** a `QuickOpen` modal appears with a search input; results come from server search (limit 50); keyboard navigation (↑/↓/Enter/Escape) is supported

---

**US-08 — Exact Open**
> As a developer, I want to open a file by exact basename match.

- **Given** the Explorer tab is active
- **When** the user presses Ctrl/Cmd+O
- **Then** an `ExactOpen` modal appears with an "exact" badge; results prioritize exact basename matches

---

### 3.3 File Preview & Editing

**US-09 — Preview a file**
> As a developer, I want to preview a file's contents.

- **Given** a file is selected in the tree
- **When** the user clicks the file
- **Then** the preview pane shows the file content: rendered for images, syntax-highlighted for text (via Monaco Editor), or a message for binary/oversized files (512 KB cap)

---

**US-10 — Edit and save a file**
> As a developer, I want to edit a text file and save my changes.

- **Given** a text file is open in the preview pane
- **When** the user edits the content
- **Then** a dirty indicator appears and a floating Save button becomes visible
- **When** the user clicks Save or presses Ctrl+S
- **Then** `PUT /api/repos/:repoId/blob?path=<filePath>` is called with the new content

---

**US-11 — Reveal file in OS explorer**
> As a developer, I want to reveal a file in my operating system's file explorer.

- **Given** a file or directory is visible in the tree
- **When** the user selects "Reveal in File Explorer" from the context menu
- **Then** `GET /api/repos/:repoId/reveal?path=<path>` is called to open the OS file manager

---

### 3.4 Search State Restoration

**US-12 — Restore tree state after clearing search**
> As a developer, I want the tree to return to its previous state when I clear the search.

- **Given** the tree has specific directories expanded
- **When** the user searches and then clears the search (Escape or clear button)
- **Then** the previously expanded directories are restored

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Sidebar

| Feature | Acceptance Criteria |
|---|---|
| File tree | Recursive `TreeNode` components with icons, expand chevrons, lazy loading |
| Breadcrumbs | Root label "root"; clickable segments; navigate up or to root |
| Search bar | Filter input with clear button; 150ms local debounce; 300ms server search debounce |
| Server search indicator | "Searching…" text shown during server search |
| Refresh button | Reloads tree from root |
| Context menu | Right-click on nodes; Shift+right-click opens native menu |

### 4.2 Preview Pane

| Feature | Acceptance Criteria |
|---|---|
| Text files | Monaco Editor with syntax highlighting and theme sync |
| Images | Rendered inline |
| Binary files | "Binary file" message |
| Oversized files | Message for files exceeding 512 KB |
| Save | Floating Save button when dirty; Ctrl+S keyboard shortcut |
| Close | Desktop: ✕ button to close preview |
| Loading | Spinner during file fetch |
| Error | Error message with Retry button |

### 4.3 Modals

| Feature | Acceptance Criteria |
|---|---|
| Quick Open (Ctrl/Cmd+P) | Server search, keyboard navigation (↑/↓/Enter/Escape), limit 50 results |
| Exact Open (Ctrl/Cmd+O) | "Exact" badge, prioritizes basename matches |

### 4.4 Resize Behavior

| Feature | Acceptance Criteria |
|---|---|
| Sidebar resize | Drag handle; width range 160–600px; persisted as `explorer-sidebar-width` |
| Mobile layout | Tree or full-screen preview with back bar; tree hidden when file open |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Lazy directory loading only fetches children when a directory is first expanded |
| INV-02 | Server search results are merged into the existing tree structure, not replacing it |
| INV-03 | Clearing the search restores the previously expanded directory state |
| INV-04 | The preview pane file size cap is 512 KB; larger files show a message instead of content |
| INV-05 | Shift+right-click always opens the native browser context menu |
| INV-06 | The `/` key focuses the search input when not already in an input or textarea |
| INV-07 | Deep-link paths that look like files (last segment contains `.`) auto-open the preview |
| INV-08 | Root tree load uses `depth=2`; subsequent lazy loads use `depth=1` |

---

## 6. Context Menu Specification

| Action | Directories | Files |
|---|---|---|
| Expand / Collapse | ✓ | ✗ |
| Open Preview | ✗ | ✓ |
| Copy path | ✓ | ✓ |
| Copy name | ✓ | ✓ |
| Reveal in File Explorer | ✓ | ✓ |

---

## 7. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git │ Plans │ … │ Explorer* │ …           │
├────────────────────────┬────────────────────────────────────────────┤
│  Files            [↻]  │                                            │
│  root / src / components│  src/components/App.tsx                   │
│  ──────────────────────│  ─────────────────────────────────────     │
│  [🔍 Filter files…]    │                                            │
│                        │  import React from 'react';               │
│  📁 src/               │  import { useState } from 'react';       │
│    📁 components/      │                                            │
│      📄 App.tsx    ◄   │  export function App() {                  │
│      📄 Header.tsx     │    const [count, setCount] = useState(0); │
│      📄 Footer.tsx     │    return (                               │
│    📁 utils/           │      <div>                                │
│      📄 helpers.ts     │        <h1>Count: {count}</h1>            │
│    📄 index.ts         │      </div>                               │
│  📁 tests/             │    );                                     │
│  📄 package.json       │  }                                        │
│  📄 tsconfig.json      │                                            │
│                        │  [💾 Save]                        [✕]     │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 8. Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `/` | Not in input/textarea | Focus search input |
| `Escape` | Search input | Clear search and restore tree state |
| `Ctrl/Cmd+P` | Explorer tab | Open Quick Open modal |
| `Ctrl/Cmd+O` | Explorer tab | Open Exact Open modal |
| `Ctrl+S` | Monaco Editor | Save file |
| `↑` / `↓` | Tree area | Navigate tree nodes |
| `Enter` / `Space` | Tree area | Select/expand node |
| `Left` / `Right` | Tree area | Collapse/expand directory |

---

## 9. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Tree load failure | Red error text (`explorer-error`) |
| File preview load failure | Error message with Retry button |
| File save failure | Error notification; dirty state preserved |
| Search failure | Silent degradation; local filter still works |

---

## 10. Empty State Specification

| State | Display |
|---|---|
| Initial load | Full-panel spinner |
| Empty directory | No children shown (collapsed) |
| Search with no results | No matching nodes highlighted |
| No file selected | Preview pane not shown |

---

## 11. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/repos/:repoId/tree` | File tree | US-01, US-02 |
| `GET /api/repos/:repoId/search` | Server search, Quick Open, Exact Open | US-06, US-07, US-08 |
| `GET /api/repos/:repoId/blob` | File preview | US-09 |
| `PUT /api/repos/:repoId/blob` | File save | US-10 |
| `GET /api/repos/:repoId/reveal` | OS reveal | US-11 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 1.1.0 | 2026-05-29 | Added explicit keyboard shortcut (`Alt+E`), clarified that `dev-workflow` UI layout reorders the surrounding tab strip while keeping Explorer adjacent to Schedules and Workflows, named the implementing component (`ExplorerPanel`) and the API wrapper (`explorerApi` over `getSpaCocClient().explorer`), and noted the deep-link auto-preview heuristic (paths with `.` in the last segment). |
