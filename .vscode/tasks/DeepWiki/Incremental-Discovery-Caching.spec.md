# Incremental Discovery Caching — Spec

## Cache File Formats

### Probe Result (`discovery/probes/{topic-slug}.json`)

```json
{
  "probeResult": {
    "topic": "authentication",
    "foundModules": [
      {
        "id": "auth-service",
        "name": "Auth Service",
        "path": "src/auth/",
        "purpose": "Handles authentication",
        "keyFiles": ["src/auth/index.ts"],
        "dependencies": ["database"],
        "dependents": ["api-routes"],
        "complexity": "medium",
        "category": "core"
      }
    ],
    "discoveredTopics": [
      { "topic": "authorization", "description": "Permission system", "hints": ["rbac"] }
    ],
    "dependencies": [["auth-service", "database"]],
    "confidence": 0.92
  },
  "gitHash": "abc123...",
  "timestamp": 1707450000000
}
```

### Seeds Cache (`discovery/seeds.json`)

```json
{
  "seeds": [
    { "topic": "authentication", "description": "Auth flows", "hints": ["auth", "login"] },
    { "topic": "database", "description": "Data layer", "hints": ["db", "orm"] }
  ],
  "gitHash": "abc123...",
  "timestamp": 1707450000000
}
```

### Structural Scan (`discovery/structural-scan.json`)

```json
{
  "scanResult": {
    "projectInfo": { "name": "my-project", "language": "TypeScript", ... },
    "areas": [
      { "name": "Frontend", "path": "packages/frontend", "description": "React UI" },
      { "name": "Backend", "path": "packages/backend", "description": "Express API" }
    ]
  },
  "gitHash": "abc123...",
  "timestamp": 1707450000000
}
```

### Area Sub-Graph (`discovery/areas/{area-slug}.json`)

```json
{
  "graph": {
    "project": { ... },
    "modules": [ ... ],
    "categories": [ ... ],
    "architectureNotes": "..."
  },
  "gitHash": "abc123...",
  "timestamp": 1707450000000
}
```

### Discovery Metadata (`discovery/_metadata.json`)

```json
{
  "gitHash": "abc123...",
  "timestamp": 1707450000000,
  "mode": "iterative",
  "currentRound": 2,
  "maxRounds": 3,
  "completedTopics": ["authentication", "database", "api-routes"],
  "pendingTopics": ["caching", "logging"],
  "converged": false,
  "coverage": 0.65
}
```

## API Surface

```typescript
// --- Types ---
interface CachedProbeResult {
  probeResult: TopicProbeResult;
  gitHash: string;
  timestamp: number;
}

interface CachedSeeds {
  seeds: TopicSeed[];
  gitHash: string;
  timestamp: number;
}

interface CachedStructuralScan {
  scanResult: StructuralScanResult;
  gitHash: string;
  timestamp: number;
}

interface CachedAreaGraph {
  graph: ModuleGraph;
  gitHash: string;
  timestamp: number;
}

interface DiscoveryProgressMetadata {
  gitHash: string;
  timestamp: number;
  mode: 'standard' | 'iterative' | 'large-repo';
  currentRound: number;
  maxRounds: number;
  completedTopics: string[];
  pendingTopics: string[];
  converged: boolean;
  coverage: number;
}

// --- Functions ---

// Directory
function getDiscoveryCacheDir(outputDir: string): string;

// Seeds
function saveSeedsCache(seeds: TopicSeed[], outputDir: string, gitHash: string): void;
function getCachedSeeds(outputDir: string, gitHash: string): TopicSeed[] | null;

// Probes
function saveProbeResult(topic: string, result: TopicProbeResult, outputDir: string, gitHash: string): void;
function getCachedProbeResult(topic: string, outputDir: string, gitHash: string): TopicProbeResult | null;
function scanCachedProbes(
  topics: string[], outputDir: string, gitHash: string
): { found: Map<string, TopicProbeResult>; missing: string[] };

// Structural scan (large repo)
function saveStructuralScan(scan: StructuralScanResult, outputDir: string, gitHash: string): void;
function getCachedStructuralScan(outputDir: string, gitHash: string): StructuralScanResult | null;

// Area sub-graphs (large repo)
function saveAreaSubGraph(areaId: string, graph: ModuleGraph, outputDir: string, gitHash: string): void;
function getCachedAreaSubGraph(areaId: string, outputDir: string, gitHash: string): ModuleGraph | null;
function scanCachedAreas(
  areaIds: string[], outputDir: string, gitHash: string
): { found: Map<string, ModuleGraph>; missing: string[] };

// Progress metadata
function saveDiscoveryMetadata(metadata: DiscoveryProgressMetadata, outputDir: string): void;
function getDiscoveryMetadata(outputDir: string): DiscoveryProgressMetadata | null;

// Cleanup
function clearDiscoveryCache(outputDir: string): void;
```

