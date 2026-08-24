# Wiki Serving

`packages/coc/src/server/wiki/` hosts auto-generated codebase documentation over HTTP.
It keeps a `Map` registry of wiki instances keyed by `wikiId`; each entry is a
`WikiRuntime` holding a `WikiData` cache, a lazy TF-IDF `ContextBuilder`, an optional
`ConversationSessionManager`, and an optional `FileWatcher`.

The wiki output directory it serves is produced by the deep-wiki pipeline
([deep-wiki.md](deep-wiki.md)). The HTTP routes, retrieval algorithm, session and
file-watching behavior, and registration sources are in
[wiki-serving-api.md](wiki-serving-api.md).

## Architecture

### Module Map

| Module | Responsibility |
|--------|----------------|
| `wiki-manager.ts` | Registry + lifecycle (register/unregister/reload) |
| `wiki-data.ts` | Disk I/O — component graph, markdown, analyses, themes |
| `context-builder.ts` | TF-IDF index + top-K context retrieval |
| `conversation-session-manager.ts` | Multi-turn AI session pool |
| `file-watcher.ts` | `fs.watch` wrapper with debounce + component mapping |
| `wiki-routes.ts` | Route table registration; restores persisted wikis from `ProcessStore` |
| `ask-handler.ts` | `POST /ask` + SSE utilities (`sendSSE`, `readBody`, `buildAskPrompt`) |
| `explore-handler.ts` | `POST /explore/:id` + `buildExplorePrompt` |
| `generate-handler.ts` | HTTP/SSE adapters for `/admin/generate*` — validation, registry claim, event→SSE piping |
| `generation/generation-registry.ts` | `WikiGenerationRegistry` — per-wiki state, cancellation tokens, `reset`/`dispose` |
| `generation/deep-wiki-adapter.ts` | The only module that dynamically imports deep-wiki internals |
| `generation/generation-runner.ts` | `runWikiGeneration` — five-phase state machine emitting typed events |
| `generation/component-regeneration-runner.ts` | `runComponentRegeneration` — single-article path sharing registry/adapter/reload |
| `generation/cache-status-service.ts` | `WikiCacheStatusService` — phase cache status + metadata counts |
| `generation/events.ts` | Typed generation events + SSE / recording sinks |
| `admin-handlers.ts` | `GET/PUT /admin/seeds`, `GET/PUT /admin/config`, `POST /admin/generate-seeds` |
| `types.ts` | Shared domain types (copied from deep-wiki) |
| `index.ts` | Barrel re-export |

### Runtime Object Lifecycle

```
register(WikiRegistration)
  ├─ Validate wikiDir + component-graph.json
  ├─ WikiData.load() [eager]
  ├─ ConversationSessionManager.create() [if aiEnabled]
  ├─ FileWatcher.start() [if watch + repoPath]
  └─ wikis.set(wikiId, WikiRuntime)

ensureContextBuilder(wikiId)
  └─ new ContextBuilder(graph, markdown, themeMarkdown) [lazy — first ask]

reloadWikiData(wikiId)
  ├─ WikiData.reload()
  └─ contextBuilder = null  [invalidated — rebuilt on next ask]

unregister(wikiId)
  ├─ ConversationSessionManager.destroyAll()
  ├─ FileWatcher.stop()
  └─ wikis.delete(wikiId)
```

### Design Patterns

- **Map registry** — `WikiManager.wikis: Map<string, WikiRuntime>`, mirroring `TaskWatcher` and
  `ProcessStore`.
- **Lazy index** — `ContextBuilder` is built on the first `/ask` and invalidated on reload, so a
  stale index is never served.
- **One adapter for dynamic import** — runners take a `DeepWikiAdapter`, so tests substitute a
  fake instead of mocking `@plusplusoneplusplus/deep-wiki/dist/*` module paths, and no
  compile-time dependency exists.
- **Injected generation registry** — `registerWikiRoutes` creates its own
  `WikiGenerationRegistry` (override via `options.generationRegistry`), so generation state and
  cancellation flags are never shared between servers or tests.
- **Events, not response writes** — runners emit `GenerationEvent`s; `createSseEventSink(res)`
  maps them onto the wire (undefined fields omitted) and non-HTTP callers use
  `createRecordingEventSink`. `ask`, `explore`, and `generate` stream via `sendSSE(res, data)`.
