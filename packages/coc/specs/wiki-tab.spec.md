# Wiki Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Wiki (Top-Level Tab + embedded inside RepoDetail)  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Wiki tab.  
**Version:** 1.1.0

---

## 1. Overview

The **Wiki feature** manages AI-generated documentation wikis. It surfaces in two places:

- A top-level dashboard tab (`#wiki`), gated by `SHOW_WIKI_TAB` in `layout/TopBar.tsx`. It is **disabled by default** (`SHOW_WIKI_TAB = false`) — the top-level tab and bottom-nav row are hidden until the flag is flipped to `true`.
- An embedded view inside `RepoDetail` (`#repos/<repoId>/wiki`), where it shares the same registry + detail components but receives the `embedded` prop and an `onHashChange` callback so the surrounding repo shell drives the URL.

In both surfaces it shows a wiki registry (list view) for adding, editing, and deleting wikis, and a wiki detail view with four project tabs: **Browse** (component tree + articles), **Ask** (AI Q&A), **Graph** (component graph visualization), and **Admin** (generation pipeline, seeds, config, delete). Wikis are generated via the six-phase AI pipeline (see `references/deep-wiki.md`) and can be in `pending`, `generating`, `loaded`, or `error` states.

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Wiki` |
| Tab position | Top-level tab (gated by `SHOW_WIKI_TAB`; default `false`) and `RepoDetail` sub-tab (gated by `VISIBLE_SUB_TABS`) |
| Default tab | No |
| URL fragment | `#wiki` |
| Deep-link URLs | `#wiki/<wikiId>`, `#wiki/<wikiId>/<tab>` (for `tab` ∈ `ask` \| `graph` \| `admin`), `#wiki/<wikiId>/component/<componentId>` (Browse), `#wiki/<wikiId>/admin/<adminSubTab>` (for `adminSubTab` ∈ `seeds` \| `config` \| `delete`; `generate` is the default and uses `#wiki/<wikiId>/admin`) |
| Embedded inside repo | `#repos/<repoId>/wiki[...]` reuses the same hash schema with `<wikiId>` replaced by the repo's wiki id |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Documentation consumer** | Engineers reading generated wiki articles | Browse components, read articles, ask questions |
| **Wiki administrator** | Engineers managing wiki generation | Run generation pipeline, configure seeds, manage wikis |
| **Explorer** | Users discovering codebase structure | View component graph, explore relationships |

---

## 3. User Stories

### 3.1 Wiki Registry

**US-01 — Browse wikis**
> As a wiki administrator, I want to see all registered wikis.

- **Given** the Wiki tab is open
- **When** wikis exist
- **Then** a card list shows each wiki with: color dot, name, status badge (Ready/Generating/Error/Setup Required), component count, generation time, and shortened repo path

---

**US-02 — Add a wiki**
> As a wiki administrator, I want to register a new wiki for a repository.

- **Given** the wiki list is visible
- **When** the user clicks "+ Add Wiki"
- **Then** an `AddWikiDialog` opens for configuring the new wiki
- **When** the user confirms
- **Then** `POST /api/wikis` registers the wiki and the list refreshes

---

**US-03 — Edit a wiki**
> As a wiki administrator, I want to update a wiki's metadata.

- **Given** a wiki card is visible
- **When** the user clicks Edit
- **Then** an `EditWikiDialog` opens with current values

---

**US-04 — Delete a wiki**
> As a wiki administrator, I want to remove a wiki.

- **Given** a wiki card is visible
- **When** the user clicks Delete and confirms
- **Then** `DELETE /api/wikis/:wikiId` unregisters the wiki and removes it from the list

---

**US-05 — Navigate to wiki setup**
> As a wiki administrator, I want to set up a pending wiki.

- **Given** a wiki has "Setup Required" status
- **When** the user clicks "→ Setup"
- **Then** the wiki detail opens on the Admin tab

---

### 3.2 Wiki Detail — Browse

**US-06 — Browse wiki components**
> As a documentation consumer, I want to navigate the component tree and read articles.

- **Given** a wiki is selected and has a loaded graph
- **When** the Browse tab is active
- **Then** a `WikiComponentTree` appears in a responsive sidebar; clicking a component shows its article in the main area
- **When** no component is selected
- **Then** a `ProjectOverview` is shown

---

**US-07 — Deep-link to a component**
> As a documentation consumer sharing a link, I want a URL that opens a specific component.

- **Given** a URL of the form `#wiki/<wikiId>/component/<componentId>`
- **When** the user navigates to that URL
- **Then** the Browse tab opens with the specified component selected and its article displayed

---

### 3.3 Wiki Detail — Ask

**US-08 — Ask questions about the wiki**
> As a documentation consumer, I want to ask AI questions about the codebase using wiki context.

- **Given** a wiki is selected and loaded
- **When** the Ask tab is active
- **Then** a `WikiAsk` interface provides a conversational AI Q&A experience using TF-IDF context retrieval from the wiki data

