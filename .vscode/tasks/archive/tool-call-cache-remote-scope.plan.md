# Plan: Tool Call Cache — `remote` Scope

## Problem

The tool call cache currently stores all entries in a single global directory
(`~/.coc/memory/explore-cache/`). Two common multi-repo scenarios are poorly
served:

- **Same codebase, multiple clones** (e.g., `~/work/shortcuts` and
  `~/personal/shortcuts`): cached answers about architecture are equally valid
  in both, but today each clone builds its cache independently.
- **Cross-repo noise**: unrelated repos pollute the same cache, reducing
  retrieval precision.

A third scope — **`remote`** — groups repos by their git remote origin URL.
Clones of the same upstream repo share one cache; unrelated repos stay
separate.

## Proposed Scope Name: `git-remote`

`ToolCallCacheLevel = 'system' | 'git-remote' | 'repo'`

| Level        | Granularity | Shared between                          | Storage path                                         |
|--------------|-------------|-----------------------------------------|------------------------------------------------------|
| `system`     | Global      | All repos on the machine                | `~/.coc/memory/explore-cache/`                       |
| `git-remote` | Per-remote  | All local clones of the same git remote | `~/.coc/memory/git-remotes/<remoteHash>/explore-cache/` |
| `repo`       | Per-clone   | Only that exact working-tree            | `~/.coc/memory/repos/<repoHash>/explore-cache/`     |

The `remote` hash is a 16-char `sha256` of the **normalised** remote URL:
lowercase, `.git` suffix stripped, auth credentials removed.

> `ToolCallCacheLevel` is a **new** type, separate from `MemoryLevel` (which
> belongs to the `write_memory` / memory system). `ToolCallCacheConfig.level`
> is updated from `MemoryLevel` to `ToolCallCacheLevel`.

## Approach

### 1 — Git utility: `getRemoteUrl` + `computeRemoteHash`

**File:** `packages/pipeline-core/src/git/exec.ts` (or a new `remote.ts`)

```ts
/** Run `git remote get-url <remote>` and return the URL, or null on error. */
export function getRemoteUrl(repoRoot: string, remote = 'origin'): string | null

/** Normalise a remote URL and return a 16-char hex hash. */
export function computeRemoteHash(remoteUrl: string): string
```

Normalisation rules (applied before hashing):
1. Lowercase
2. Strip auth (`https://user:pass@` → `https://`)
3. Strip trailing `.git`
4. Strip trailing `/`

Exports added to `packages/pipeline-core/src/git/index.ts`.

---

### 2 — New `ToolCallCacheLevel` type

**File:** `packages/pipeline-core/src/memory/tool-call-cache-types.ts`

```ts
export type ToolCallCacheLevel = 'system' | 'git-remote' | 'repo';
```

- Replace `MemoryLevel` with `ToolCallCacheLevel` in `ToolCallCacheConfig.level`.
- Remove the import of `MemoryLevel` from this file (no longer needed).

---

### 3 — `FileToolCallCacheStore` routing

**File:** `packages/pipeline-core/src/memory/tool-call-cache-store.ts`

`ToolCallCacheStoreOptions` gains:

```ts
/** Required when level is 'remote'. 16-char remote hash. */
remoteHash?: string;
/** Required when level is 'repo'. 16-char repo hash. */
repoHash?: string;
/** Which scope this store instance operates on. Default: 'system' */
level?: ToolCallCacheLevel;
```

Constructor resolves `cacheDir` based on `level`:

| `level`        | `cacheDir`                                                      |
|----------------|-----------------------------------------------------------------|
| `'system'`     | `<dataDir>/explore-cache` (current behaviour)                  |
| `'git-remote'` | `<dataDir>/git-remotes/<remoteHash>/explore-cache`             |
| `'repo'`       | `<dataDir>/repos/<repoHash>/explore-cache`                     |

No other methods change — all store operations are already relative to
`this.cacheDir`.

Add path accessor helpers:
```ts
getGitRemoteDir(remoteHash: string): string
getRepoExploreDir(repoHash: string): string
```

---

### 4 — `ToolCallCapture` update

**File:** `packages/pipeline-core/src/memory/tool-call-capture.ts`

`ToolCallCaptureOptions` gains `remoteHash?: string` (passed through to entry
metadata if we want to tag entries — optional, since the store already scopes
by directory).

No functional change required here if the store is pre-scoped at construction
time; this is documentation / future-proofing only.

---

### 5 — `withToolCallCache` options

**File:** `packages/pipeline-core/src/memory/with-tool-call-cache.ts`

`WithToolCallCacheOptions` gains:

```ts
/** Git remote URL hash. Required when level is 'remote'. */
remoteHash?: string;
```

Callers that set `level: 'remote'` must provide `remoteHash`; the orchestrator
passes it to `FileToolCallCacheStore` at construction time. Log a warning and
fall back to `'system'` if `remoteHash` is missing.

---

### 6 — `ToolCallCacheConfig` YAML schema

**File:** `packages/pipeline-core/src/memory/tool-call-cache-types.ts`

```ts
export interface ToolCallCacheConfig {
    enabled: boolean;
    filter?: ToolCallFilter;
    level: ToolCallCacheLevel;   // was MemoryLevel
}
```

Pipelines can now write:
```yaml
toolCallCache:
  enabled: true
  level: git-remote   # or: system, repo
```

---

### 7 — `coc` queue/executor integration

**File:** `packages/coc/src/server/queue-executor-bridge.ts` (and wherever
`withToolCallCache` is wired up)

When `level: 'git-remote'`:
1. Resolve `repoRoot` from the pipeline working directory.
2. Call `getRemoteUrl(repoRoot)` to get the origin URL.
3. Call `computeRemoteHash(url)` to get the hash.
4. Pass `remoteHash` into `WithToolCallCacheOptions`.

If `getRemoteUrl` returns `null` (no remote configured), warn and fall back to
`level: 'repo'`.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/pipeline-core/src/git/exec.ts` (or new `remote.ts`) | Add `getRemoteUrl`, `computeRemoteHash` |
| `packages/pipeline-core/src/git/index.ts` | Export new functions |
| `packages/pipeline-core/src/memory/tool-call-cache-types.ts` | Add `ToolCallCacheLevel`, update `ToolCallCacheConfig` |
| `packages/pipeline-core/src/memory/tool-call-cache-store.ts` | Routing by level in constructor |
| `packages/pipeline-core/src/memory/with-tool-call-cache.ts` | Accept `remoteHash` option |
| `packages/pipeline-core/src/memory/tool-call-capture.ts` | Minor: `remoteHash` metadata tag |
| `packages/coc/src/server/queue-executor-bridge.ts` | Resolve + pass `remoteHash` |
| `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts` | Tests for remote routing |
| `packages/pipeline-core/test/memory/with-tool-call-cache.test.ts` | Tests for remote level |
| `packages/pipeline-core/test/git/remote.test.ts` (new) | Tests for URL normalisation + hashing |

## Out of Scope

- Extending `MemoryLevel` / `write_memory` with a `remote` scope (separate concern).
- Cache merging across remotes.
- Handling repos with multiple remotes (only `origin` is used; configurable later via `remote` name option).
