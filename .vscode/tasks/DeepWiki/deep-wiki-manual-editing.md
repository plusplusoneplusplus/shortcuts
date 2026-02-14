# UX Specification: Deep-Wiki Manual Editing via Serve Mode

## User Story

**As a** developer or tech lead who has generated a deep-wiki for their codebase,
**I want to** manually edit, correct, and enrich the AI-generated wiki content directly in the browser,
**so that** I can fix inaccuracies, add institutional knowledge, and curate the wiki into a polished team resource — without re-running the full generation pipeline.

### Problem

Today, deep-wiki's serve mode is read-only for all wiki content. If the AI produces an inaccurate module description, a misleading architecture overview, or misses an important nuance, the user has no recourse within the UI. They must either:

1. Edit raw `.md` files on disk and restart the server, or
2. Re-run the full generation pipeline (expensive, slow, loses all manual corrections)

This makes deep-wiki a "generate once, read forever" tool rather than a living, editable knowledge base.

---

## Entry Points

### 1. Inline Edit Button (Per Article)

- **Location**: Top-right corner of every article/page content area
- **Icon**: Pencil icon (✏️) — appears on hover or always visible
- **Behavior**: Toggles the current article between **view mode** and **edit mode**
- **Keyboard shortcut**: `E` key when focused on an article (no modifier, like GitHub)

### 2. Module Graph Metadata Editor

- **Location**: Module detail panel (sidebar or overlay when clicking a module)
- **Icon**: Small pencil icon next to module name, purpose, category fields
- **Behavior**: Click any editable field to enter inline edit mode

### 3. Admin Portal — Content Tab (New)

- **Location**: Existing admin portal (⚙ gear icon in top bar), new third tab: **"Content"**
- **Behavior**: Batch operations — rename modules, re-categorize, bulk edit metadata
- **Use case**: Structural changes that span multiple modules

### 4. "Save to Wiki" on AI Results

- **Location**: After an AI Ask or Explore response completes
- **Icon**: Floppy disk / "Save to wiki" button below the AI response
- **Behavior**: Appends or replaces content in the relevant module's article

---

## User Flow

### Flow 1: Editing a Module Article

```
┌──────────────────────────────────────────────────────────┐
│ 1. User browses to a module page (e.g., "Authentication")│
│                                                          │
│ 2. User clicks ✏️ Edit button (top-right of article)     │
│                                                          │
│ 3. Article switches to EDIT MODE:                        │
│    ┌─────────────────────────────────────────┐           │
│    │ [Markdown Editor]          [Live Preview]│           │
│    │                                         │           │
│    │ # Authentication Module    │ rendered    │           │
│    │                            │ markdown    │           │
│    │ This module handles...     │ preview     │           │
│    │                            │             │           │
│    └─────────────────────────────────────────┘           │
│    Toolbar: [Bold] [Italic] [Code] [Link] [Image]       │
│    Actions: [💾 Save] [↩ Cancel] [👁 Preview-only]       │
│                                                          │
│ 4. User edits the markdown content                       │
│                                                          │
│ 5. User clicks "Save"                                    │
│    → Toast: "✅ Article saved"                            │
│    → Article returns to view mode with updated content   │
│    → File written to disk (.wiki/modules/auth.md)        │
│                                                          │
│ 6. A subtle "Manually edited" badge appears on the       │
│    article header, distinguishing it from AI-generated   │
└──────────────────────────────────────────────────────────┘
```

**Edit Mode Layout Options** (responsive):

| Viewport | Layout |
|----------|--------|
| Wide (≥1200px) | Side-by-side: editor left, live preview right |
| Medium (800–1199px) | Tabbed: toggle between editor and preview |
| Narrow (<800px) | Editor only, with preview toggle button |

### Flow 2: Editing Module Metadata

```
┌──────────────────────────────────────────────────────────┐
│ 1. User views a module page                              │
│                                                          │
│ 2. Module header shows:                                  │
│    ┌─────────────────────────────────────────┐           │
│    │ 📦 Authentication          [✏️]          │           │
│    │ Purpose: Handles JWT auth  [✏️]          │           │
│    │ Category: Core   Complexity: Medium      │           │
│    │ Key Files: src/auth/*, src/middleware/*   │           │
│    └─────────────────────────────────────────┘           │
│                                                          │
│ 3. User clicks ✏️ next to "Purpose"                      │
│    → Field becomes an inline text input                  │
│    → User types new purpose                              │
│    → Press Enter or click away to save                   │
│    → Press Escape to cancel                              │
│                                                          │
│ 4. Changes saved to module-graph.json                    │
│    → Sidebar navigation updates if name changed          │
│    → Toast: "✅ Module metadata saved"                    │
└──────────────────────────────────────────────────────────┘
```

**Editable Metadata Fields:**

| Field | Edit Widget | Validation |
|-------|------------|------------|
| `name` | Text input | Required, unique across modules |
| `purpose` | Text input (expandable) | Required, ≤300 chars |
| `category` | Dropdown (existing categories + "New…") | Required |
| `complexity` | Dropdown: low / medium / high | Required |
| `keyFiles` | Tag input (add/remove file paths) | Valid relative paths |
| `dependencies` | Multi-select (other module IDs) | Must exist in graph |