## Behavioral Rules

1. **Git hash validation**: All read functions compare stored `gitHash` against provided `currentGitHash`. Mismatch → return `null` (treat as cache miss).
2. **`--use-cache` mode**: Bypasses git hash validation — loads cache regardless of hash. Uses `*Any` variants (e.g., `getCachedSeedsAny`).
3. **`--force` mode**: Calls `clearDiscoveryCache()` before starting. No cache reads.
4. **Graceful degradation**: If cache read throws (corrupt JSON, permission error), log warning and treat as miss.
5. **Atomic writes**: Write to temp file + rename to avoid partial writes on crash.
6. **Topic slug normalization**: Probe cache files named via `normalizeModuleId(topic)` for consistent file names.

## Integration Points

### `iterative-discovery.ts` changes

```typescript
// Before:
const probeResults = await runParallel(currentTopics, concurrency, async (topic) => {
    return runTopicProbe(options.repoPath, topic, { ... });
});

// After:
const { found: cachedProbes, missing: uncachedTopics } = options.outputDir && gitHash
    ? scanCachedProbes(currentTopics.map(t => t.topic), options.outputDir, gitHash)
    : { found: new Map(), missing: currentTopics.map(t => t.topic) };

const topicsToProbe = currentTopics.filter(t => uncachedTopics.includes(t.topic));
if (cachedProbes.size > 0) {
    printInfo(`Loaded ${cachedProbes.size} probes from cache, ${topicsToProbe.length} remaining`);
}

const freshProbeResults = await runParallel(topicsToProbe, concurrency, async (topic) => {
    const result = await runTopicProbe(options.repoPath, topic, { ... });
    if (options.outputDir && gitHash) {
        saveProbeResult(topic.topic, result, options.outputDir, gitHash);
    }
    return result;
});

// Combine cached + fresh
const allProbeResults = currentTopics.map(t => {
    return cachedProbes.get(t.topic) ?? freshProbeResults.find(r => r?.topic === t.topic) ?? emptyResult(t.topic);
});
```

### `large-repo-handler.ts` changes

```typescript
// Before structural scan:
const cachedScan = options.outputDir && gitHash
    ? getCachedStructuralScan(options.outputDir, gitHash)
    : null;
const scanResult = cachedScan ?? await performStructuralScan(options);
if (!cachedScan && options.outputDir && gitHash) {
    saveStructuralScan(scanResult, options.outputDir, gitHash);
}

// Before each area drill-down:
const cachedArea = options.outputDir && gitHash
    ? getCachedAreaSubGraph(areaSlug, options.outputDir, gitHash)
    : null;
if (cachedArea) {
    printInfo(`Area "${area.name}" loaded from cache (${cachedArea.modules.length} modules)`);
    subGraphs.push(cachedArea);
} else {
    const subGraph = await discoverArea(options, area, projectName);
    if (options.outputDir && gitHash) {
        saveAreaSubGraph(areaSlug, subGraph, options.outputDir, gitHash);
    }
    subGraphs.push(subGraph);
}
```