---

### 3.4 Wiki Detail — Graph

**US-09 — Explore the component graph**
> As an explorer, I want to visualize component relationships.

- **Given** a wiki is selected and loaded
- **When** the Graph tab is active
- **Then** a `WikiGraph` visualization shows component nodes and their relationships
- **When** the user clicks a component node
- **Then** the view navigates to that component in the Browse tab

---

### 3.5 Wiki Detail — Admin

**US-10 — Run the generation pipeline**
> As a wiki administrator, I want to generate or regenerate wiki content.

- **Given** the Admin tab is active on the Generate sub-tab
- **When** the user clicks "Run All" or a per-phase "Run" button
- **Then** `POST .../admin/generate` starts generation with SSE streaming (logs, status, phase-complete, component-written, done/error events)
- **When** the user clicks "Abort"
- **Then** `POST .../admin/generate/cancel` cancels the generation

---

**US-11 — Configure seeds**
> As a wiki administrator, I want to manage discovery seeds.

- **Given** the Admin tab is active on the Seeds sub-tab
- **When** seeds are loaded
- **Then** a YAML editor shows current seeds; "Generate Seeds" triggers `POST .../admin/seeds/generate` with SSE; Save validates and persists via `PUT .../admin/seeds`

---

**US-12 — Configure wiki settings**
> As a wiki administrator, I want to manage wiki configuration.

- **Given** the Admin tab is active on the Config sub-tab
- **When** config is loaded
- **Then** a YAML editor shows current config; a default template is provided when missing; Save validates and persists via `PUT .../admin/config`

---

**US-13 — Delete a wiki from detail**
> As a wiki administrator, I want to delete the current wiki.

- **Given** the Admin tab is active on the Delete sub-tab
- **When** the user confirms deletion
- **Then** `DELETE /api/wikis/:wikiId` removes the wiki and navigates to `#wiki`

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Wiki List

| Feature | Acceptance Criteria |
|---|---|
| Wiki cards | Color dot, name, status badge, component count, generation time, repo path |
| Status badges | Ready (loaded), Generating (spinner), Error, Setup Required (pending) |
| "+ Add Wiki" | Opens add dialog; also shown in empty state |
| Edit / Delete | Per-card actions; stop propagation on click |
| Empty state | Large book emoji + copy + secondary "+ Add Wiki" button |

### 4.2 Wiki Detail — Top Bar

| Feature | Acceptance Criteria |
|---|---|
| Back button | Returns to `#wiki` list |
| Title | Color dot + wiki name |
| Status badge | Current wiki status |
| Sub-tabs | Browse, Ask, Graph, Admin |
| Generating state | Non-admin tabs disabled; auto-switches to Admin |

### 4.3 Wiki Detail — Browse

| Feature | Acceptance Criteria |
|---|---|
| Component tree | `WikiComponentTree` in `ResponsiveSidebar`; mobile: floating toggle (☰) |
| Article display | `WikiComponent` when component selected; `ProjectOverview` when none |
| Deep-link | Hash `#wiki/<id>/component/<componentId>` |

### 4.4 Wiki Detail — Ask

| Feature | Acceptance Criteria |
|---|---|
| AI Q&A | Conversational interface using wiki context |
| Session management | `DELETE .../ask/session/:sessionId` to clear |

### 4.5 Wiki Detail — Graph

| Feature | Acceptance Criteria |
|---|---|
| Visualization | Component nodes with relationships |
| Navigation | Click node navigates to Browse tab for that component |

### 4.6 Wiki Detail — Admin

| Feature | Acceptance Criteria |
|---|---|
| Sub-tabs | Generate, Seeds, Config, Delete (red styling) |
| Generate | SSE streaming; per-phase Run/Force; "Start from" phase 1–5; Run All / Force All; Abort; cache badges; metadata summary; phase 4 component list |
| Seeds | YAML editor; Generate Seeds (SSE); Save with validation |
| Config | YAML editor; default template when missing; Save with validation |
| Delete | Confirmation; navigates to list on success |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | Non-admin tabs are disabled while a wiki is in generating state |
| INV-02 | The view auto-switches to Admin when status becomes generating |
| INV-03 | Pending wikis without a graph show a setup message directing to Admin |
| INV-04 | Wiki registration requires an existing directory; `component-graph.json` is needed for loaded status |
| INV-05 | The `wikiAutoGenerate` flag is consumed once and cleared |
| INV-06 | Last-visited tab per wiki is restored from `wikiTabState` (except Browse which is default) |
| INV-07 | `SHOW_WIKI_TAB` controls visibility of the Wiki tab in the top bar, bottom nav, and the `RepoDetail` sub-tab list (`VISIBLE_SUB_TABS`); default value is `false` |
| INV-08 | When rendered embedded inside `RepoDetail` (`embedded` prop), `WikiDetail` does not write to global wiki state (`SET_WIKI_TAB`) and instead forwards URL changes via the `onHashChange` callback |
| INV-09 | The Admin sub-tab `generate` is the default and uses the bare `#wiki/<wikiId>/admin` URL; only `seeds`, `config`, `delete` produce `…/admin/<sub>` URLs |
| INV-10 | Selecting a component overrides the active tab — `#wiki/<wikiId>/component/<componentId>` always opens Browse with that component selected, regardless of the previously active tab |