**Non-editable Fields** (structural, require regeneration):
- `id` (derived from path)
- `path` (filesystem structure)
- `dependents` (inverse of dependencies, auto-computed)

### Flow 3: Editing Special Pages

```
┌──────────────────────────────────────────────────────────┐
│ 1. User navigates to a special page:                     │
│    - Index (project overview)                            │
│    - Architecture                                        │
│    - Getting Started                                     │
│                                                          │
│ 2. Same ✏️ Edit button as module articles                 │
│                                                          │
│ 3. Same editor experience                                │
│    → Saves to .wiki/index.md, architecture.md, etc.     │
│                                                          │
│ 4. Special pages show "Last edited: <timestamp>"         │
│    instead of "Manually edited" badge                    │
└──────────────────────────────────────────────────────────┘
```

### Flow 4: Saving AI Results to Wiki

```
┌──────────────────────────────────────────────────────────┐
│ 1. User asks a question via the Ask AI bar               │
│    OR triggers "Explore" deep-dive on a module           │
│                                                          │
│ 2. AI streams its response as usual                      │
│                                                          │
│ 3. After completion, a new action bar appears:           │
│    ┌─────────────────────────────────────────┐           │
│    │ [📋 Copy] [💾 Save to Module ▾] [📄 New Page]│      │
│    └─────────────────────────────────────────┘           │
│                                                          │
│ 4a. "Save to Module" dropdown:                           │
│     → Lists all modules                                  │
│     → Selecting one → sub-choice:                        │
│       • "Append to article" (adds a new section)         │
│       • "Replace article" (with confirmation)            │
│                                                          │
│ 4b. "New Page" creates a custom page:                    │
│     → Prompts for page title                             │
│     → Saves as .wiki/custom/<slug>.md                    │
│     → Appears in sidebar under "Custom Pages" section    │
└──────────────────────────────────────────────────────────┘
```

### Flow 5: Creating Custom Pages

```
┌──────────────────────────────────────────────────────────┐
│ 1. User clicks "+" button in sidebar navigation          │
│    (below the module list)                               │
│                                                          │
│ 2. Dialog appears:                                       │
│    ┌─────────────────────────────────────────┐           │
│    │ New Custom Page                         │           │
│    │ Title: [________________________]       │           │
│    │ Category: [General ▾]                   │           │
│    │        [Create] [Cancel]                │           │
│    └─────────────────────────────────────────┘           │
│                                                          │
│ 3. New page created with template content                │
│    → Opens immediately in edit mode                      │
│    → Appears in sidebar under chosen category            │
│    → Saved as .wiki/custom/<slug>.md                     │
└──────────────────────────────────────────────────────────┘
```

---

## Edit Tracking & Conflict Handling

### Manual Edit Tracking

All manual edits are tracked in a new metadata file: `.wiki/edit-manifest.json`

```json
{
  "version": 1,
  "edits": {
    "modules/auth.md": {
      "lastEditedAt": "2026-02-14T03:30:00Z",
      "editedBy": "manual",
      "originalHash": "sha256:abc123..."
    },
    "architecture.md": {
      "lastEditedAt": "2026-02-13T10:00:00Z",
      "editedBy": "manual",
      "originalHash": "sha256:def456..."
    }
  },
  "customPages": [
    {
      "slug": "deployment-guide",
      "title": "Deployment Guide",
      "category": "Operations",
      "createdAt": "2026-02-14T01:00:00Z"
    }
  ]
}
```

**Purpose:**
- When the user re-generates the wiki, manually edited files are flagged
- The regeneration flow can offer: "Keep manual edits", "Overwrite with AI", or "Merge (show diff)"
- The "Manually edited" badge in the UI is driven by this manifest

### Unsaved Changes Protection

- If the user has unsaved edits and tries to navigate away, a browser-native `beforeunload` confirmation appears
- The edit toolbar shows a dot indicator (●) when there are unsaved changes
- Auto-save draft to `localStorage` every 30 seconds (recovered on page reload)

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **Save fails** (disk full, permission error) | Red toast: "❌ Failed to save: {error}". Editor stays in edit mode with content preserved. |
| **Concurrent edits** (two browser tabs) | Last-write-wins. No real-time collaboration (out of scope). Toast warns if file changed on disk since load. |
| **Invalid markdown** | No validation — markdown is freeform. Preview updates in real-time to show rendered output. |
| **Module name conflict** | Inline validation: "A module named 'X' already exists" — Save button disabled. |
| **Dependency cycle** | When editing dependencies, warn: "⚠️ Adding this creates a circular dependency: A → B → C → A" — allow saving but show warning. |
| **Server not running** | API calls fail → Red toast: "❌ Server connection lost. Changes saved locally." — persist to `localStorage`, prompt to retry. |
| **Very large articles** | Editor uses virtual scrolling for articles > 10,000 lines. No practical limit. |
| **Regeneration after manual edits** | See "Edit Tracking" section — user chooses per-file: keep, overwrite, or diff-merge. |
| **Watch mode active** | File watcher detects the save and triggers WebSocket reload → but since *we* wrote the file, suppress self-triggered reloads (use a write-lock flag). |
| **Custom page deletion** | Right-click page in sidebar → "Delete Page" → confirmation dialog → removes file and manifest entry. |

