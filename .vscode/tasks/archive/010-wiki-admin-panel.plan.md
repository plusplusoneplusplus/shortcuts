---
status: pending
---

# 010: Port Wiki Admin Panel to Wiki Tab

## Summary
Port the admin panel (seeds management, config editing, wiki regeneration with progress streaming) from deep-wiki SPA into the CoC Wiki tab. The deep-wiki admin panel is a full-page overlay with three sub-tabs (Seeds, Config, Generate); in CoC it becomes an inline panel within the wiki view, scoped to the currently selected wiki.

## Motivation
Admin features allow users to manage wiki configuration, edit discovery seeds, and trigger regeneration — essential for maintaining wikis over time. Without these, users must fall back to CLI commands to update or regenerate a wiki.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki-admin.ts` — Admin panel logic (ported from deep-wiki `client/admin.ts`)

### Files to Modify
- `packages/coc/src/server/spa/client/wiki.ts` — Add admin panel toggle button and overlay container; call `showWikiAdmin(wikiId)` on toggle; hide admin when switching wikis
- `packages/coc/src/server/spa/client/styles.css` — Add admin panel styles (see §CSS below)
- `packages/coc/src/server/api-handler.ts` — Register admin routes scoped to wiki: `GET/PUT /api/wikis/:wikiId/admin/seeds`, `GET/PUT /api/wikis/:wikiId/admin/config`, `POST /api/wikis/:wikiId/admin/generate`, `POST /api/wikis/:wikiId/admin/generate/cancel`, `GET /api/wikis/:wikiId/admin/generate/status`, `POST /api/wikis/:wikiId/admin/generate/component/:componentId`

### Files to Delete
- (none)

## Source Analysis

### deep-wiki `client/admin.ts` — Three Feature Areas

**1. Seeds Editor (JSON)**
- `loadAdminSeeds()` — `GET /api/admin/seeds` → response `{ exists, content, path, raw? }`; populates `<textarea id="seeds-editor">`; stores original text in `adminSeedsOriginal` for reset
- Save: parses textarea as JSON (`JSON.parse`), shows "Invalid JSON" on failure; `PUT /api/admin/seeds` with `{ content: parsedObject }`; response `{ success, path }` or `{ error }`
- Reset: restores `adminSeedsOriginal` into textarea
- Status display: `<span id="seeds-status">` with `.success` / `.error` class

**2. Config Editor (YAML)**
- `loadAdminConfig()` — `GET /api/admin/config` → response `{ exists, content (raw YAML string), path }`; populates `<textarea id="config-editor">`
- Save: sends raw text (no client-side YAML validation); `PUT /api/admin/config` with `{ content: text }`
- Reset / status display: same pattern as seeds

**3. Generate Tab (Phase-based SSE)**
- `loadGenerateStatus()` — `GET /api/admin/generate/status` → `{ available, running, currentPhase?, phases: { "1"..`"5": { cached, timestamp?, components? } } }`
  - If `!available`: shows "Generation requires a repository path" warning, hides controls
  - Updates cache badges per phase (`Cached` / `None`)
  - Phase 4 exposes per-component cache status via `renderPhase4ComponentList(components)`
- Individual phase run: `POST /api/admin/generate` with `{ startPhase, endPhase, force }`
  - Returns SSE stream; events: `status`, `log`, `progress`, `phase-complete`, `error`, `done`
  - SSE `status` → sets phase card to running state with pulse animation
  - SSE `progress` → appends `Progress: current/total` to phase log
  - SSE `phase-complete` → sets card to success/error, shows duration via `formatDuration(ms)`
  - SSE `done` → updates status bar (success green / error red)
  - 409 → "Generation already in progress"
- Cancel: `POST /api/admin/generate/cancel`; swaps Run button to Cancel while running
- Range run: select start/end phase from dropdowns, validates end ≥ start
- Force checkbox: `<input id="generate-force">` — passed to POST body
- Per-component regen (Phase 4): `POST /api/admin/generate/component/:componentId` with `{ force }`; same SSE pattern, inline log per component row

### UI Structure (from `spa-template.ts` lines 104–249)
```
div#admin-page.admin-page.hidden
├── div.admin-page-header
│   ├── h1 "Admin Portal" + button#admin-back "← Back to Wiki"
│   └── p.admin-page-desc
├── div.admin-tabs
│   ├── button.admin-tab[data-tab=seeds] (active)
│   ├── button.admin-tab[data-tab=config]
│   └── button.admin-tab[data-tab=generate]
├── div.admin-body
│   ├── div#admin-content-seeds.admin-tab-content.active
│   │   └── span#seeds-path + span#seeds-status + textarea#seeds-editor + Save/Reset btns
│   ├── div#admin-content-config.admin-tab-content
│   │   └── span#config-path + span#config-status + textarea#config-editor + Save/Reset btns
│   └── div#admin-content-generate.admin-tab-content
│       ├── div#generate-unavailable.hidden — warning when no repo path
│       ├── div#generate-controls
│       │   ├── checkbox#generate-force "Force (ignore cache)"
│       │   └── div.generate-phases — 5 × phase cards:
│       │       └── div#phase-card-{1..5}.generate-phase-card
│       │           ├── span.phase-number + span.phase-name + span.phase-desc
│       │           ├── span#phase-cache-{n}.phase-cache-badge
│       │           ├── button#phase-run-{n} "Run"
│       │           └── div#phase-log-{n}.phase-log.hidden
│       │       (Phase 4 card also has):
│       │           ├── button#phase4-component-toggle (expandable)
│       │           └── div#phase4-component-list — per-component rows with Run buttons
│       ├── div.generate-range-controls
│       │   └── select#generate-start-phase + select#generate-end-phase + button#generate-run-range
│       └── div#generate-status-bar.generate-status-bar.hidden
└── (end)
```

### Sidebar Integration
- `showAdminContent()` hides `#content-scroll`, `#sidebar`, `#ask-widget`; shows `#admin-page`
- `showWikiContent()` reverses this (called on "← Back to Wiki")
- Toggle button: `<button id="admin-toggle">⚙</button>` in top bar

## Implementation Notes

### URL Adaptation
All fetch calls must be scoped to the selected wiki:
| deep-wiki route | CoC route |
|---|---|
| `GET /api/admin/seeds` | `GET /api/wikis/:wikiId/admin/seeds` |
| `PUT /api/admin/seeds` | `PUT /api/wikis/:wikiId/admin/seeds` |
| `GET /api/admin/config` | `GET /api/wikis/:wikiId/admin/config` |
| `PUT /api/admin/config` | `PUT /api/wikis/:wikiId/admin/config` |
| `POST /api/admin/generate` | `POST /api/wikis/:wikiId/admin/generate` |
| `POST /api/admin/generate/cancel` | `POST /api/wikis/:wikiId/admin/generate/cancel` |
| `GET /api/admin/generate/status` | `GET /api/wikis/:wikiId/admin/generate/status` |
| `POST /api/admin/generate/component/:cid` | `POST /api/wikis/:wikiId/admin/generate/component/:cid` |

All `fetch()` calls in `wiki-admin.ts` should use `fetchApi()` from `core.ts` (the CoC pattern) rather than raw `fetch()`, with the wikiId interpolated into the path.

### State Management
- Module-level state: `adminSeedsOriginal`, `adminConfigOriginal`, `generateRunning`, `adminInitialized` — must be reset when switching to a different wiki (`resetAdminState()`).
- The `wikiId` parameter must be threaded through `showWikiAdmin(wikiId)`, `loadAdminSeeds(wikiId)`, `loadAdminConfig(wikiId)`, `loadGenerateStatus(wikiId)`, `runPhaseGeneration(wikiId, start, end)`, `cancelGeneration(wikiId)`, `runComponentRegenFromAdmin(wikiId, componentId)`.

### Presentation Differences from deep-wiki
- **No full-page takeover**: In CoC, the admin panel renders inside the wiki view container (not a separate page). Use a collapsible panel or overlay within `#view-wiki` rather than hiding sidebar/content.
- **No `#admin-toggle` in top bar**: Instead, add a gear/settings button in the wiki view's toolbar (next to wiki selector). The button is only visible when a wiki is selected.
- **No browser history manipulation**: deep-wiki pushes `#admin` to history; CoC doesn't use hash routing for sub-views within a tab.
- **Import `componentGraph` from wiki module** instead of deep-wiki `core.ts` for Phase 4 component name resolution.

### CSS
Port admin styles from deep-wiki `styles.css` lines 852–1157. Key class groups:
- `.admin-page`, `.admin-page-header`, `.admin-page-title`, `.admin-btn-back` — container & header
- `.admin-tabs`, `.admin-tab`, `.admin-tab-content` — sub-tab switching
- `.admin-section`, `.admin-file-info`, `.admin-file-path`, `.admin-file-status` — editor chrome
- `.admin-editor` — monospace textarea (400px min-height, code-bg, 13px font)
- `.admin-actions`, `.admin-btn`, `.admin-btn-save`, `.admin-btn-reset` — action buttons
- `.generate-phase-card`, `.phase-card-header`, `.phase-number`, `.phase-info`, `.phase-name`, `.phase-desc` — phase cards
- `.phase-cache-badge` (`.cached` / `.stale` / `.missing`) — cache status
- `.phase-running` + `@keyframes phase-pulse`, `.phase-success`, `.phase-error` — card states
- `.phase-log`, `.phase-run-btn` — phase log output
- `.generate-options`, `.generate-force-label`, `.generate-range-controls` — generate controls
- `.generate-status-bar` (`.success` / `.error` / `.hidden`) — overall status
- `.phase-component-list-toggle`, `.phase-component-list`, `.phase-component-row`, `.phase-component-badge`, `.phase-component-id`, `.phase-component-name`, `.phase-component-run-btn`, `.phase-component-log` — Phase 4 component list

Prefix or namespace if needed to avoid conflicts with existing CoC styles.

### SSE Streaming Pattern
The generate tab uses `fetch()` with `response.body.getReader()` to process SSE events (not `EventSource`). This is the same pattern already used elsewhere in CoC for process streaming. The event types are:
- `status` — `{ type, phase, state, message }` → update phase card
- `log` — `{ type, phase?, message }` → append to phase log
- `progress` — `{ type, phase, current, total }` → append progress line
- `phase-complete` — `{ type, phase, success, duration?, message }` → success/error card state
- `error` — `{ type, phase?, message }` → error card state + status bar
- `done` — `{ type, success, duration?, error? }` → final status bar update

### Key Functions to Port
| deep-wiki function | CoC function | Notes |
|---|---|---|
| `showAdmin(skipHistory?)` | `showWikiAdmin(wikiId)` | No history push; takes wikiId |
| `setupAdminListeners()` | Inlined into wiki.ts toggle | Button lives in wiki toolbar |
| `initAdminEvents()` | `initAdminEvents(wikiId)` | Tab switching + save/reset |
| `initGenerateEvents()` | `initGenerateEvents(wikiId)` | Phase buttons + range run |
| `initPhase4ComponentList()` | `initPhase4ComponentList()` | Toggle expand/collapse |
| `loadAdminSeeds()` | `loadAdminSeeds(wikiId)` | URL: `/api/wikis/${wikiId}/admin/seeds` |
| `loadAdminConfig()` | `loadAdminConfig(wikiId)` | URL: `/api/wikis/${wikiId}/admin/config` |
| `loadGenerateStatus()` | `loadGenerateStatus(wikiId)` | URL: `/api/wikis/${wikiId}/admin/generate/status` |
| `runPhaseGeneration(start, end)` | `runPhaseGeneration(wikiId, start, end)` | SSE via fetch reader |
| `cancelGeneration()` | `cancelGeneration(wikiId)` | URL: `/api/wikis/${wikiId}/admin/generate/cancel` |
| `runComponentRegenFromAdmin(cid)` | `runComponentRegenFromAdmin(wikiId, cid)` | Per-component SSE |
| `handleGenerateEvent(event, bar)` | `handleGenerateEvent(event, bar)` | Unchanged logic |
| `formatDuration(ms)` | `formatDuration(ms)` | Pure utility, copy as-is |
| `setAdminStatus(which, msg, err)` | `setAdminStatus(which, msg, err)` | DOM helper, copy as-is |
| `setPhaseCardState(phase, state, msg)` | `setPhaseCardState(phase, state, msg)` | DOM helper, copy as-is |
| `appendPhaseLog(phase, msg)` | `appendPhaseLog(phase, msg)` | DOM helper, copy as-is |
| `renderPhase4ComponentList(comps)` | `renderPhase4ComponentList(comps)` | Uses componentGraph for names |

### HTML Generation
The admin panel HTML is currently inline in `spa-template.ts`. For CoC, generate it dynamically in `wiki-admin.ts` via a `renderAdminPanel(): string` function that returns the HTML block, inserted into the wiki view container. This avoids polluting the main SPA template with wiki-specific HTML.

## Tests
- Test admin panel renders within wiki view when toggle is clicked
- Test seeds load populates textarea from API response
- Test seeds save validates JSON before sending PUT
- Test seeds reset restores original content
- Test config load populates textarea
- Test config save sends raw YAML string
- Test config reset restores original content
- Test generate status loads and updates cache badges
- Test phase run button triggers POST and processes SSE events
- Test cancel button sends cancel POST
- Test range validation (end ≥ start)
- Test component regen triggers per-component SSE
- Test admin state resets when switching to different wiki
- Test admin panel only accessible when a wiki is selected
- Test URL routing includes wikiId in all API calls

## Acceptance Criteria
- [ ] Admin panel accessible from wiki tab via gear/settings button
- [ ] Admin panel only visible when a wiki is selected
- [ ] Seeds editor loads and saves seeds.json via wikiId-scoped API
- [ ] Seeds editor validates JSON before save, shows error on invalid JSON
- [ ] Config editor loads and saves deep-wiki.config.yaml via wikiId-scoped API
- [ ] Save/Reset buttons work for both seeds and config
- [ ] Status indicators show success/error feedback
- [ ] Generate tab shows phase cards with cache badges
- [ ] Individual phase Run buttons trigger generation with SSE progress
- [ ] Phase cards animate (pulse) during running state
- [ ] Phase logs show real-time SSE output
- [ ] Cancel button stops running generation
- [ ] Range run validates end ≥ start and triggers multi-phase generation
- [ ] Force checkbox passes `force: true` to API
- [ ] Phase 4 component list shows per-component cache status with Run buttons
- [ ] Per-component regeneration works with inline log
- [ ] "Generation unavailable" warning when no repo path
- [ ] `formatDuration()` correctly formats ms/s/m
- [ ] Admin state resets when switching wiki selection
- [ ] URLs correctly scoped to selected wikiId
- [ ] CoC build succeeds (`npm run build` in packages/coc)

## Dependencies
- Depends on: 006 (Wiki tab scaffold — provides the wiki view container, wiki selector, and `view-wiki` element)
