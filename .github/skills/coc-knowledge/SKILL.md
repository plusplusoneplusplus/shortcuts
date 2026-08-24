---
name: coc-knowledge
description: >-
  Comprehensive reference for CoC (Copilot of Copilot) architecture — server,
  memory system, LLM tools, SDK wrapper, process store, workflow engine, deep-wiki,
  and dashboard SPA. Use whenever the user asks anything related to CoC (Copilot of
  Copilot), forge, deep-wiki, coc-client, the CoC server, dashboard, workflow engine,
  memory system, LLM tools, process store, or any of their subsystems. Also use
  whenever you need background knowledge to answer a question, plan a change, or
  ground your reasoning in this codebase — read the relevant reference file(s) under
  `references/` before responding. Use when building, modifying, debugging, or
  explaining CoC features, or when understanding how subsystems interact.
---

# CoC Codebase Knowledge

CoC is a standalone Node.js CLI + HTTP server for executing YAML-based AI workflows.
It consists of three packages (`coc`, `forge`, `deep-wiki`) plus a shared client library (`coc-client`).

## Architecture Index

| Domain | Reference | Summary |
|--------|-----------|---------|
| Monorepo | [monorepo.md](references/monorepo.md) | Cross-package layout, build/test commands, changesets release flow, shared conventions |
| Server Architecture | [server-architecture.md](references/server-architecture.md) | Module layout, feature domains, route registration, config schema |
| Admin Config | [admin-config.md](references/admin-config.md) | `ADMIN_CONFIG_FIELDS` registry, admin REST surface, admin UI styling (`admin-redesign.css`) |
| MCP Settings | [mcp-settings.md](references/mcp-settings.md) | Workspace MCP merge (global + workspace), allow-list, secrets boundary |
| EnDev xDPU | [endev.md](references/endev.md) | Workspace eligibility cache, REST status/revalidate, skill surfacing |
| CoC Service (Windows) | [coc-service.md](references/coc-service.md) | `Manage-CoCService.ps1` Task Scheduler service, devtunnel integration, logs |
| Ralph | [ralph.md](references/ralph.md) | Iterative execution session journal, writer protocol, size cap, promote-to-ralph endpoint |
| Cron | [cron.md](references/cron.md) | Recurring follow-ups, executor, circuit breakers, REST API, dashboard integration |
| Memory System | [memory-system.md](references/memory-system.md) | Bounded memory, capture mode, candidate ranking, promotion, recall index |
| LLM Tools | [llm-tools.md](references/llm-tools.md) | Tool registry, per-invocation factories, permissions, web search |
| SDK Wrapper | [sdk-wrapper.md](references/sdk-wrapper.md) | `coc-agent-sdk` package: Copilot + Codex providers, `ISDKService`, `SDKServiceRegistry`, session lifecycle, streaming state machine, MCP config, model registry |
| Process Store | [process-store.md](references/process-store.md) | SQLite schema, FTS5 search, seen-state, pin/archive, prompt autocomplete |
| Workflow Engine | [workflow-engine.md](references/workflow-engine.md) | DAG executor, compiler, node types, concurrency, skill resolution |
| Deep Wiki | [deep-wiki.md](references/deep-wiki.md) | Six-phase pipeline, caching, themes, CLI commands, core concepts |
| REST API | [rest-api.md](references/rest-api.md) | Endpoint catalog organized by domain |
| Streaming & Real-Time | [streaming-architecture.md](references/streaming-architecture.md) | SSE, WebSocket, ProcessStore event channels, container relay |
| Dashboard SPA · Shell | [spa/shell.md](references/spa/shell.md) | Entry point, module tree, routing, contexts, hooks, pop-outs, feature flags, coc-client |
| Dashboard SPA · Chat | [spa/chat.md](references/spa/chat.md) | Conversation rendering, chat lens, chat list grouping, tool calls, input area, canvas |
| Dashboard SPA · Work Items | [spa/work-items.md](references/spa/work-items.md) | Hierarchy tree, Local/Remote trackers, detail form, workflow + AI authoring gates |
| Dashboard SPA · Git & PRs | [spa/git-and-prs.md](references/spa/git-and-prs.md) | Composer PR chips, CI auto-fix triggers, classify-diff, worktree controls, PR tab |
| Dashboard SPA · Notes | [spa/notes.md](references/spa/notes.md) | Notes roots, editor toolbar, inline colors, find & replace, Notes Chat |
| Dashboard SPA · Top Bar & Admin | [spa/top-bar-and-admin.md](references/spa/top-bar-and-admin.md) | Top bar cluster, admin overlay dialog, Skills Config, remote-first shell |
| Dashboard SPA · Routes | [spa/routes.md](references/spa/routes.md) | Onboarding, My Work Today, Activity, Dreams, CLI Sessions, Memory |
| Prompt Autocomplete | [prompt-autocomplete.md](references/prompt-autocomplete.md) | Inline ghost-text, AI/history modes, caching, REST API, privacy |
| Chat Prompt History | [chat-prompt-history.md](references/chat-prompt-history.md) | Up/Down arrow navigation, workspace-scoped history, REST API |
| Wiki Serving | [wiki-serving.md](references/wiki-serving.md) | WikiManager, TF-IDF context retrieval, AI Q&A sessions, file watching |
| Remote Servers | [remote-servers.md](references/remote-servers.md) | DevTunnel integration, connection lifecycle, server registry |
| Task Comments | [task-comments.md](references/task-comments.md) | Inline commenting, categories, anchoring, AI prompt generation |
| Notes Sync | [sync.md](references/sync.md) | Git-backed My Work/My Life sync, AI conflict resolution, periodic scheduling |

