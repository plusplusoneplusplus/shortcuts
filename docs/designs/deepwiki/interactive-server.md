# Deep Wiki Interactive Server

## Overview

Extend Phase 5 of deep-wiki from a static HTML generator to an optional Node.js server that hosts the wiki with interactive exploration capabilities — similar to the real [DeepWiki](https://deepwiki.com/).

The static HTML generation remains the default. The server is an additive mode activated via `deep-wiki serve`.

## Motivation

The current static site works well for browsing, but lacks the interactive exploration that makes DeepWiki compelling:

1. **Ask questions** — users can ask natural-language questions about the codebase and get AI-generated answers grounded in the wiki content
2. **Explore relationships** — interactive dependency graph visualization with click-to-navigate
3. **Deep dive on demand** — drill into a module further without re-running the entire pipeline
4. **Live updates** — watch mode that re-generates articles when source files change

## Architecture

### High-Level Design
```
┌──────────────────────────────────────────────────────────┐
│  Browser (SPA)                                           │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐│
│  │ Wiki Viewer│  │  Ask AI    │  │ Dependency Graph    ││
│  │ (existing) │  │  Chat Panel│  │ (interactive, D3)   ││
│  └─────┬──────┘  └─────┬──────┘  └──────────┬──────────┘│
│        │               │                     │           │
│        └───────────────┼─────────────────────┘           │
│                        │  REST + WebSocket                │
└────────────────────────┼─────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────────┐
│  Node.js Server        │                                  │
│                        ▼                                  │
│  ┌──────────────────────────────────────────────────────┐│
│  │  HTTP Router (native http or express-like)           ││
│  │                                                      ││
│  │  GET  /                     → SPA shell              ││
│  │  GET  /api/graph            → module-graph.json      ││
│  │  GET  /api/modules/:id      → module markdown        ││
│  │  GET  /api/modules          → all modules list       ││
│  │  GET  /api/pages/:key       → special pages          ││
│  │  POST /api/ask              → AI Q&A (streaming SSE) ││
│  │  POST /api/explore/:id      → deep-dive a module     ││
│  │  WS   /ws                   → live reload + progress ││
│  └───────────┬────────────────────────┬─────────────────┘│
│              │                        │                   │
│  ┌───────────▼────────┐  ┌───────────▼─────────────────┐│
│  │  Wiki Data Layer   │  │  AI Service Layer           ││
│  │  (reads wiki dir)  │  │  (pipeline-core SDK)        ││
│  │                    │  │                              ││
│  │  • module-graph    │  │  • Q&A with RAG context     ││
│  │  • markdown files  │  │  • On-demand deep-dive      ││
│  │  • analyses cache  │  │  • Session pool reuse       ││
│  └────────────────────┘  └──────────────────────────────┘│
│                                                           │
│  ┌──────────────────────────────────────────────────────┐│
│  │  File Watcher (optional --watch mode)                ││
│  │  Watches repo → triggers incremental rebuild         ││
│  │  Notifies browser via WebSocket                      ││
│  └──────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
```

### Zero External Dependencies

The server uses only Node.js built-in modules (`http`, `fs`, `path`, `url`, `crypto`) and the existing `@plusplusoneplusplus/pipeline-core` dependency. No Express, no socket.io — keeping the package lightweight.

WebSocket is implemented via the `ws` library in noServer mode, attached to the `http` server.

## CLI Integration

### New Command: `deep-wiki serve`
```bash
# Serve a previously generated wiki
deep-wiki serve ./wiki --port 3000

# Generate + serve in one step
deep-wiki serve ./wiki --generate /path/to/repo

# Serve with file watching for live updates
deep-wiki serve ./wiki --generate /path/to/repo --watch

# Serve with AI features enabled (requires Copilot SDK)
deep-wiki serve ./wiki --ai

# All options
deep-wiki serve <wiki-dir> \
  --port <number>           # Default: 3000
  --host <address>          # Default: localhost
  --generate <repo-path>    # Generate wiki before serving
  --watch                   # Watch repo for changes (requires --generate)
  --ai                      # Enable AI Q&A and deep-dive features
  --model <model>           # AI model for Q&A (optional)
  --open                    # Open browser automatically
  --no-color                # Disable colored output
```

### Options
| Option | Description | Default |
| --- | --- | --- |
| `--port <n>` | Port to listen on | `3000` |
| `--host <addr>` | Bind address | `localhost` |
| `--generate <repo>` | Generate wiki before serving | — |
| `--watch` | Watch repo for changes, rebuild incrementally | `false` |
| `--ai` | Enable AI Q&A and deep-dive endpoints | `false` |
| `--model <model>` | AI model for Q&A sessions | SDK default |
| `--open` | Open browser on start | `false` |

## Feature Details

### 1. AI-Powered Q&A (Ask Panel)

The marquee feature. A chat panel where users ask questions about the codebase and get answers grounded in the wiki content.

**How it works:**
```
User question
     │
     ▼
┌─────────────────┐     ┌─────────────────────────┐
│  Context Builder │────▶│  Retrieve relevant       │
│                  │     │  modules + articles       │
│  1. Keyword      │     │  via keyword + embedding  │
│     extraction   │     │  similarity (TF-IDF)      │
│  2. Module ID    │     └────────────┬──────────────┘
│     matching     │                  │
│  3. Dependency   │                  ▼
│     expansion    │     ┌─────────────────────────┐
└──────────────────┘     │  Build prompt with       │
                         │  retrieved context        │
                         │  + module graph summary   │
                         └────────────┬──────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │  AI session via SDK      │
                         │  (session pool, no tools)│
                         │  Stream response via SSE │
                         └─────────────────────────┘
```

**Context retrieval strategy (simple TF-IDF, no vector DB):**

1. Tokenize the question into keywords
2. Score each module article by keyword overlap (TF-IDF on pre-indexed markdown)
3. Select top-K modules (default K=5) as context
4. Expand with 1-hop dependency neighbors if token budget allows
5. Include module graph summary for architectural context

**API:**
```
POST /api/ask
Content-Type: application/json

{
  "question": "How does authentication work?",
  "conversationId": "optional-for-multi-turn",
  "maxContext": 5
}

Response: SSE stream (text/event-stream)
data: {"type": "context", "modules": ["auth", "jwt", "middleware"]}
data: {"type": "chunk", "text": "The authentication system..."}
data: {"type": "chunk", "text": " uses JWT tokens..."}
data: {"type": "done", "references": [{"moduleId": "auth", "title": "Auth Module"}]}
```

**Conversation memory:** Multi-turn conversations are supported via `conversationId`. The server keeps a sliding window of the last 5 turns in memory (no persistence needed — conversations are ephemeral to the server session).

### 2. Interactive Dependency Graph

Replace the static Mermaid architecture diagram with a force-directed D3.js graph.

**Features:**
- Nodes = modules, colored by category, sized by complexity
- Edges = dependency relationships (directed arrows)
- Click a node → navigate to that module's article
- Hover → tooltip with module name, purpose, dependency count
- Zoom/pan with mouse wheel and drag
- Filter by category (toggle categories on/off)
- Highlight paths: click two nodes to show shortest dependency path
- Layout: force-directed (default), hierarchical (toggle)

**Implementation:** D3.js loaded from CDN (same pattern as mermaid/highlight.js). Graph data comes from `/api/graph` (which is just `module-graph.json`). All rendering is client-side.

**Data shape** (already available in `ModuleGraph`):
```typescript
// Nodes: moduleGraph.modules (id, name, category, complexity, path)
// Edges: moduleGraph.modules[i].dependencies → array of module IDs
```

### 3. On-Demand Deep Dive

When a user wants more detail on a module than the generated article provides, they can trigger an on-demand deep dive that creates a new, more detailed analysis.
```
POST /api/explore/:moduleId
Content-Type: application/json

{
  "question": "How does the retry logic work in the HTTP client?",
  "depth": "deep"
}

Response: SSE stream
data: {"type": "status", "message": "Analyzing http-client module..."}
data: {"type": "chunk", "text": "## Retry Logic\n\nThe HTTP client implements..."}
data: {"type": "done"}
```

**How it works:**
1. Server loads the module's existing analysis from cache
2. Creates a focused prompt combining the user's question + existing analysis + module graph context
3. Launches a direct AI session with MCP tools (read-only: `view`, `grep`, `glob`) against the repo
4. Streams the response back to the browser

**Requirements:**
- `--generate <repo-path>` must have been provided (server needs repo access for MCP tools)
- `--ai` flag must be enabled
- Uses direct sessions (`usePool: false`) for MCP tool access

### 4. Live Reload (Watch Mode)

When `--watch` is enabled, the server monitors the repository for changes and incrementally rebuilds affected modules.

**Implementation:**
1. `fs.watch` (recursive) on the repo path
2. On file change, debounce 2 seconds, then:
   a. Determine which modules are affected (using `cache/git-utils.ts` change detection)
   b. Re-run Phase 3 (analysis) for affected modules only
   c. Re-run Phase 4 (writing) for affected modules
   d. Notify browser via WebSocket: `{ type: "reload", modules: ["auth", "config"] }`
3. Browser refreshes the current view if it's showing an affected module

**WebSocket messages:**
```typescript
// Server → Client
{ type: "reload", modules: string[] }        // Modules were updated
{ type: "rebuilding", modules: string[] }    // Rebuild in progress
{ type: "error", message: string }           // Rebuild failed

// Client → Server
{ type: "ping" }                             // Keep-alive
```

## Frontend Changes

### SPA Shell

The server serves a modified version of the existing `index.html` template. Key differences:
| Aspect | Static Site | Server Mode |
| --- | --- | --- |
| Data loading | Embedded `<script>` with all data | Fetched via `/api/*` endpoints |
| Navigation | Hash-based (`#module-auth`) | Hash-based (same, no server routing needed) |
| Ask panel | Not present | Slide-out panel on the right |
| Dependency graph | Mermaid in architecture page | Dedicated interactive D3 view |
| Deep dive | Not available | Button on each module page |
| Theme/search | Same | Same |

### New UI Components

**Ask Panel** (right slide-out):
```
┌─────────────────────────────────────────────────────┐
│ Content Area                          │ Ask Panel   │
│                                       │             │
│  [Module Article]                     │ ┌─────────┐ │
│                                       │ │ Chat    │ │
│                                       │ │ history │ │
│                                       │ │         │ │
│                                       │ │         │ │
│                                       │ │         │ │
│                                       │ ├─────────┤ │
│                                       │ │ Input   │ │
│                                       │ │ [Ask..] │ │
│                                       │ └─────────┘ │
└─────────────────────────────────────────────────────┘
```

**Dependency Graph View:**
- Accessible via a "Graph" nav item in the sidebar (below Architecture)
- Full-width SVG canvas with D3 force layout
- Category legend with toggle checkboxes
- Module info tooltip on hover

**Deep Dive Button:**
- Appears at the top of each module article: `[🔍 Explore Further]`
- Opens a modal/inline section with a text input
- Streams AI response below the input

## File Structure
```
src/
├── server/
│   ├── index.ts              # createServer() + serve command wiring
│   ├── router.ts             # HTTP request routing (static + API)
│   ├── api-handlers.ts       # /api/* endpoint handlers
│   ├── websocket.ts          # WebSocket upgrade + message handling
│   ├── wiki-data.ts          # Read/cache wiki data from disk
│   ├── context-builder.ts    # TF-IDF indexing + context retrieval for Q&A
│   ├── ask-service.ts        # AI Q&A orchestration (prompt building + SDK)
│   ├── explore-service.ts    # On-demand deep-dive orchestration
│   ├── file-watcher.ts       # fs.watch wrapper for --watch mode
│   └── spa-template.ts       # Modified HTML template for server mode
├── writing/
│   ├── website-generator.ts  # (unchanged — static site generation)
│   └── ...
└── ...
```

## Implementation Phases

### Phase A: Basic Server + API

Serve the wiki over HTTP with data loaded via API calls instead of embedded `<script>`.

- [x] `deep-wiki serve` command in CLI
- [x] HTTP server with static file serving
- [x] REST endpoints: `/api/graph`, `/api/modules`, `/api/modules/:id`, `/api/pages/:key`
- [x] Modified SPA template that fetches data from API
- [x] `--port`, `--host`, `--open` options
- [x] `--generate` option to run generation before serving

### Phase B: Interactive Dependency Graph

- [x] D3.js force-directed graph component (client-side)
- [x] "Graph" sidebar nav item
- [x] Node click → navigate to module
- [x] Category filter toggles
- [x] Zoom/pan controls

### Phase C: AI Q&A

- [x] TF-IDF indexer for module articles (server-side, built on startup)
- [x] Context builder (retrieve relevant modules for a question)
- [x] `POST /api/ask` with SSE streaming
- [x] Ask panel UI (slide-out chat)
- [x] Multi-turn conversation support
- [x] `--ai` flag gating

### Phase D: Deep Dive + Watch Mode

- [x] `POST /api/explore/:id` with SSE streaming
- [x] Deep-dive button on module pages
- [x] WebSocket server for live reload
- [x] File watcher with debounced incremental rebuild
- [x] `--watch` flag

## Design Decisions

### Why not a separate package?

The server is tightly coupled to the wiki data format (`ModuleGraph`, `ModuleAnalysis`, markdown files) and the AI invocation layer (`pipeline-core` SDK). Keeping it in the `deep-wiki` package avoids duplication and ensures type safety.

### Why native `http` instead of Express?

The server has ~6 routes. Express would add a dependency for minimal benefit. The native `http` module with a simple router function is sufficient and keeps the package dependency-free (beyond `pipeline-core` and `commander`).

### Why TF-IDF instead of vector embeddings for Q&A context?

1. **No additional dependencies** — TF-IDF is trivial to implement (~100 lines)
2. **No embedding model required** — works offline, no API calls for indexing
3. **Good enough** — with typically 10-50 modules, even keyword matching finds the right context
4. **Upgrade path** — can swap in embeddings later if needed, the `ContextBuilder` interface stays the same

### Why SSE instead of WebSocket for AI responses?

SSE (Server-Sent Events) is simpler for unidirectional streaming (server → client). It works over regular HTTP, has automatic reconnection, and doesn't require a WebSocket library. WebSocket is only used for the bidirectional live-reload channel.

### Static site remains the default

`deep-wiki generate` still produces `index.html` + `embedded-data.js` as before. The server is an optional mode. Users who just want to generate and host on GitHub Pages, Netlify, etc. are unaffected.

## API Reference

### `GET /api/graph`
Returns the full `ModuleGraph` JSON.

### `GET /api/modules`
Returns a list of module summaries: `{ id, name, category, complexity, path, purpose }[]`.

### `GET /api/modules/:id`
Returns `{ module: ModuleInfo, markdown: string, analysis?: ModuleAnalysis }`.

### `GET /api/pages/:key`
Returns `{ key: string, title: string, markdown: string }` for special pages (`index`, `architecture`, `getting-started`).

### `POST /api/ask` (requires `--ai`)
Request: `{ question: string, conversationId?: string, maxContext?: number }`
Response: SSE stream with `context`, `chunk`, and `done` events.

### `POST /api/explore/:id` (requires `--ai` + `--generate`)
Request: `{ question?: string, depth?: 'normal' | 'deep' }`
Response: SSE stream with `status`, `chunk`, and `done` events.

### `WS /ws` (when `--watch` is enabled)
Bidirectional WebSocket for live reload notifications.