---

## Visual Design Considerations

### Edit Mode Indicators

```
┌─ Article Header ──────────────────────────────────────┐
│ 📦 Authentication Module                              │
│ ┌──────────────────┐                                  │
│ │ Manually edited  │  ← subtle badge, muted color     │
│ │ Feb 14, 2026     │                                  │
│ └──────────────────┘                                  │
└───────────────────────────────────────────────────────┘
```

### Edit Toolbar

```
┌─────────────────────────────────────────────────────────┐
│ [B] [I] [~~] [Code] [`] [Link] [Image] [Table] [—]     │
│                                                         │
│ [💾 Save]  [↩ Cancel]  [👁 Preview]   ● Unsaved changes │
└─────────────────────────────────────────────────────────┘
```

- Toolbar is **sticky** at top of editor area
- Uses the same theme variables as the rest of the UI (light/dark compatible)
- Formatting buttons insert markdown syntax (not rich text)

### Sidebar Indicators

```
Modules
  ├── 📦 Authentication  ✏️     ← pencil icon = manually edited
  ├── 📦 Database
  ├── 📦 API Gateway      ✏️
  └── 📦 Logging

Custom Pages                    ← new section
  ├── 📄 Deployment Guide  [+]
  └── 📄 Team Conventions
```

### Theme Compatibility

- Editor background: `var(--bg-secondary)` (slightly different from article bg)
- Editor text: `var(--text-primary)` with monospace font
- Line numbers: `var(--text-muted)`
- Toolbar buttons: `var(--border-color)` border, `var(--accent)` on hover

### No External Dependencies

- The markdown editor should be **built-in** (plain `<textarea>` with toolbar helpers)
- No external editor libraries (CodeMirror, Monaco) — keeps the bundle light
- Live preview reuses the existing `marked.js` + `highlight.js` + `mermaid.js` pipeline already in the SPA

---

## API Design (New Endpoints)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `PUT` | `/api/modules/:id/article` | `{ markdown: string }` | Save module article |
| `PATCH` | `/api/modules/:id/metadata` | `{ name?, purpose?, category?, complexity?, keyFiles?, dependencies? }` | Update module metadata |
| `PUT` | `/api/pages/:key` | `{ markdown: string }` | Save special page (index, architecture, getting-started) |
| `POST` | `/api/custom-pages` | `{ title: string, category?: string, markdown?: string }` | Create custom page |
| `PUT` | `/api/custom-pages/:slug` | `{ markdown: string, title?: string }` | Update custom page |
| `DELETE` | `/api/custom-pages/:slug` | — | Delete custom page |
| `GET` | `/api/edit-manifest` | — | Get edit tracking manifest |

All write endpoints return `{ success: true, savedAt: string }` on success or `{ error: string }` on failure.

---

## Settings & Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `--editable` / `--no-editable` | `true` (enabled) | Enable/disable editing in serve mode |
| `--autosave` | `false` | Auto-save edits (no manual Save click needed) |
| `--autosave-delay` | `5000` (ms) | Debounce delay for autosave |

**In `deep-wiki.config.yaml`:**
```yaml
serve:
  editable: true
  autosave: false
  autosaveDelay: 5000
  editableFields:
    - article       # Module article markdown
    - metadata      # Module name, purpose, category, etc.
    - specialPages  # Index, architecture, getting-started
    - customPages   # User-created pages
```

Users can restrict editing to specific content types (e.g., allow article edits but lock metadata).

---

## Discoverability

1. **First-visit tooltip**: On first load when `--editable` is active, a subtle tooltip appears near the first article's edit button: *"You can edit this page — click ✏️ or press E"*. Dismissed on click, not shown again (stored in `localStorage`).

2. **Empty state for custom pages**: The "Custom Pages" sidebar section shows a friendly message when empty: *"Add your own pages to the wiki. Click + to get started."*

3. **Keyboard shortcut hint**: The edit button tooltip shows `"Edit this page (E)"`.

4. **CLI help text**: `deep-wiki serve --help` mentions: *"Wiki content is editable by default. Use --no-editable for read-only mode."*

5. **"Manually edited" badges** naturally prompt team members to realize editing is possible.

---

## Out of Scope (Future Considerations)

- **Real-time collaborative editing** (multi-user simultaneous edits)
- **Version history / undo** (beyond browser undo within a session)
- **Git integration** (auto-committing wiki edits)
- **WYSIWYG rich text editing** (markdown-first approach)
- **Image upload** (users reference external URLs or repo-relative paths)
- **Access control / authentication** (serve mode is local-first)
