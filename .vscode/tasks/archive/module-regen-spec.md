# UX Spec: Regenerate Article for a Specific Module (Phase 4)

## User Story

**As a** wiki maintainer browsing the generated wiki,
**I want to** regenerate the article for a single module without re-running the entire Writing phase,
**so that** I can quickly fix or improve one module's documentation while keeping everything else intact.

### Problem

Phase 4 (Writing) regenerates articles for **all** modules in parallel. If one module's article is unsatisfactory — poorly structured, missing details, or stale after an analysis update — the user must either re-run the full phase (expensive, slow) or manually edit the markdown (loses regeneration capability). There's no way to surgically regenerate just one article.

### Why This Works Per-Module

Phase 4 module articles are **independently generated** — each article is produced from a single `ModuleAnalysis` + a simplified module graph, with no cross-dependencies between articles. This makes single-module regeneration architecturally clean: same prompt, same AI call, just scoped to one module.

---

## Entry Points

| Entry Point | Location | Trigger |
|---|---|---|
| **Module detail page → "Regenerate" button** | Module content header, next to existing source files section | Primary — user is reading a module article |
| **Admin Generate tab → per-module action** | Phase 4 card expanded module list | Secondary — user is managing generation |
| **API** | `POST /api/admin/generate/module/:moduleId` | Programmatic |

---

## User Flow

### Primary Flow: Regenerate from Module Page

1. **User is reading a module article** (e.g., `#module/auth-core`)
2. **A "Regenerate Article" button** (🔄) appears in the module page header, next to the source files section
   - Button is only visible when the server has a repo path (generation capability)
3. **User clicks "Regenerate Article"**
4. **Confirmation popover** appears:
   > Regenerate the article for **Auth Core**?
   > This will replace the current article with a freshly generated one.
   >
   > `[Cancel]` `[Regenerate]`
5. **Regeneration starts:**
   - Button transitions to a spinner state: "Regenerating…"
   - The article content area shows a subtle loading overlay (semi-transparent, preserving the old content underneath so the user can still read it)
6. **SSE stream** delivers progress:
   - `{"type":"status","message":"Generating article for auth-core..."}`
   - `{"type":"log","message":"Sending to AI model..."}`
   - `{"type":"done","success":true,"duration":8200}`
7. **Completion:**
   - ✅ **Success**: Article content smoothly transitions to the new version. Brief toast: "Article regenerated in 8s". Cache updated.
   - ❌ **Failure**: Toast with error message. Old article remains unchanged. Button returns to normal state.
8. **Sidebar and wiki data refresh** — `wikiData.reload()` ensures the new article is reflected everywhere

### Secondary Flow: Regenerate from Admin Generate Tab

_(Builds on the Phase Regeneration spec — adds module-level granularity to the Phase 4 card)_

1. **User is on the Admin → Generate tab**
2. **Phase 4 (Writing) card** has an expandable **module list** below the phase description
3. **User expands the module list** → sees all modules with their article cache status:
   ```
   ④ Writing — Generate wiki articles          ✓ Cached    [Run]
   ┌─────────────────────────────────────────────────────┐
   │  ▸ Modules (12)                                     │
   │    ┌──────────────────────────────────────────────┐ │
   │    │ ✓ auth-core          Auth Core        [Run]  │ │
   │    │ ✓ api-gateway        API Gateway      [Run]  │ │
   │    │ ⚠ database-client    Database Client  [Run]  │ │
   │    │ ✗ event-bus          Event Bus        [Run]  │ │
   │    │ ...                                          │ │
   │    └──────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────┘
   ```
4. **Each module row** shows:
   - Cache status badge (✓ / ⚠ / ✗)
   - Module ID and display name
   - Individual **"Run"** button
