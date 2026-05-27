# CoCContainer Architecture

CoCContainer is a lightweight gateway that aggregates multiple CoC agents behind a single endpoint, serving the CoC dashboard SPA and proxying all API calls to the appropriate agent.

## High-Level Diagram

```
                              ┌──────────────────────────────────────────────────┐
                              │              CoCContainer Server                  │
                              │                                                  │
                              │  ┌────────────────────────────────────────────┐  │
                              │  │              AgentManager                   │  │
                              │  │  (unified agent connection manager)         │  │
                              │  │                                            │  │◄──WS call-home──► CoC Agent 1
                              │  │  • Call-home: handleConnection()           │  │                   CoC Agent 2
                              │  │  • Outbound:  connectOutbound()            │  │◄──WS outbound──► CoC Agent 3
                              │  │  • HTTP proxy: proxyRequest()              │  │                   ...
                              │  │  • WS send:   sendOutbound()               │  │
                              │  │  • Query:     listAgents(), hasAgent()      │  │
                              │  └──────────────────────┬─────────────────────┘  │
                              │                         ↕                        │
                              │  ┌──────────────────────┴─────────────────────┐  │
                              │  │       WSRelay (central bidirectional bus)    │  │
                              │  │                                            │  │
                              │  │  Agent → Bridges:                          │  │
                              │  │    .emit('message') / .on('message')       │  │
                              │  │                                            │  │
                              │  │  Bridges → Agent:                          │  │
                              │  │    .proxyToAgent() — HTTP request proxy    │  │
                              │  │    .sendToAgent()  — raw WS message        │  │
                              │  └───────┬──────────────────────┬─────────────┘  │
                              │          ↕                      ↕                │
                              │  ┌───────┴──────────┐  ┌───────┴──────────────┐  │
                              │  │ WebClientBridge   │  │    TeamsBridge       │  │
                              │  │                   │  │                      │  │
 Web Browser  ◄───HTTP/WS────►│  │ • Manages browser │  │ • TeamsBot           │  │◄──MCP poll──► MS Teams
 (Dashboard)                  │  │   WS connections  │  │   (poll/send)        │  │
                              │  │ • Events → browser│  │ • Events → Teams     │  │
                              │  │ • Browser msgs    │  │ • Chat msgs          │  │
                              │  │   → sendToAgent() │  │   → proxyToAgent()   │  │
                              │  └───────────────────┘  │                      │  │
                              │                         │  /commands            │  │
                              │                         │       │              │  │
                              │                         │       ▼              │  │
                              │                         │  TeamsCommand        │  │
                              │                         │  Executor            │  │
                              │                         │  (local, no agent)   │  │
                              │                         └──────────────────────┘  │
                              │                                                  │
                              │  Also: SSE Relay, Tunnel Bridge, Health Monitor, │
                              │  Agent Store, SPA, HTTP Proxy                    │
                              └──────────────────────────────────────────────────┘
```

## Message Flows

| Flow | Path |
|------|------|
| **Browser chat → Agent** | Browser → WebClientBridge → `wsRelay.sendToAgent()` → AgentManager → Agent |
| **Agent event → Browser** | Agent → AgentManager → `wsRelay.emit('message')` → WebClientBridge → Browser |
| **Teams chat → Agent** | Teams → TeamsBot.poll() → TeamsBridge → `wsRelay.proxyToAgent()` → AgentManager → Agent |
| **Agent response → Teams** | Agent → AgentManager → `wsRelay.emit('message')` → TeamsBridge → TeamsBot.send() → Teams |
| **Teams /command** | Teams → TeamsBot.poll() → TeamsBridge → TeamsCommandExecutor (local) → TeamsBot.send() → Teams |

## Core Components

### AgentManager (`inbound/agent-manager.ts`)

Unified manager for all agent connections. Handles both connection modes:

- **Call-home agents**: Agents connect outbound to the container via `handleConnection()`. Container sends requests back over the same WS channel using `proxyRequest()`.
- **Outbound agents**: Container connects to agents via `connectOutbound()`. Raw WS messages sent via `sendOutbound()`.

Both modes emit `agent-event` which is wired to WSRelay in `server/index.ts`.

### WSRelay (`proxy/ws-relay.ts`)

Central bidirectional event bus. All inter-component communication goes through WSRelay:

- **Agent → Bridges** (outbound events): `wsRelay.emit('message', ...)` — bridges subscribe with `.on('message')`
- **Bridges → Agent** (inbound messages): bridges call `wsRelay.proxyToAgent()` (HTTP proxy) or `wsRelay.sendToAgent()` (raw WS) — WSRelay delegates to AgentManager

WSRelay does NOT manage any agent connections — that is AgentManager's job.

### WebClientBridge (`proxy/webclient-bridge.ts`)

Manages browser WebSocket connections. Symmetric to TeamsBridge:

