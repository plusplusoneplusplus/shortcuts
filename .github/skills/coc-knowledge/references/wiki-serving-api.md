# Wiki Serving — HTTP API & runtime behavior

The routes `registerWikiRoutes` mounts, how context is retrieved, how conversation
sessions and file watching behave, and how wikis are registered. The component classes
are in [wiki-serving.md](wiki-serving.md).

## HTTP API Endpoints

All endpoints are prefixed with `/api/wikis/:wikiId`.

### Ask (AI Q&A)

`POST /ask` (JSON body) → `text/event-stream`.

```json
{
  "question": "How does authentication work?",
  "sessionId": "abc123xyz",
  "conversationHistory": [{ "role": "user", "content": "..." }]
}
```

| Event | Payload |
|-------|---------|
| `context` | `{ componentIds, themeIds? }` — components/themes used as context |
| `chunk` | `{ content }` — streaming AI response fragment |
| `done` | `{ fullResponse, sessionId? }` |
| `error` | `{ message }` |

A known `sessionId` routes the AI call through that session's `send()`. Otherwise a new
session is created; with no `sessionManager` the handler answers single-turn.

### Explore (Deep-Dive)

`POST /explore/:componentId` (JSON body) → `text/event-stream`. Body `{ question?, depth? }`
with `depth` of `normal` | `deep`. With `question` omitted the handler builds a comprehensive
analysis prompt from `depth`; the component's existing markdown from `WikiData` is injected as
prior context.

| Event | Payload |
|-------|---------|
| `status` | `{ message }` — startup notification |
| `chunk` | `{ text }` — streaming fragment |
| `done` | `{ fullResponse }` |
| `error` | `{ message }` |

### Generate (Phase Regeneration)

```
POST  /admin/generate                    → SSE — run phases 1-5
POST  /admin/generate/cancel             → JSON — cancel running generation
GET   /admin/generate/status             → JSON — phase cache status
POST  /admin/generate/component/:id      → SSE — single-component regen
```

The handler dynamically imports `@plusplusoneplusplus/deep-wiki` and delegates to each
phase's public API, streaming progress as SSE. A per-wiki `Map<string, GenerationState>`
prevents concurrent runs on the same wiki.

### Admin (Seeds & Config)

```
GET/PUT  /admin/seeds
GET/PUT  /admin/config
POST     /admin/generate-seeds           → SSE
```

Seeds live in `seeds.yaml` beside the source repo, falling back to the wiki output directory;
config is `deep-wiki.config.yaml` in the repo root. `generate-seeds` infers theme seeds from
the `ComponentGraph` with AI.

## TF-IDF Context Retrieval

`ContextBuilder` implements TF-IDF retrieval in ~100 lines with no external dependencies.

**Index building (constructor):** each component document is
`name + purpose + category + path + keyFiles + markdown` and each theme-article document is
`theme.title + theme.description + article.title + involvedComponentNames + markdown`.
Tokenizing lowercases, strips non-alphanumerics, drops stop words, and keeps terms of 2+ chars.
Term frequencies are normalized (TF = count / total terms); once every document is indexed,
IDF = `log(N / df + 1)` per term.

**Retrieval (`retrieve(question)`):** tokenize the question, score each document
`Σ TF(term, doc) × IDF(term)` with a `1.5×` boost when the component name contains a query term,
take the top-K components and top-K theme articles, expand the component set with 1-hop
dependency neighbors while capacity remains, then assemble `contextText` and return
`RetrievedContext` with `componentIds`, `contextText`, `graphSummary` (project metadata +
abbreviated component list), and `themeContexts`.

## Conversation Sessions

`ConversationSessionManager` holds server-side conversation state so follow-up questions stay
in one context window.

- `create()` generates a 12-character random alphanumeric ID and stores session metadata.
- `send()` sets `session.busy = true` before the AI call and clears it in `finally`, acting as
  a per-session mutex.
- A `setInterval` cleanup timer (default 1 min) drops sessions idle beyond `idleTimeoutMs`
  (default 10 min).
- `destroyAll()` clears the Map and cancels the timer.
- At `maxSessions` (default 5), `create()` evicts the oldest non-busy session; if all are busy
  it returns `null` and the ask handler answers single-turn.

## File Watching & Live Reload

`fs.watch(repoPath, { recursive: true })` with a 2-second debounce. On change,
`findAffectedComponents` matches changed paths against `ComponentInfo.path` (prefix) and
`ComponentInfo.keyFiles` (exact or suffix), normalizing to forward slashes for cross-platform
correctness, then fires `onChange(affectedComponentIds)`.

`WikiManager` responds by invoking `onWikiRebuilding`, calling `WikiData.reload()`, setting
`contextBuilder = null`, then invoking `onWikiReloaded`.

Creation failures leave `fileWatcher` as `null` without aborting `register`.

## Wiki Registration & Persistence

| Source | Timing | Description |
|--------|--------|-------------|
| `WikiRouteOptions.wikis` | Synchronous at server start | Explicit map of `wikiId → { wikiDir, repoPath? }` |
| `ProcessStore.getWikis()` | Async best-effort at startup | Persisted wikis restored from `~/.coc/` |
| `POST /api/wikis` | Runtime | Dynamic registration via REST (parent api-handler) |

Restoring from `ProcessStore` skips wikis already registered from explicit options and silently
ignores entries whose `component-graph.json` no longer exists on disk.

## Usage

`registerWikiRoutes(routes, { aiEnabled, aiSendMessage, store, onWikiError })` returns the
`WikiManager`; `manager.register({ wikiId, wikiDir, repoPath, aiEnabled, watch })` adds a wiki,
and `manager.ensureContextBuilder(wikiId).retrieve(question)` queries the index directly.
