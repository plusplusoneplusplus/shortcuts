# Memory Tab — Dashboard Feature Plan

## Problem Statement

The CoC dashboard currently has three top-level tabs: **Repos**, **Processes**, and **Wiki**.
There is no dedicated surface for managing persistent AI memory — structured knowledge that agents
accumulate across sessions, injected as context into future conversations.

This plan adds a **Memory** top-level tab with sub-tabs, starting with a **Config** sub-tab for
configuring the memory storage backend, and an **Entries** sub-tab for browsing/editing memories.

---

## Acceptance Criteria

- [x] A **Memory** tab appears in `TopBar` (desktop) and `BottomNav` (mobile) alongside Repos / Processes / Wiki.
- [x] Navigating to `#memory` (hash routing) renders the `MemoryView` component.
- [x] `MemoryView` has at minimum two sub-tabs: **Entries** and **Config**.
- [x] **Config sub-tab** lets the user view and save:
  - Storage location (directory path, defaults to `~/.coc/memory/`)
  - Storage backend type (`file` | `sqlite` | `vector`)
  - Retention policy (max entries, TTL in days)
  - Auto-inject toggle (inject relevant memories into AI prompts automatically)
- [x] **Entries sub-tab** shows a searchable, paginated list of memory items with:
  - Content preview, tags, source (which pipeline/session created it), timestamp
  - Actions: view full content, edit tags, delete
- [x] Backend exposes REST API under `/api/memory/*`:
  - `GET /api/memory/config` — read config
  - `PUT /api/memory/config` — write config
  - `GET /api/memory/entries?q=&tag=&page=` — list/search entries
  - `POST /api/memory/entries` — create entry
  - `GET /api/memory/entries/:id` — get single entry
  - `PATCH /api/memory/entries/:id` — update tags/content
  - `DELETE /api/memory/entries/:id` — delete entry
- [x] Config changes persist to `~/.coc/memory-config.json` via atomic write (write-then-rename pattern).
- [x] Memory entries persist to the configured storage location.
- [x] Mobile layout (BottomNav) includes Memory with a Brain icon.
- [x] All new backend code has Vitest unit tests; new React components have basic render tests.

---

## Subtasks

### 1. Type & Routing Scaffolding
**File:** `packages/coc/src/server/spa/client/react/types/dashboard.ts`
- Add `'memory'` to the `DashboardTab` union type.
- Define `MemorySubTab = 'entries' | 'config'` union type.

**File:** `packages/coc/src/server/spa/client/react/layout/Router.tsx`
- Add `memory` case to `tabFromHash()`.
- Render `<MemoryView />` for the `memory` tab.

**File:** `packages/coc/src/server/spa/client/react/context/AppContext.ts`
- Add `activeMemorySubTab: MemorySubTab` to state.
- Add `SET_MEMORY_SUB_TAB` action.

---

### 2. Navigation: TopBar + BottomNav
**File:** `packages/coc/src/server/spa/client/react/layout/TopBar.tsx`
- Add `{ id: 'memory', label: 'Memory' }` to the `TABS` constant.

**File:** `packages/coc/src/server/spa/client/react/layout/BottomNav.tsx`
- Add Memory entry with a `Brain` icon (lucide-react) between Wiki and any admin items.

---

### 3. MemoryView React Component
**New file:** `packages/coc/src/server/spa/client/react/views/memory/MemoryView.tsx`

Top-level view that renders a horizontal sub-tab bar (Entries | Config) and delegates to child components.

```
MemoryView
├── MemorySubTabBar      (Entries | Config)
├── MemoryEntriesPanel   (shown when sub-tab = entries)
│   ├── SearchBar
│   ├── TagFilter
│   └── EntryList
│       └── EntryCard    (preview, tags, timestamp, source, actions)
└── MemoryConfigPanel    (shown when sub-tab = config)
    ├── StorageLocationInput   (path picker + validation)
    ├── BackendTypeSelector    (file | sqlite | vector)
    ├── RetentionPolicyFields  (maxEntries, ttlDays)
    └── AutoInjectToggle
```

All panels use the existing design language (same card/form components as `WikiAdminPanel`).

---

### 4. Backend — Memory Config Handler
**New file:** `packages/coc-server/src/memory/memory-config-handler.ts`

- `MemoryConfig` interface: `{ storageDir, backend, maxEntries, ttlDays, autoInject }`
- Default: `storageDir = ~/.coc/memory`, `backend = 'file'`, `maxEntries = 10000`, `ttlDays = 90`, `autoInject = false`
- `readMemoryConfig(dataDir)` — reads `<dataDir>/memory-config.json`, falls back to defaults
- `writeMemoryConfig(dataDir, config)` — atomic write
- Route handlers: `handleGetMemoryConfig`, `handlePutMemoryConfig`

**File:** `packages/coc-server/src/memory/memory-routes.ts`
- `registerMemoryRoutes(routes, dataDir)` — registers GET/PUT config + entries CRUD

---

### 5. Backend — Memory Store
**New file:** `packages/coc-server/src/memory/memory-store.ts`

`MemoryEntry` interface:
```ts
interface MemoryEntry {
  id: string;          // nanoid
  content: string;
  summary?: string;    // AI-generated one-liner
  tags: string[];
  source: string;      // 'manual' | pipeline name | session id
  createdAt: string;   // ISO timestamp
  updatedAt: string;
  embedding?: number[]; // future: vector support
}
```

`FileMemoryStore` class (default backend):
- Stores entries as `<storageDir>/<id>.json`
- Index file `<storageDir>/index.json` for fast listing/search
- Methods: `list(query)`, `get(id)`, `create(entry)`, `update(id, patch)`, `delete(id)`
- Atomic writes throughout

---

### 6. Register Routes in coc-server Router
**File:** `packages/coc-server/src/router.ts`
- Import and call `registerMemoryRoutes(routes, dataDir)` in `createRequestHandler`.

---

### 7. Tests
**New files:**
- `packages/coc-server/src/memory/memory-config-handler.test.ts` — read/write/defaults
- `packages/coc-server/src/memory/memory-store.test.ts` — CRUD, search, index consistency
- `packages/coc-server/src/memory/memory-routes.test.ts` — HTTP handler unit tests

---

## Future / Out of Scope (this plan)

- Vector embedding backend (sqlite-vec / chromadb)
- Auto-inject middleware (attach relevant memories to AI prompt context)
- Memory creation from within pipeline runs (pipeline-core integration)
- Memory deduplication / merge
- Export/import memory archive
- Memory sharing across workspaces

---

## Notes

- Follow the `wiki-routes.ts` + `preferences-handler.ts` pattern for all backend code.
- Use `write-then-rename` atomic pattern for all file writes (see `preferences-handler.ts`).
- Use `lucide-react` `Brain` icon for Memory in navigation (already a dep).
- Sub-tab state lives in `AppContext` — same pattern as `activeWikiProjectTab`.
- The `storageDir` config field should validate that the path is writable before saving; show an inline error if not.
- The Config panel should show the resolved absolute path when a `~`-prefixed path is entered.
- Keep `MemoryView` lazy-loaded (same pattern as other views) to avoid bloating initial bundle.