---

## 6. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  CoC │ Processes │ Wiki* │ Memory │ Skills │ …                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Wikis                                              [+ Add Wiki]   │
│  ─────────────────────────────────────────────────────────────     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🔵 My Project Wiki          ● Ready    42 components       │   │
│  │    /Users/me/project         Generated 2h ago    [✏️] [🗑] │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ 🟢 Backend API              ◐ Generating…                  │   │
│  │    /Users/me/api                                  [✏️] [🗑] │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ 🟡 Frontend App             ○ Setup Required    [→ Setup]  │   │
│  │    /Users/me/frontend                             [✏️] [🗑] │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Wiki Detail:
┌─────────────────────────────────────────────────────────────────────┐
│  [← Back]  🔵 My Project Wiki  ● Ready                             │
│  [Browse*] [Ask] [Graph] [Admin]                                    │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  Components  │  # Authentication Module                            │
│  ──────────  │  ─────────────────────────────────────              │
│  📦 Auth     │                                                      │
│    🔧 JWT   │  The authentication module handles user login,      │
│    🔧 OAuth │  session management, and token validation…          │
│  📦 API     │                                                      │
│    🔧 Routes│  ## Architecture                                     │
│    🔧 Middle│  The module uses a layered architecture with…       │
│  📦 Database│                                                      │
│              │  ```mermaid                                          │
│              │  graph TD                                            │
│              │    A[Login] --> B[Validate]                          │
│              │  ```                                                 │
└──────────────┴──────────────────────────────────────────────────────┘
```

---

## 7. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Wiki list fetch failure | Empty list or error state |
| Wiki registration failure | Error in add dialog |
| Wiki deletion failure | Error in confirm dialog |
| Graph load failure (pending) | Setup message + "→ Run Setup Wizard" |
| Graph load failure (non-pending) | "No graph data available…" |
| Generation failure | Error event in SSE stream; shown in Admin Generate panel |
| Generation abort | Cancel acknowledged; status updated |
| Seeds/config save validation failure | Inline error in YAML editor |
| Ask session failure | Error in chat interface |

---

## 8. Empty State Specification

| State | Display |
|---|---|
| No wikis | Large book emoji + "No wikis yet" + "+ Add Wiki" button |
| No component selected (Browse) | `ProjectOverview` |
| Pending wiki without graph | Setup message directing to Admin |
| Generating wiki on non-admin tab | "Generation in progress… Switch to Admin to manage." |

---

## 9. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/wikis` | Wiki list | US-01 |
| `POST /api/wikis` | Register wiki | US-02 |
| `GET /api/wikis/:wikiId` | Wiki metadata | US-03 |
| `PATCH /api/wikis/:wikiId` | Edit wiki | US-03 |
| `DELETE /api/wikis/:wikiId` | Delete wiki | US-04, US-13 |
| `GET /api/wikis/:wikiId/graph` | Component graph | US-06, US-09 |
| `GET /api/wikis/:wikiId/components` | Component list | US-06 |
| `GET /api/wikis/:wikiId/components/:id` | Component article | US-06 |
| `GET /api/wikis/:wikiId/pages/:key` | Wiki pages | US-06 |
| `GET /api/wikis/:wikiId/themes` | Theme data | US-06 |
| `POST /api/wikis/:wikiId/ask` | AI Q&A | US-08 |
| `DELETE /api/wikis/:wikiId/ask/session/:sessionId` | Clear session | US-08 |
| `POST /api/wikis/:wikiId/explore/:componentId` | Component exploration | US-09 |
| `POST /api/wikis/:wikiId/admin/generate` | Run generation (SSE) | US-10 |
| `POST /api/wikis/:wikiId/admin/generate/cancel` | Abort generation | US-10 |
| `GET /api/wikis/:wikiId/admin/generate/status` | Generation status | US-10 |
| `GET/PUT /api/wikis/:wikiId/admin/seeds` | Seeds CRUD | US-11 |
| `POST /api/wikis/:wikiId/admin/seeds/generate` | Generate seeds (SSE) | US-11 |
| `GET/PUT /api/wikis/:wikiId/admin/config` | Config CRUD | US-12 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 1.1.0 | 2026-05-29 | Documented `SHOW_WIKI_TAB` default-off feature flag, embedded-mode rendering inside `RepoDetail` (`embedded` + `onHashChange`), exact deep-link format produced by `buildWikiHash` (e.g. `#wiki/<id>/admin/<sub>` only for non-default admin sub-tabs), and component deep-link override behavior. Added invariants INV-08…INV-10. |
