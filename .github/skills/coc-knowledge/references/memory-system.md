# Memory System

SQLite-backed durable facts and episodes that let AI chat sessions learn from past
interactions. Facts are written through the `save_memory` tool, retrieved through
`recall_memory`, and a frozen high-importance snapshot is injected into the system
prompt for prefix-cache stability.

The implementation is the `@plusplusoneplusplus/coc-memory` package; `packages/coc`
owns the executor addon, the REST routes, and the dashboard UI.

## Storage layout

| Scope | Location | Gate |
|---|---|---|
| Global | `~/.coc/<GLOBAL_MEMORY_SUBDIR>/` | `globalPrefs.memoryV2.enabled` |
| Workspace | `~/.coc/repos/<workspaceId>/<WORKSPACE_MEMORY_SUBDIR>/` | `repoPrefs.memoryV2.enabled` |

The two scopes are **independent**, not alternatives — both can be on, and the addon
reads facts from every enabled scope. `createMemoryStores(dir)`
(`coc-memory/src/store-impl/store-factory.ts`) creates the directory and opens
`facts.db` and `episodes.db` inside it, returning a handle with a `close()`.

## coc-memory package

`packages/coc-memory/src/`:

| Module | Role |
|---|---|
| `types.ts` | `MemoryFact`, `MemoryEpisode`, `MemoryScope`, `MemoryFactStatus`, search/filter types, and the `GLOBAL_MEMORY_SUBDIR` / `WORKSPACE_MEMORY_SUBDIR` constants |
| `store-interface.ts` | `IMemoryFactStore`, `IMemoryEpisodeStore`, `MemoryStoreHandle` |
| `store-impl/` | `SqliteFactStore`, `SqliteEpisodeStore`, and `createMemoryStores` |
| `hybrid-search.ts` | `HybridSearchEngine` — the recall query path |
| `embedding-provider.ts`, `embedding-indexer.ts`, `vector-ranker.ts` | Embedding abstraction and vector ranking behind the hybrid search |
| `safety-scanner.ts` | **Canonical** `scanMemoryContent`, `redactSensitiveValues`, `SECURITY_PATTERNS_DESCRIPTION` |
| `capture-service.ts`, `extraction-contract.ts` | Capture pipeline and the `IMemoryExtractor` contract |
| `scope-resolver.ts` | Scope resolution helpers |

`packages/forge/src/memory/` keeps only what forge itself needs: `types.ts`
(`RepoInfo`, `GitRemoteInfo`, `MemoryLevel`), `repo-hash.ts` (`computeRepoHash`, a
stable 16-char hex hash for repository paths), `base-file-store.ts`, and
`memory-security-scanner.ts` — compatibility re-exports of the canonical scanner.
**Do not fork the threat patterns into forge; extend `safety-scanner.ts`.** It blocks
prompt injection, exfiltration, SSH persistence, CoC-env access, credential literals
(API keys, Bearer/Basic tokens, password assignments, connection strings), and
invisible Unicode.

## Facts and episodes

A fact carries scope (`global` or `workspace`), status (`active`, `review`,
`rejected`, `archived`), importance, confidence, tags, source metadata, and optional
source process and turn links. An episode summarizes a completed interaction and links
back to its source process or Ralph context.

## Executor integration

`buildMemoryV2Addon(dataDir, workspaceId, query?, processId?)` in
`executors/memory-v2-addon.ts` returns a `MemoryV2Addon`:

```ts
{
  systemMessageSuffix: string | undefined,  // frozen snapshot + per-turn recall block
  tools: Tool<any>[],                       // save_memory + recall_memory
  suffix: string,                           // tool guidance for the system message
  excludedBuiltinTools: string[],           // Copilot built-ins to suppress
  dispose: () => void,                      // closes open stores; idempotent
}
```

It reads `readGlobalPreferences(dataDir)` and `readRepoPreferences(dataDir,
workspaceId)`, opens a store per enabled scope, lists `status: 'active'` facts up to
`frozenSnapshotLimit` (default 10) from each, and — when `query` is non-empty — runs a
`HybridSearchEngine` search up to `recallLimit` (default 5) for the per-turn recall
block. Passing no `query` yields the frozen snapshot only. Both limits read
`globalPrefs` first, then `repoPrefs`, then the default.

It returns a frozen `EMPTY_ADDON` when `dataDir` or `workspaceId` is missing, when
neither scope is enabled, or when **any** error occurs during store initialization or
fact retrieval — memory never fails a turn.

### Turn assembly

`buildChatTurnContext()` in `executors/chat-turn-context-builder.ts` is the preferred
integration point for every executor path. It is the single assembly point for tools,
tool guidance, Memory V2, SDK built-in exclusions, ask-user handles, and disposal, and
calls `buildMemoryV2Addon()` internally — callers never wire the addon themselves.

It returns `excludedTools: ['vote_memory', 'store_memory']` when Memory V2 is active,
suppressing the Copilot SDK built-ins that would otherwise compete with `save_memory`.
`includeMemoryV2: false` opts out explicitly. Consumers:
`ChatBaseExecutor.buildStandardModeOptions`, `RalphExecutor.buildModeOptions`,
`FollowUpExecutor.executeFollowUp`, and `AutopilotExecutor.buildModeOptions` (which
opts out).

## Tools

`llm-tools/memory-v2-tools.ts` exports `createMemoryStoreFactTool(deps)` and
`createMemoryRecallTool(deps)`, taking `MemoryV2ToolDeps`. Writes go through tools, not
a follow-up prompt.

## REST surface

`registerMemoryV2Routes(routes, dataDir, store?)` in `server/memory/memory-v2-routes.ts`
registers:

| Method | Pattern |
|---|---|
| GET | `/api/memory/v2/scopes` |
| GET, POST | `/api/workspaces/:id/memory/v2/facts` |
| PATCH, DELETE | `/api/workspaces/:id/memory/v2/facts/:factId` |
| GET | `/api/workspaces/:id/memory/v2/review` |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/approve` |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/reject` |
| GET | `/api/workspaces/:id/memory/v2/episodes` |
| GET | `/api/workspaces/:id/memory/v2/export` |
| DELETE | `/api/workspaces/:id/memory/v2/wipe` |

`server/memory/memory-config-handler.ts` and `server/memory/memory-routes.ts` sit
alongside it. The shared `@plusplusoneplusplus/coc-client` package exposes the matching
typed `MemoryV2Client` as `coc.memoryV2`.

## Dashboard

The Memory route renders `MemoryV2Panel` with Facts, Review, and Episodes tabs, calling
the `memoryV2` domain client for listing and searching facts, create/edit/delete,
approve/reject of review facts, listing episodes, JSON export, and wiping the active
scope.

## Key design decisions

- Memory is **caller-side opt-in** — the AI invoker is never modified.
- Writes use **tools** (`save_memory` / `recall_memory` via `defineTool`).
- The frozen snapshot is built once per turn to preserve LLM prefix-cache stability;
  only the recall block varies with the prompt.
- Every failure path returns the empty addon rather than propagating, so a corrupt or
  locked store degrades to no memory instead of a failed turn.
