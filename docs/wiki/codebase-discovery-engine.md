# Codebase Discovery Engine

**Category:** Wiki Generation

## Overview

The Codebase Discovery Engine is Phase 1 of the deep-wiki pipeline. It orchestrates one or more Copilot SDK AI sessions equipped with read-only MCP tools (`view`, `grep`, `glob`) to analyze a repository and produce a `ComponentGraph` — a structured JSON data model capturing project metadata, feature-oriented components, their dependencies, categories, and architecture notes.

For standard-size repos (< 3000 files) it executes a single-pass session. For large repos it runs a two-round strategy: a structural scan that identifies top-level domains, followed by sequential per-domain drill-down sessions whose results are merged into one unified graph. An additional iterative/BFS strategy (theme-seed probing) is also available for theme-driven discovery.

The engine lives in `packages/deep-wiki/src/discovery/` and is consumed by the `generate` command via `discoverComponentGraph()`.

---

## Architecture

```
discoverComponentGraph(options)
        │
        ├─── fileCount < threshold ──────────────────────────────────────┐
        │                                                                 │
        ▼                                                                 ▼
 ┌──────────────────────┐                             ┌───────────────────────────────┐
 │  Single-Pass Session  │                             │      Large-Repo Handler        │
 │  discovery-session.ts │                             │   large-repo-handler.ts        │
 │                       │                             │                               │
 │  1. buildDiscovery    │                             │  Round 1: Structural Scan      │
 │     Prompt()          │                             │  ─────────────────────────    │
 │  2. sendMessage()     │                             │  buildStructuralScanPrompt()  │
 │     [30 min timeout]  │                             │  → StructuralScanResult        │
 │  3. parseComponent    │                             │    { domains[], fileCount }    │
 │     GraphResponse()   │                             │                               │
 │  4. retry once on     │                             │  Round 2: Per-Domain Scan      │
 │     parse failure     │                             │  ─────────────────────────    │
 └──────────┬────────────┘                             │  for each domain (sequential) │
            │                                          │    buildFocusedDiscovery       │
            │                                          │      Prompt()                  │
            ▼                                          │    → ComponentGraph (partial) │
    ┌────────────────┐                                 │                               │
    │ ComponentGraph │◄────────────────────────────────│  Merge: mergeSubGraphs()       │
    └────────────────┘                                 │    dedup + tag + validate      │
                                                       └───────────────────────────────┘
```

**Source files:**

| File | Role |
|---|---|
| `discovery/index.ts` | Public entry — routes to single-pass or large-repo path |
| `discovery/discovery-session.ts` | Single-pass AI session, retry on parse failure |
| `discovery/large-repo-handler.ts` | Multi-round structural scan + per-domain drill-down |
| `discovery/response-parser.ts` | Parse, validate, and normalize AI JSON → `ComponentGraph` |
| `discovery/prompts.ts` | Prompt templates for full, structural, and focused discovery |
| `discovery/iterative/iterative-discovery.ts` | BFS convergence loop for theme-seed strategy |
| `discovery/iterative/probe-session.ts` | Per-theme SDK session |
| `discovery/iterative/merge-session.ts` | Merge + gap-analysis session |
| `discovery/iterative/probe-prompts.ts` | Prompt + schema for theme probes |
| `discovery/iterative/merge-prompts.ts` | Prompt + schema for merge sessions |
| `discovery/iterative/probe-response-parser.ts` | Parses probe response → `ThemeProbeResult` |
| `discovery/iterative/merge-response-parser.ts` | Parses merge response → `MergeResult` |
| `discovery/iterative/types.ts` | Iterative-specific types |

---

## Key Types

### `ComponentGraph` — Phase 1 output

```typescript
interface ComponentGraph {
    project: ProjectInfo;           // name, description, language, buildSystem, entryPoints[]
    components: ComponentInfo[];    // all discovered components
    categories: CategoryInfo[];     // grouping labels
    architectureNotes: string;      // 2–4 sentence architectural summary
    domains?: DomainInfo[];         // populated for large repos only
    themes?: ThemeMeta[];           // populated by the theme command
}
```

### `ComponentInfo` — a single node

```typescript
interface ComponentInfo {
    id: string;                     // unique lowercase kebab-case, feature-named
    name: string;                   // human-readable label
    path: string;                   // relative path from repo root
    purpose: string;                // one-sentence description
    keyFiles: string[];             // 1–3 most important files
    dependencies: string[];         // component IDs this node depends on
    dependents: string[];           // component IDs that depend on this node
    complexity: 'low' | 'medium' | 'high';
    category: string;               // must match a CategoryInfo.name
    domain?: string;                // domain slug (large repos only)
}
```

### `DiscoveryOptions` — configuration

