# Memory System

SQLite-backed durable facts and episodes that let AI chat sessions learn from past
interactions. Facts are written with the `save_memory` tool, retrieved with `recall_memory`, and
a frozen high-importance snapshot is injected into the system prompt for prefix-cache stability.
`@plusplusoneplusplus/coc-memory` holds the implementation; `packages/coc` owns the executor
addon, REST routes, and dashboard UI.

## Storage layout

| Scope | Location | Gate |
|---|---|---|
| Global | `~/.coc/<GLOBAL_MEMORY_SUBDIR>/` | `globalPrefs.memoryV2.enabled` |
| Workspace | `~/.coc/repos/<workspaceId>/<WORKSPACE_MEMORY_SUBDIR>/` | `repoPrefs.memoryV2.enabled` |

The two scopes are **independent**, not alternatives — both can be on, and the addon reads
facts from every enabled scope. `createMemoryStores(dir)`
(`coc-memory/src/store-impl/store-factory.ts`) creates the directory, opens `facts.db` and
`episodes.db` inside it, and returns a handle with `close()`.

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

`packages/forge/src/memory/` keeps only what forge needs: `types.ts` (`RepoInfo`,
`GitRemoteInfo`, `MemoryLevel`), `repo-hash.ts` (`computeRepoHash`, a stable 16-char hex hash
for repository paths), `base-file-store.ts`, and `memory-security-scanner.ts`, which re-exports
the canonical scanner. **Do not fork the threat patterns into forge; extend
`safety-scanner.ts`.** It blocks prompt injection, exfiltration, SSH persistence, CoC-env
access, credential literals (API keys, Bearer/Basic tokens, password assignments, connection
strings), and invisible Unicode.

## Facts and episodes

A fact carries scope (`global` | `workspace`), status (`active` | `review` | `rejected` |
`archived`), importance, confidence, tags, source metadata, and optional source process/turn
links. An episode summarizes a completed interaction and links back to its source process or
Ralph context.

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

It reads `readGlobalPreferences(dataDir)` and `readRepoPreferences(dataDir, workspaceId)`,
opens a store per enabled scope, and lists `status: 'active'` facts from each up to
`frozenSnapshotLimit` (default 10). A non-empty `query` additionally runs a
`HybridSearchEngine` search up to `recallLimit` (default 5) for the per-turn recall block; no
`query` yields the frozen snapshot only. Both limits read `globalPrefs`, then `repoPrefs`, then
the default.

It returns the frozen `EMPTY_ADDON` when `dataDir` or `workspaceId` is missing, when neither
scope is enabled, or on **any** error during store initialization or fact retrieval — memory
never fails a turn.

### Turn assembly

`buildChatTurnContext()` in `executors/chat-turn-context-builder.ts` is the integration point
for every executor path — the single assembly point for tools, tool guidance, Memory V2, SDK
built-in exclusions, ask-user handles, and disposal. It calls `buildMemoryV2Addon()` internally;
callers never wire the addon themselves.

With Memory V2 active it returns `excludedTools: ['vote_memory', 'store_memory']`, suppressing
the Copilot SDK built-ins that compete with `save_memory`; `includeMemoryV2: false` opts out.
Consumers: `ChatBaseExecutor.buildStandardModeOptions`, `RalphExecutor.buildModeOptions`,
`FollowUpExecutor.executeFollowUp`, and `AutopilotExecutor.buildModeOptions` (opted out).

## Tools

`llm-tools/memory-v2-tools.ts` exports `createMemoryStoreFactTool(deps)` and
`createMemoryRecallTool(deps)`, both taking `MemoryV2ToolDeps`. Writes go through tools, not a
follow-up prompt.

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

`server/memory/memory-config-handler.ts` and `server/memory/memory-routes.ts` sit alongside it.
`@plusplusoneplusplus/coc-client` exposes the typed `MemoryV2Client` as `coc.memoryV2`.

## Dashboard

The Memory route renders `MemoryV2Panel` with Facts, Review, and Episodes tabs, calling the
`memoryV2` domain client to list/search facts, create/edit/delete them, approve or reject review
facts, list episodes, export JSON, and wipe the active scope.

## Key design decisions

- Memory is **caller-side opt-in** — the AI invoker is never modified.
- Writes use **tools** (`save_memory` / `recall_memory` via `defineTool`).
- The frozen snapshot is built once per turn for prefix-cache stability; only the recall block
  varies with the prompt.
- Every failure path returns the empty addon, so a corrupt or locked store degrades to no memory
  instead of a failed turn.