5. **User clicks "Run"** on a specific module → same SSE progress flow as the primary entry point
6. **Log area** appears inline below that module row

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| **No repo path** | "Regenerate" button hidden on module page. Admin Generate tab shows disabled state with explanation. |
| **No analysis cached for module** | Button disabled with tooltip: "Module analysis not found. Run Phase 3 (Analysis) first." Show disabled state in admin module list too. |
| **Another generation running** | "Regenerate" button disabled with tooltip: "A generation is already in progress." |
| **Module not in graph** | Should not happen (module page wouldn't exist), but API returns 404. |
| **AI timeout** | Same retry logic as full Phase 4 — retry once with doubled timeout. If still fails, show error and preserve old article. |
| **Article unchanged** | If AI produces identical content, still update cache timestamp. Toast: "Article regenerated (no changes)." |
| **Hierarchical layout (areas)** | Regenerating a module article does NOT re-run the area-level reduce. Toast includes hint: "Area summary may need updating — run Phase 4 to refresh." |
| **Browser navigates away mid-regeneration** | Generation completes server-side. On return to module page, latest article is shown (from cache/disk). |

---

## Visual Design

### Module Page — Regenerate Button

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Auth Core                                    [🔄 Regen] │
│                                                          │
│  ▸ Relevant source files (3)                             │
│                                                          │
│  ┌─ Article Content ───────────────────────────────────┐ │
│  │                                                     │ │
│  │  ## Overview                                        │ │
│  │  Auth Core provides OAuth2 and JWT authentication...│ │
│  │                                                     │ │
│  │  ## Architecture                                    │ │
│  │  ...                                                │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Button States

| State | Visual |
|---|---|
| **Default** | Subtle secondary button: `🔄 Regenerate` — uses `var(--code-bg)` background, `var(--content-text)` text, matching existing admin button styles |
| **Hover** | Slightly highlighted: `var(--sidebar-hover)` background |
| **Running** | Spinner icon + "Regenerating…" text, disabled. Matches `.ask-message-typing` animation style |
| **Success** | Brief green flash, then returns to default |
| **Disabled** | Grayed out with `cursor: not-allowed`, tooltip explains reason |
| **Hidden** | Not rendered when server has no generation capability |

### Loading Overlay (During Regeneration)

```
┌─ Article Content ──────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────┐ │
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ │
│ │░░  ## Overview                                   ░░│ │
│ │░░  Auth Core provides OAuth2 and JWT...          ░░│ │
│ │░░                                                ░░│ │
│ │░░  ◌ Regenerating article...                     ░░│ │
│ │░░                                                ░░│ │
│ │░░  ## Architecture                               ░░│ │
│ │░░  ...                                           ░░│ │
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```
- Semi-transparent overlay (`rgba(var(--content-bg-rgb), 0.7)`) over existing content
- Centered spinner + "Regenerating article…" text
- Old content remains visible but dimmed — user can still read/scroll

### Admin Generate Tab — Module List Within Phase 4

```
┌─ ④ Writing ────────────────────────────── [Run All] ──┐
│  Generate wiki articles                    ✓ Cached    │
│                                                        │
│  ▾ Modules (12)                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ✓  auth-core         Auth Core           [Run]   │  │
│  │ ✓  api-gateway       API Gateway         [Run]   │  │
│  │ ⚠  database-client   Database Client     [Run]   │  │
│  │    ┌─ Log ─────────────────────────────────────┐ │  │
│  │    │ Regenerating article...                   │ │  │
│  │    │ Sending to AI model...                    │ │  │
│  │    └───────────────────────────────────────────┘ │  │
│  │ ✗  event-bus         Event Bus           [Run]   │  │
│  │ ✓  http-server       HTTP Server         [Run]   │  │
│  │ ...                                              │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- Module list is **collapsible** (▸/▾ toggle) — collapsed by default to keep the phase card compact
- Each row has its own [Run] button and cache badge
- Running module shows inline log area (same streaming pattern)
- "Run All" at the phase level runs the full Phase 4 (existing behavior)

---

## API Design

### `POST /api/admin/generate/module/:moduleId`

Regenerate the article for a single module.

**Request:**
```json
{
  "force": false
}
```

**Response:** SSE stream
```
data: {"type":"status","state":"running","moduleId":"auth-core","message":"Generating article for Auth Core..."}
data: {"type":"log","message":"Building prompt from analysis..."}
data: {"type":"log","message":"Sending to AI model..."}
data: {"type":"done","success":true,"moduleId":"auth-core","duration":8200,"message":"Article regenerated"}
```

**Error responses:**
- `404` — Module not found in graph
- `409` — Another generation is in progress
- `412` — No analysis cached for this module (prerequisite missing)
- `503` — No repo path configured (generation unavailable)

### `GET /api/admin/generate/status` (Extended)

Add per-module article cache status to the existing phase status endpoint.

**Response (extended):**
```json
{
  "running": false,
  "currentModule": null,
  "phases": {
    "1": { "cached": true, "timestamp": "2026-02-14T10:00:00Z" },
    "4": {
      "cached": true,
      "timestamp": "2026-02-14T10:05:00Z",
      "modules": {
        "auth-core": { "cached": true, "timestamp": "2026-02-14T10:05:00Z" },
        "api-gateway": { "cached": true, "timestamp": "2026-02-14T10:05:01Z" },
        "database-client": { "cached": false },
        "event-bus": { "cached": false }
      }
    }
  },
  "repoPath": "/path/to/repo",
  "available": true
}
```

---

## Server-Side Implementation Notes

### Single-Module Regeneration Logic

The handler needs to:

1. **Load prerequisites** from cache/memory:
   - `ModuleGraph` — from `wikiData.graph` (already in memory)
   - `ModuleAnalysis` for the target module — from `wikiData.getModuleDetail(moduleId).analysis` or from analysis cache on disk
2. **Build the prompt** — reuse `analysisToPromptItem()` + `buildModuleArticlePromptTemplate(depth)`
3. **Invoke AI** — single AI call (not the full map-reduce executor), using the same `aiInvoker` / `aiSendMessage` function available to the server
4. **Save result:**
   - Update article cache via `saveArticle(moduleId, article, outputDir, gitHash)`
   - Write markdown file to disk via `writeFileSync` at the correct path
5. **Reload wiki data** — call `wikiData.reload()` so the served wiki reflects the change
6. **Broadcast WebSocket refresh** — tell connected browsers to reload

### Key Reuse Points

| Component | Reuse From |
|---|---|
| Prompt building | `analysisToPromptItem()` from `writing/article-executor.ts` |
| Prompt template | `buildModuleArticlePromptTemplate(depth)` from `writing/prompts.ts` |
| Article caching | `saveArticle()` from `cache/article-cache.ts` |
| File writing | `getArticleFilePath()` from `writing/file-writer.ts` |
| SSE streaming | `sendSSE()` from `server/ask-handler.ts` |
| AI invocation | `aiSendMessage` already available in server handler context |

### What This Does NOT Do

- **Does not re-run Analysis** (Phase 3) — uses the existing cached analysis
- **Does not re-run Reduce** — area-level and project-level pages (index, architecture, getting-started) are not affected
- **Does not invalidate other modules** — only the target module's article is replaced
- **Does not update the module graph** — the graph structure remains unchanged

---

## Relationship to Phase Regeneration Spec

This spec **extends** the Phase Regeneration spec (plan.md) by adding module-level granularity:

| Scope | Spec | Behavior |
|---|---|---|
| Full phase | Phase Regeneration (plan.md) | Run all of Phase 4 — all modules + reduce |
| Single module | **This spec** | Run Phase 4 for one module only — no reduce |
| Phase range | Phase Regeneration (plan.md) | Run phases 3→5 sequentially |

The two specs share:
- Same Admin Generate tab UI (this spec adds the expandable module list to the Phase 4 card)
- Same SSE streaming infrastructure
- Same generation mutex (one operation at a time)
- Same `/api/admin/generate/status` endpoint (this spec extends the response)

---

## Discoverability

1. **Module page button** — the primary entry point. Users naturally want to regenerate while reading a bad article
2. **Admin module list** — discoverable when expanding the Phase 4 card in the Generate tab
3. **Tooltip on hover** — "Regenerate this module's article using the latest analysis"
4. **Disabled state hints** — when prerequisites are missing, tooltips explain what to do ("Run Analysis first")
