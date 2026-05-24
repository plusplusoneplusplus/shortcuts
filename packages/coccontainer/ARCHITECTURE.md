# CoCContainer Architecture

CoCContainer is a lightweight gateway that aggregates multiple CoC agents behind a single endpoint, serving the CoC dashboard SPA and proxying all API calls to the appropriate agent.

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CoC AGENTS (1..N)                                   │
│                                                                             │
│  Each agent runs independently with its own processes, workspaces, and API  │
│  • HTTP REST API: /api/processes, /api/workspaces, /api/queue, etc.         │
│  • WebSocket /ws: emits process-updated, process-created events             │
│  • SSE /api/events: global event stream (chat streaming)                    │
│  • SSE /processes/:id/stream: per-process content streaming                 │
└──────┬──────────────────────────────┬──────────────────────┬────────────────┘
       │                              │                      │
       │ HTTP (REST)                  │ WebSocket /ws        │ SSE (streaming)
       │                              │                      │
       ▼                              ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COC CONTAINER                                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      WS RELAY ENGINE                                   │  │
│  │                                                                       │  │
│  │  Ingests process lifecycle events from agents via WebSocket,          │  │
│  │  then dispatches to all subscribers.                                  │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────┐     │  │
│  │  │  WS Relay (ws-relay.ts)                                      │     │  │
│  │  │  • Connects to each agent's /ws                              │     │  │
│  │  │  • Receives: process-updated, process-created                │     │  │
│  │  │  • emit('message') to all subscribers                        │     │  │
│  │  └──────────────────────────┬──────────────────────────────────┘     │  │
│  │                             │                                         │  │
│  │                     DISPATCH TO SUBSCRIBERS                            │  │
│  │                             │                                         │  │
│  └─────────────────────────────┼─────────────────────────────────────────┘  │
│                                │                                            │
│              ┌─────────────────┼──────────────────┐                         │
│              ▼                 ▼                   ▼                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                │
│  │  Web Client     │  │  Teams Bridge   │  │  WhatsApp      │                │
│  │  (via WS)       │  │  (subscriber)   │  │  Bridge        │                │
│  │                 │  │                 │  │  (subscriber)  │                │
│  │  Browser opens  │  │  On completion: │  │  Same pattern  │                │
│  │  container /ws  │  │  fetch process, │  │  as Teams      │                │
│  │  for process    │  │  send last      │  │                │                │
│  │  list updates   │  │  chunk to Teams │  │                │                │
│  └────────┬────────┘  └───────┬─────────┘  └───────┬────────┘                │
│           │                   │                     │                        │
│  ┌────────┴───────────────────┴─────────────────────┴─────────────────────┐  │
│  │  HTTP Proxy (http.ts) — transparent proxy to agents for REST + SSE     │  │
│  │  • REST: /api/* (processes, workspaces, queue, chat)                   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  SSE Relay (transparent proxy)                                        │   │
│  │  • Browser ↔ CoC agent direct connection (container just routes)      │   │
│  │  • /api/events: global chat streaming                                 │   │
│  │  • /processes/:id/stream: per-process content streaming               │   │
│  │  • No buffering, no dispatching to bridges                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Tunnel Bridge                │  │  Health Monitor                      │  │
│  │  Local proxy for devtunnel    │  │  Periodic health checks              │  │
│  │  agents (auth + port mapping) │  │  Updates agent online/offline status │  │
│  └───────────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  SPA (CoC Dashboard in containerMode)                                 │   │
│  │  • Reuses CoC's compiled HTML template                                │   │
│  │  • Served at / for all non-API routes                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
       │                    │                     │
       │ HTTP + WS + SSE    │ MCP Transport       │ Baileys
       ▼                    ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Browser     │    │  Microsoft   │    │  WhatsApp        │
│              │    │  Teams       │    │                  │
│  • WS: live  │    │              │    │  • Final message │
│    updates   │    │  • Final msg │    │    only          │
│  • SSE: chat │    │    only      │    │                  │
│    streaming │    │              │    │                  │
│  (direct to  │    │              │    │                  │
│   agent)     │    │              │    │                  │
└──────────────┘    └──────────────┘    └──────────────────┘
```

## WS Relay Engine

The WS relay engine is the core event dispatch mechanism for process lifecycle events. It ingests events from all connected agents via WebSocket and dispatches them to subscribers:

| Ingress | Component | What it receives |
|---------|-----------|-----------------|
| WebSocket `/ws` | WS Relay | `process-updated`, `process-created` events |

| Subscriber | How it connects | What it does with events |
|------------|----------------|------------------------|
| **Browser** | Opens container `/ws` (WebSocket) | Real-time sidebar/process list updates |
| **Teams Bridge** | `wsRelay.on('message')` | On completion: fetch process, send last chunk |
| **WhatsApp Bridge** | `wsRelay.on('message')` | Same pattern as Teams |

## SSE Relay (Transparent Proxy)

The SSE relay is a **transparent proxy** — it builds a direct connection between the browser client and the CoC agent. The container only handles routing (selecting the correct agent) and adds auth headers. It does NOT:
- Buffer or parse SSE events
- Dispatch events to messaging bridges
- Store any streamed content

```
Browser opens: /api/agent/:agentId/processes/:id/stream
  → Container routes to correct agent (transparent proxy)
  → Agent streams: conversation-snapshot, chunk, tool-start, tool-complete, done
  → Browser receives directly, renders content in real-time
```

The browser uses SSE for chat content streaming while using WebSocket (via WS relay) for process list/sidebar updates. These are two separate concerns:
- **WS relay**: process lifecycle events → dispatched to all subscribers (browser, bridges)
- **SSE relay**: chat content streaming → direct browser ↔ agent connection (no bridges involved)

## Conversation Turn Storage & Timeline Chunks

Each assistant response in a CoC process is stored as a single **conversation turn** row in SQLite (`conversation_turns` table):

| Column | Type | Description |
|--------|------|-------------|
| `content` | TEXT | Full concatenated text of all content chunks |
| `tool_calls` | JSON | Array of tool call objects |
| `timeline` | JSON | Ordered array of `TimelineItem` events preserving chunk boundaries |

### TimelineItem structure

```typescript
type TimelineItem =
  | { type: 'content'; content: string }       // one text chunk
  | { type: 'tool-start'; toolCall: {...} }    // tool invocation started
  | { type: 'tool-complete'; toolCall: {...} } // tool invocation finished
  | { type: 'tool-failed'; toolCall: {...} }   // tool invocation failed
```

### How chunks relate to turns

During streaming, the agent emits multiple `chunk` SSE events for a single assistant turn. Each chunk becomes one `{ type: 'content', content: '...' }` entry in the `timeline` array. After streaming completes:

- **`content`** = concatenation of all content chunks (what the user reads in full)
- **`timeline`** = ordered interleaving of content + tool events (preserves structure)

### Reconstructing individual chunks from stored data

To recover the N separate "messages" (chunks) from a completed turn:

```typescript
const chunks = turn.timeline
  .filter(item => item.type === 'content')
  .map(item => item.content);
// chunks.length === N (e.g., 16 for the "16 messages" shown in the UI)
```

The dashboard SPA uses this to display "84 tool calls · 16 messages" in collapsed turn headers — it counts timeline items by type.

### Teams/WhatsApp bridge: last chunk only

When delivering to external platforms, the bridge extracts only the **last** content chunk:

```typescript
const contentChunks = extractTimelineContentChunks(lastTurn.timeline);
const lastChunk = contentChunks[contentChunks.length - 1];
// Send only lastChunk to Teams/WhatsApp
```

This is the final prose after all tool calls — the actionable answer. Intermediate chunks are reasoning between tool executions and not useful to the external recipient. Falls back to full `content` when timeline is unavailable or has ≤1 items.

## Message Dispatch (Outbound — Agent → Consumers)

```
Agent completes task execution
       │
       ▼ emits process-updated (status=completed) via WebSocket
       │
  WS Relay receives, dispatches to subscribers
       │
       ├──→ Browser (via container /ws): updates process list/sidebar
       │
       ├──→ Teams Bridge:
       │      • "completed" → fetch full process via REST
       │      • Extract last timeline chunk → send to Teams
       │
       └──→ WhatsApp Bridge: same as Teams

Meanwhile (streaming, independent path):
  Agent streams chunks via SSE /processes/:id/stream
       │
       └──→ Browser (transparent proxy, direct connection)
            Renders content in real-time during execution
```

## Message Dispatch (Inbound — External → Agent)

```
External message arrives (Teams / WhatsApp / Browser)
       │
       ▼
  Bridge/Browser → HTTP POST /api/workspaces/:wsId/chat
       │
       ▼ (via Container HTTP Proxy)
       │
  Agent creates new process or follows up on existing one
```

## Module Responsibilities

| Module | File | Purpose |
|--------|------|---------|
| **WS Relay** | `proxy/ws-relay.ts` | Connects to agent `/ws`, dispatches lifecycle events to subscribers |
| **SSE Relay** | `proxy/sse-relay.ts` | Transparent proxy: browser ↔ agent SSE streaming |
| **HTTP Proxy** | `proxy/http.ts` | Transparent proxy for REST calls |
| **Tunnel Bridge** | `proxy/tunnel-bridge.ts` | Local proxy for devtunnel agents (auth + port) |
| **Health Monitor** | `server/health-monitor.ts` | Periodic agent health checks |
| **Agent Store** | `store/agent-store.ts` | Persists agent registry |
| **Teams Bridge** | `messaging/teams-bridge.ts` | WS relay subscriber → Teams (last chunk only) |
| **WhatsApp Bridge** | `messaging/whatsapp-bridge.ts` | WS relay subscriber → WhatsApp (last chunk only) |
| **Messaging Store** | `messaging/messaging-store.ts` | SQLite store for sent/received messages |
| **Server** | `server/index.ts` | HTTP server, SPA, routes, orchestration |

## Design Principles

- **WS relay for lifecycle**: Process lifecycle events (created/updated/completed) flow through the WS relay to all subscribers
- **SSE as transparent proxy**: Chat content streaming is a direct browser ↔ agent connection; container only routes
- **Thin gateway**: Container has no business logic — aggregates, proxies, dispatches
- **Multi-agent**: All components handle N agents simultaneously
- **Final-only messaging**: External platforms receive only the last content chunk, not intermediate streaming updates
- **Two separate concerns**: WS relay (lifecycle dispatch) and SSE relay (content streaming) serve different purposes and never cross