- **Graceful degradation** — startup `FileWatcher` failures and `store.getWikis()` errors are
  swallowed; generation SSE always ends with `done` or `error`.

## Public API Reference

### WikiManager

```typescript
class WikiManager {
    constructor(options?: WikiManagerOptions)

    register(registration: WikiRegistration): void
    unregister(wikiId: string): boolean
    get(wikiId: string): WikiRuntime | undefined
    getRegisteredIds(): string[]
    ensureContextBuilder(wikiId: string): ContextBuilder
    reloadWikiData(wikiId: string): void
    disposeAll(): void
}
```

`register` throws if the wiki directory or `component-graph.json` is missing.

### WikiData

```typescript
class WikiData {
    constructor(wikiDir: string)

    load(): void
    reload(): void

    get graph(): ComponentGraph
    getMarkdownData(): Record<string, string>
    getThemeMarkdownData(): Record<string, string>
    getComponentSummaries(): ComponentSummary[]
    getComponentDetail(id: string): ComponentDetail | undefined
    getSpecialPage(key: string): SpecialPage | undefined
    getThemeArticleDetail(themeId: string, slug: string): ThemeArticleDetail | undefined
}
```

`load()` reads the output directory:

| Loaded item | Source path |
|-------------|-------------|
| `ComponentGraph` | `component-graph.json` |
| Component markdown | `components/*.md` (flat) or `domains/*/components/*.md` (hierarchical) |
| `ComponentAnalysis` | `.analysis/<id>.json` |
| Theme articles | `themes/<themeId>/<slug>.md` |
| Special pages | `index.md`, `architecture.md`, `getting-started.md` |

### ContextBuilder

```typescript
class ContextBuilder {
    constructor(
        graph: ComponentGraph,
        markdownData: Record<string, string>,
        themeMarkdownData?: Record<string, string>,
    )

    retrieve(question: string, maxComponents?: number, maxThemes?: number): RetrievedContext
    get documentCount(): number
    get vocabularySize(): number
}

export function tokenize(text: string): string[]
```

The constructor indexes synchronously. `retrieve` defaults to 5 components and 3 theme
articles; algorithm in [wiki-serving-api.md](wiki-serving-api.md).

### ConversationSessionManager

```typescript
class ConversationSessionManager {
    constructor(options: ConversationSessionManagerOptions)

    create(): ConversationSession | null
    get(sessionId: string): ConversationSession | undefined
    send(sessionId, prompt, options?): Promise<SessionSendResult>
    destroy(sessionId: string): boolean
    destroyAll(): void

    get size(): number
    get sessionIds(): string[]
}
```

### FileWatcher

```typescript
class FileWatcher {
    constructor(options: FileWatcherOptions)

    start(): void
    stop(): void
    get isWatching(): boolean
}
```

Ignores `node_modules`, `.git`, `dist`, `build`, `out`, `*.map`, `*.lock`, `*.log`,
`.DS_Store`, and similar non-source patterns.

### registerWikiRoutes

```typescript
function registerWikiRoutes(routes: Route[], options: WikiRouteOptions): WikiManager
```

Mounts all wiki routes onto the CoC server's `Route[]` table and returns the `WikiManager`.

## Dependencies

| Module | Usage |
|--------|-------|
| `@plusplusoneplusplus/pipeline-core` | `ProcessStore`, `WikiInfo` — persistence interface |
| `@plusplusoneplusplus/coc-server` | `Route`, `WikiServerOptions`, `sendJson`, `send400`, `send404`, `send500`, `readJsonBody` |
| `@plusplusoneplusplus/deep-wiki` | Dynamically imported for phase execution |
| `fs`, `path`, `os` | Directory reads, `fs.watch`, `os.homedir()` defaults |
| `js-yaml` | YAML parsing in `admin-handlers` (dynamic import) |

## Related

- [deep-wiki.md](deep-wiki.md) — the pipeline producing the `wiki/` directory, including the
  `component-graph.json` `WikiData` reads and the git-hash cache `--use-cache` relies on.
- [server-architecture.md](server-architecture.md) — the host server; `ProcessStore` is shared.