- Subscribes to `wsRelay.on('message')` for agent→browser event forwarding
- Routes browser→agent WS messages via `wsRelay.sendToAgent()`

### TeamsBridge (`messaging/teams-bridge.ts`)

Manages MS Teams integration via TeamsBot (MCP poll transport):

- Subscribes to `wsRelay.on('message')` for agent→Teams event forwarding
- Routes chat messages to agents via `wsRelay.proxyToAgent()` (HTTP proxy)
- Intercepts `/` commands before they reach WSRelay — executes locally via TeamsCommandExecutor

### TeamsCommandExecutor (`messaging/teams-command-executor.ts`)

Handles slash commands locally without touching agents or WSRelay:

| Command | Action |
|---------|--------|
| `/list agents` | Lists connected agents from AgentManager |
| `/list repos` | Lists repos across all agents |
| `/select repo <n>` | Sets target repo for subsequent chats |
| `/list topics` | Lists recent chat processes |
| `/create topic` | Clears topic selection (next msg creates new) |
| `/select topic <n>` | Selects active topic for follow-ups |
| `/help` | Shows available commands |

Per-user state (selected agent, repo, topic) tracked in memory.

## SSE Relay (Transparent Proxy)

The SSE relay is a **transparent proxy** — it builds a direct connection between the browser client and the CoC agent. The container only handles routing (selecting the correct agent). It does NOT dispatch events to messaging bridges.

```
Browser opens: /api/agent/:agentId/processes/:id/stream
  → Container routes to correct agent (transparent proxy)
  → Agent streams: conversation-snapshot, chunk, tool-start, tool-complete, done
  → Browser receives directly, renders content in real-time
```

Two separate concerns:
- **WSRelay**: process lifecycle events — bidirectional bus between all components
- **SSE relay**: chat content streaming — direct browser ↔ agent (no bridges involved)

## Conversation Turn Storage & Timeline Chunks

Each assistant response in a CoC process is stored as a single **conversation turn** row in SQLite (`conversation_turns` table):

| Column | Type | Description |
|--------|------|-------------|
| `content` | TEXT | Full concatenated text of all content chunks |
| `tool_calls` | JSON | Array of tool call objects |
| `timeline` | JSON | Ordered array of `TimelineItem` events preserving chunk boundaries |

### Teams/WhatsApp bridge: last chunk only

When delivering to external platforms, the bridge extracts only the **last** content chunk:

```typescript
const contentChunks = extractTimelineContentChunks(lastTurn.timeline);
const lastChunk = contentChunks[contentChunks.length - 1];
```

This is the final prose after all tool calls. Intermediate chunks are reasoning between tool executions.

## Module Responsibilities

| Module | File | Purpose |
|--------|------|---------|
| **AgentManager** | `inbound/agent-manager.ts` | All agent connections (call-home + outbound), HTTP proxy, WS send |
| **WSRelay** | `proxy/ws-relay.ts` | Central bidirectional event bus |
| **WebClientBridge** | `proxy/webclient-bridge.ts` | Browser WS client management |
| **SSE Relay** | `proxy/sse-relay.ts` | Transparent proxy: browser ↔ agent SSE streaming |
| **HTTP Proxy** | `proxy/http.ts` | Transparent proxy for REST calls |
| **Tunnel Bridge** | `proxy/tunnel-bridge.ts` | Local proxy for devtunnel agents (auth + port) |
| **Health Monitor** | `server/health-monitor.ts` | Periodic agent health checks |
| **Agent Store** | `store/agent-store.ts` | Persists agent registry |
| **TeamsBridge** | `messaging/teams-bridge.ts` | WSRelay subscriber → Teams (chat + events) |
| **TeamsCommandExecutor** | `messaging/teams-command-executor.ts` | Local `/command` execution |
| **WhatsApp Bridge** | `messaging/whatsapp-bridge.ts` | WSRelay subscriber → WhatsApp |
| **Messaging Store** | `messaging/messaging-store.ts` | SQLite store for sent/received messages |
| **Server** | `server/index.ts` | HTTP server, SPA, routes, component wiring |

## Design Principles

- **WSRelay as central bus**: All inter-component communication flows through WSRelay — no component talks directly to another
- **AgentManager owns connections**: Single manager for all agent connection types (call-home + outbound)
- **Bridges are symmetric**: WebClientBridge and TeamsBridge follow the same pattern (subscribe + send via WSRelay)
- **Commands execute locally**: `/` commands never touch agents or WSRelay — handled entirely by TeamsCommandExecutor
- **SSE as transparent proxy**: Chat content streaming is a direct browser ↔ agent connection; container only routes
- **Thin gateway**: Container has minimal business logic — aggregates, proxies, dispatches
- **Multi-agent**: All components handle N agents simultaneously
- **Final-only messaging**: External platforms receive only the last content chunk, not intermediate streaming updates