```typescript
interface DiscoveryOptions {
    repoPath: string;               // required — absolute path to repo root
    model?: string;
    timeout?: number;               // default: 1 800 000 ms (30 min)
    focus?: string;                 // restrict to subtree, e.g. "src/"
    concurrency?: number;
    outputDir?: string;             // enables incremental disk caching
    gitHash?: string;               // cache key
    useCache?: boolean;             // ignore gitHash, use any cached result
    largeRepoThreshold?: number;    // default: 3000
}
```

### Supporting types

```typescript
interface CategoryInfo    { name: string; description: string; }

interface DomainInfo {
    id: string; name: string; path: string; description: string;
    components: string[];           // component IDs assigned to this domain
}

interface TopLevelDomain  { name: string; path: string; description: string; }

interface StructuralScanResult {
    fileCount: number;
    domains: TopLevelDomain[];
    projectInfo: Partial<ProjectInfo>;
}

interface DiscoveryResult {
    graph: ComponentGraph;
    duration: number;
    tokenUsage?: TokenUsage;
}
```

---

## Single-Pass Session

For repos below the file-count threshold, `runDiscoverySession()` executes one AI call:

```
1. getCopilotSDKService().isAvailable()  →  throws DiscoveryError('sdk-unavailable') if false
2. buildDiscoveryPrompt(repoPath, focus?)
3. service.sendMessage({
       availableTools: ['view', 'grep', 'glob'],
       onPermissionRequest: readOnlyPermissions,   // approves 'read', denies all else
       loadDefaultMcpConfig: false,
       timeoutMs: 1_800_000
   })
4. parseComponentGraphResponse(result.response)
   → on parse failure: retry once with appended "Return ONLY a raw JSON object" hint
   → mergeTokenUsage() from both attempts
```

**Error codes:** `'sdk-unavailable' | 'timeout' | 'ai-error' | 'empty-response' | 'parse-error'`

The session deliberately sets `loadDefaultMcpConfig: false` and only whitelists three read-only tools, preventing the AI from writing files or executing shell commands.

---

## Large-Repo Multi-Round Strategy

When `estimateFileCount()` reports ≥ 3 000 files, `discoverLargeRepo()` runs a two-round pipeline.

### Round 1 — Structural Scan

```
buildStructuralScanPrompt(repoPath)
  → AI uses glob/view to identify top-level directories and language stack
  → parseStructuralScanResponse()
  → StructuralScanResult { domains: TopLevelDomain[], fileCount, projectInfo }
```

Result is cached to disk when `outputDir` + `gitHash` are provided.

### Round 2 — Per-Domain Drill-Down

For each `TopLevelDomain` (processed **sequentially** to avoid SDK overload):

```
discoverDomain(options, domain, projectName)
  → buildFocusedDiscoveryPrompt(repoPath, domain.path, domain.description, projectName)
  → service.sendMessage() → parseComponentGraphResponse()
  → per-domain ComponentGraph cached to disk
  → errors per domain are caught-and-logged (non-fatal, continues to next domain)
```

### Merge

`mergeSubGraphs(subGraphs, scanResult)` combines all per-domain graphs:

- Deduplicates components by ID (first occurrence wins)
- Tags each component with its `domain` slug
- Merges `categories` by name deduplication
- Validates cross-domain dependency references (filters unknown IDs with a warning)
- Concatenates `architectureNotes` with `\n\n`
- Builds `DomainInfo[]` from `TopLevelDomain[]` + component assignments

---

## Iterative / BFS Strategy

An alternative strategy (`runIterativeDiscovery`) starts from a set of `ThemeSeed` entries and converges by probing then merging:

```
while (round < maxRounds && themes exist && !converged):
    ├── skip already-cached probe results
    ├── runParallel(pendingThemes, concurrency=5):
    │     each → runThemeProbe(repoPath, theme)
    │               buildProbePrompt() → sendMessage() → parseProbeResponse()
    │               → ThemeProbeResult { foundComponents[], discoveredThemes[], confidence }
    └── mergeProbeResults(repoPath, allProbeResults, currentGraph)
          buildMergePrompt() → sendMessage() → parseMergeResponse()
          → MergeResult { graph, newThemes[], converged, coverage }
```

**Convergence criteria (any one):**
- AI merge session returns `converged: true`
- `coverage >= coverageThreshold (0.8)` AND `newThemes.length === 0`
- `round >= maxRounds (default: 3)`

Partial probe results are cached per-theme so interrupted runs resume from the last completed round.

### Iterative types