## Writing Rules

These are constraints on anyone editing this knowledge base, including automated
refreshes. The KB grew from 4009 to 7484 lines in three months without a single new
file being created, because entries were appended as change descriptions instead of
being rewritten in place. These rules exist to stop that.

1. **Present tense only, current state only.** Describe what the code does now. Never
   write "no longer", "used to", "previously", "legacy", "instead of the old", or
   "there is no". If behavior changed, rewrite the passage — do not append a
   correction to it. The one exception: when a live feature flag still selects an
   older path, state it as a present-tense conditional ("with `commitChatLens` off,
   commit review uses the `coc.commitChat.open` visibility key"), not as history.
2. **One topic, one home.** Before adding a passage, grep the target file for the key
   identifier and for near-duplicate headings. If the topic already has a section,
   edit that section. Cross-reference from elsewhere; never describe it twice.
3. **Architecture, not release notes.** Keep module boundaries, data flow, invariants,
   storage keys, API shapes, and non-obvious constraints. Cut pixel-level and
   copy-level behavior — which control is hover-revealed, whether a banner renders,
   exact button wording. Nothing guards those, so they go stale silently.
4. **No walls of text.** Cap paragraphs at ~80 words and give every topic a `###`
   heading. This is what makes a duplicate visible to the next person appending, and
   what makes `git diff` on these files reviewable.
5. **400-line file cap.** A reference file over ~400 lines, or covering more than one
   product surface, gets split into a subdirectory (see `references/spa/` for the
   pattern) with one index row per new file.

Run `scripts/audit-paths.sh` quarterly to find backticked source paths that no longer
resolve.

## Key Invariants

- **Multi-repo required** — never design a feature that breaks multi-repo scenarios
- **No session caching** — `coc-agent-sdk` must NEVER add keep-alive or session-object caching
- **File paths in prompts** — prefer file path references over expanding file content inline
- **Session-per-request** — each `sendMessage()` spawns its own `CopilotClient` process
- **Repo-scoped data** — all per-repo runtime data lives under `~/.coc/repos/<workspaceId>/`

## Build & Test

```bash
npm run build:packages    # Build all packages (forge, coc, deep-wiki, coc-client, coc-agent-sdk)
npm run test:run          # Vitest (in any package dir)
cd packages/coc && npm run build && npm link  # Debug CoC locally
```

## Instructions

When working on CoC features:
1. Identify which domain(s) the change touches using the Architecture Index above
2. Read the relevant reference file(s) for detailed module layout and conventions
3. Follow existing patterns in the target domain (executor pattern, handler pattern, etc.)
4. Ensure multi-repo compatibility — test with multiple workspace registrations
5. For memory system changes, understand the bounded→capture→promotion pipeline
6. For SDK changes, respect the session-per-request isolation boundary
