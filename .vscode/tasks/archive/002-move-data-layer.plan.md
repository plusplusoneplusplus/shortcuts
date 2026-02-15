---
status: done
---

# 002: Move Wiki Data Layer Modules to CoC

## Summary
Move wiki-data, context-builder, conversation-session-manager, file-watcher, and types from deep-wiki/src/server/ to coc/src/server/wiki/. These are pure data/logic modules with no HTTP handler dependencies.

## Motivation
Separating the data layer first allows subsequent commits to build handlers on top. These modules have no circular dependencies with HTTP handlers — they're pure business logic.

## Changes

### Files to Create
- `packages/coc/src/server/wiki/wiki-data.ts` — Copied from deep-wiki, imports adjusted
- `packages/coc/src/server/wiki/context-builder.ts` — Copied from deep-wiki
- `packages/coc/src/server/wiki/conversation-session-manager.ts` — Copied from deep-wiki
- `packages/coc/src/server/wiki/file-watcher.ts` — Copied from deep-wiki
- `packages/coc/src/server/wiki/types.ts` — Copied from deep-wiki, merged with WikiInfo from pipeline-core
- `packages/coc/src/server/wiki/index.ts` — Barrel export for all wiki modules

### Files to Modify
- (none — deep-wiki originals left in place for now, removed in later commit)

### Files to Delete
- (none — deletion happens in the cleanup commit)

## Implementation Notes

### Dependency Graph (intra-module)

```
types.ts              ← standalone, no local imports
wiki-data.ts          ← imports { ComponentGraph, ComponentInfo, ComponentAnalysis, ThemeMeta } from types
context-builder.ts    ← imports { ComponentGraph, ThemeMeta } from types
file-watcher.ts       ← imports { ComponentGraph } from types
conversation-session-manager.ts ← imports { AskAIFunction } from ask-handler (HTTP layer — needs decoupling)
```

No cycles exist among the four data modules. `conversation-session-manager` is the only one that reaches into the HTTP layer (imports `AskAIFunction` from `ask-handler.ts`).

### External (Node.js / npm) Dependencies per Module

| Module | External Imports |
|--------|-----------------|
| `wiki-data.ts` | `fs`, `path` (Node built-ins only) |
| `context-builder.ts` | (none — pure computation) |
| `file-watcher.ts` | `fs`, `path` (Node built-ins only) |
| `conversation-session-manager.ts` | (none — pure logic + timers) |
| `types.ts` | (none — pure type definitions) |

No third-party npm packages are needed by any of these modules.

### Import Path Adjustments

**`wiki-data.ts`** — currently:
```ts
import type { ComponentGraph, ComponentInfo, ComponentAnalysis, ThemeMeta } from '../types';
```
In CoC, change to import from the local `./types` barrel (which re-exports these deep-wiki types), or directly from the deep-wiki package / pipeline-core as appropriate.

**`context-builder.ts`** — currently:
```ts
import type { ComponentGraph } from '../types';
import type { ThemeMeta } from '../types';
```
Same adjustment: import from local `./types`.

**`file-watcher.ts`** — currently:
```ts
import type { ComponentGraph } from '../types';
```
Same adjustment: import from local `./types`.

**`conversation-session-manager.ts`** — currently:
```ts
import type { AskAIFunction } from './ask-handler';
```
`AskAIFunction` is a simple callback type defined in the HTTP handler module (`ask-handler.ts`). To decouple this module from the HTTP layer, **lift `AskAIFunction` into `types.ts`** (the local wiki types file). The type is:
```ts
export type AskAIFunction = (prompt: string, options?: {
    model?: string;
    workingDirectory?: string;
    onStreamingChunk?: (chunk: string) => void;
}) => Promise<string>;
```
Then `conversation-session-manager.ts` imports from `./types` instead of `./ask-handler`.

### Deep-Wiki Types to Copy into `types.ts`

The following types from `deep-wiki/src/types.ts` are consumed by the data-layer modules and must be made available in `coc/src/server/wiki/types.ts`:

- **`ComponentInfo`** — used by `wiki-data` (field access: `id`, `name`, `category`, `complexity`, `path`, `purpose`, `dependencies`, `dependents`, `keyFiles`) and `file-watcher` (field access: `path`, `keyFiles`, `id`).
- **`ComponentGraph`** — used by all four modules. Fields: `project`, `components`, `categories`, `architectureNotes`, `domains?`, `themes?`.
- **`ComponentAnalysis`** — used by `wiki-data` (field access: `componentId`). Large type with sub-types (`KeyConcept`, `PublicAPIEntry`, `CodeExample`, `InternalDependency`, `ExternalDependency`).
- **`ThemeMeta`** — used by `wiki-data` and `context-builder` (field access: `id`, `title`, `description`, `layout`, `articles`, `involvedComponentIds`).
- **`ProjectInfo`** — nested in `ComponentGraph.project` (field access: `name`, `description`, `language`).
- **`CategoryInfo`** — nested in `ComponentGraph.categories`.
- **`DomainInfo`** — nested in `ComponentGraph.domains`.

**Strategy**: Re-export these types from deep-wiki's package (`@plusplusoneplusplus/deep-wiki`) rather than duplicating the definitions. If deep-wiki does not expose them from its package entry point, add them to deep-wiki's barrel export first. Alternatively, since the goal is to eventually remove deep-wiki's server code, copy the type definitions directly into `coc/src/server/wiki/types.ts` to avoid a dependency back on deep-wiki.

### CoC `types.ts` Conflict Check

CoC already has `packages/coc/src/server/types.ts` which defines `ServeCommandOptions`, `ExecutionServerOptions`, `ExecutionServer`, and `Route` (all HTTP-oriented). The new `wiki/types.ts` lives in a subdirectory so **no naming conflict** exists — it's `server/wiki/types.ts` vs `server/types.ts`.

Deep-wiki also has its own `ServeCommandOptions` in `server/types.ts` (different fields from CoC's). This moves into `wiki/types.ts` under the same name — since it's namespace-scoped under `wiki/`, no collision with CoC's `ServeCommandOptions`.

### `wiki-data.ts` — Locally Defined Types to Preserve

`wiki-data.ts` defines and exports several interface types that are consumed by HTTP handlers and the SPA. These must be preserved in the copy:
- `ComponentSummary` — returned by component list endpoints
- `ComponentDetail` — returned by component detail endpoints
- `SpecialPage` — returned by special page endpoints
- `ThemeArticleContent` — theme article content
- `ThemeArticleDetail` — theme article detail with metadata

### `context-builder.ts` — Exported Types to Preserve

- `RetrievedContext` — result of context retrieval (used by ask-handler)
- `ThemeContextEntry` — theme article included in context
- `tokenize()` — exported function (used by tests and potentially by handlers)

## Tests
- Verify all copied modules compile without errors
- Verify WikiData loads a sample component-graph.json correctly
- Verify ContextBuilder indexes and retrieves components
- Verify ConversationSessionManager session lifecycle
- Verify FileWatcher creates and destroys watchers

## Acceptance Criteria
- [x] All 5 modules exist in packages/coc/src/server/wiki/
- [x] `AskAIFunction` type is defined in wiki/types.ts (decoupled from ask-handler)
- [x] Deep-wiki domain types (ComponentGraph, ComponentInfo, etc.) available via wiki/types.ts
- [x] Barrel export (index.ts) re-exports all public types/classes
- [x] No import errors — all dependencies resolved
- [x] CoC build succeeds with new modules
- [x] Existing CoC tests unaffected

## Dependencies
- Depends on: 001 (WikiInfo type in pipeline-core)