```typescript
interface ThemeSeed { theme: string; description: string; hints: string[]; }

interface ThemeProbeResult {
    theme: string;
    foundComponents: ProbeFoundComponent[];
    discoveredThemes: DiscoveredTheme[];
    dependencies: string[];
    confidence: number;   // 0–1
}

interface ProbeFoundComponent {
    id: string; name: string; path: string; purpose: string;
    keyFiles: string[]; evidence: string;
    lineRanges?: [number, number][];  // for monolithic files
}

interface MergeResult {
    graph: ComponentGraph;
    newThemes: ThemeSeed[];
    converged: boolean;
    coverage: number;     // 0–1
    reason: string;
}
```

---

## Response Parsing

### `parseComponentGraphResponse(response: string): ComponentGraph`

1. Calls `parseAIJsonResponse(response, { context: 'discovery', repair: true })` from `pipeline-core`
2. Backward-compat alias: `modules` field → `components`
3. Missing `categories` → filled with `[]` (warning logged)
4. **Post-processing:**
   - Auto-creates `CategoryInfo` entries for any category name referenced by a component but absent from the array
   - Removes unknown dependency/dependent IDs (logs warnings)
   - Deduplicates components by ID (keeps first occurrence)
5. All warnings go to `process.stderr`

### `parseStructuralScanResponse(response: string): StructuralScanResult`

1. `extractJSON(response)` (from `pipeline-core`)
2. `JSON.parse()` — on failure → `attemptJsonRepair(jsonStr)` (from utils)
3. Returns `{ fileCount, domains, projectInfo }`

### Path normalization

`normalizePath(p)` is applied to all file paths in parsed responses:
- Backslashes → forward slashes
- Strips leading `./`
- Collapses repeated `/`

### Component ID rules

- Must be **lowercase kebab-case** describing the feature, not the directory path
- Good: `"inline-code-review"`, `"ai-pipeline-engine"`
- Banned: `"src-shortcuts-code-review"`, `"packages-deep-wiki-src-cache"`
- Invalid IDs are normalized via `normalizeComponentId()`

---

## MCP Tools and Permissions

All sessions (single-pass, structural scan, domain drill-down, probe, merge) use the same restricted tool set:

```typescript
availableTools: ['view', 'grep', 'glob']   // read-only whitelist
loadDefaultMcpConfig: false                 // no ~/.copilot/mcp-config.json
onPermissionRequest: readOnlyPermissions    // approves 'read', denies write/shell/mcp/url
```

This guarantees the AI cannot modify any file or execute arbitrary commands during discovery.

---

## Caching

Disk-based incremental caching is activated when `outputDir` is provided. The cache key is `gitHash` (skipped when `useCache: true`).

| Cached artifact | Cache function |
|---|---|
| Structural scan result | `getCachedStructuralScan` / `saveStructuralScan` |
| Per-domain sub-graph | `getCachedDomainSubGraph` / `saveDomainSubGraph` |
| Individual probe results | `saveProbeResult` / `scanCachedProbes` |
| Iterative round progress | `getDiscoveryMetadata` / `saveDiscoveryMetadata` |

Round resumption: if `getDiscoveryMetadata()` shows `currentRound > 0` and `gitHash` matches, iterative discovery continues from the last completed round without re-running earlier probes.

---

## Timeouts

| Session | Default |
|---|---|
| Single-pass discovery | 30 min |
| Structural scan | 30 min |
| Per-domain drill-down | 30 min |
| Iterative probe | 30 min |
| Iterative merge | 30 min |

All timeouts are configurable via `DiscoveryOptions.timeout`.

---

## Error Handling

`DiscoveryError` is a typed error with a `code` property:

| Code | Cause |
|---|---|
| `sdk-unavailable` | Copilot SDK not reachable |
| `timeout` | AI session exceeded timeout |
| `ai-error` | Non-timeout AI failure |
| `empty-response` | AI returned blank response |
| `parse-error` | JSON parse failed after retry |

Per-domain errors in the large-repo handler are **non-fatal** — the handler logs the failure and continues to the next domain so a single inaccessible subdirectory does not abort the entire run.

---

## Usage

```typescript
import { discoverComponentGraph } from '@plusplusoneplusplus/deep-wiki';

const result = await discoverComponentGraph({
    repoPath: '/path/to/repo',
    outputDir: '/path/to/output',   // enables caching
    gitHash: currentGitHash,        // cache key
    focus: 'src/',                  // optional subtree restriction
    timeout: 1_800_000,             // 30 min (default)
    largeRepoThreshold: 3000,       // default
});

console.log(result.graph.components.length);   // number of discovered components
console.log(result.duration);                  // ms elapsed
```

The `generate` command in `packages/deep-wiki/src/commands/generate.ts` calls this function as Phase 1, then feeds `result.graph` into Phase 2 (consolidation) and Phase 3 (analysis).
