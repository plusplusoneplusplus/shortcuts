# R4: Decompose `runHierarchicalArticleExecutor()` (323 lines)

## Problem

`runHierarchicalArticleExecutor()` in `packages/deep-wiki/src/writing/article-executor.ts` (lines 328-651) is a 323-line function that performs 4 distinct sequential steps. The cognitive load is high and individual steps can't be tested independently.

## Approach

Extract 4 helper functions. Keep them in the same file since they share types and are tightly related. The main function becomes a thin orchestrator calling the helpers in sequence.

## Steps

### 1. Extract `groupAnalysesByArea()` (lines ~353-374)

```typescript
interface AreaGrouping {
    moduleAreaMap: Map<string, string>;            // moduleId → areaId
    analysesByArea: Map<string, ModuleAnalysis[]>; // areaId → analyses
    unassignedAnalyses: ModuleAnalysis[];
}

function groupAnalysesByArea(
    analyses: ModuleAnalysis[],
    areas: AreaInfo[]
): AreaGrouping
```

Builds the mapping of modules to areas and groups analyses accordingly.

### 2. Extract `runModuleMapPhase()` (lines ~376-440)

```typescript
interface ModuleMapResult {
    articles: GeneratedArticle[];
    failedIds: Set<string>;
}

async function runModuleMapPhase(
    options: ArticleExecutorOptions,
    analyses: ModuleAnalysis[],
    graph: ModuleGraph,
    moduleAreaMap: Map<string, string>
): Promise<ModuleMapResult>
```

Runs the unified map phase across all modules, tagging results with their area.

### 3. Extract `runAreaReducePhase()` (lines ~442-559)

```typescript
interface AreaReduceResult {
    articles: GeneratedArticle[];
    areaSummary: { areaId: string; areaName: string; summary: string };
}

async function runAreaReducePhase(
    area: AreaInfo,
    areaAnalyses: ModuleAnalysis[],
    graph: ModuleGraph,
    options: ArticleExecutorOptions
): Promise<AreaReduceResult>
```

Runs reduce for a single area: generates area index and architecture articles. Includes error handling with static fallback.

### 4. Extract `runProjectReducePhase()` (lines ~561-644)

```typescript
async function runProjectReducePhase(
    areaSummaries: Array<{ areaId: string; areaName: string; summary: string }>,
    areas: AreaInfo[],
    graph: ModuleGraph,
    options: ArticleExecutorOptions
): Promise<GeneratedArticle[]>
```

Runs project-level reduce across all area summaries. Generates top-level index, architecture, and getting-started articles. Includes error handling with static fallback.

### 5. Simplify `runHierarchicalArticleExecutor()`

The main function becomes ~40-50 lines:

```typescript
async function runHierarchicalArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const { areas, analyses, graph } = /* extract from options */;

    // Step 1: Group analyses by area
    const { moduleAreaMap, analysesByArea, unassignedAnalyses } = groupAnalysesByArea(analyses, areas);

    // Step 2: Generate per-module articles
    const mapResult = await runModuleMapPhase(options, analyses, graph, moduleAreaMap);

    // Step 3: Per-area reduce
    const areaSummaries = [];
    for (const area of areas) {
        const areaAnalyses = analysesByArea.get(area.id) ?? [];
        const result = await runAreaReducePhase(area, areaAnalyses, graph, options);
        mapResult.articles.push(...result.articles);
        areaSummaries.push(result.areaSummary);
    }

    // Step 4: Project-level reduce
    const projectArticles = await runProjectReducePhase(areaSummaries, areas, graph, options);
    mapResult.articles.push(...projectArticles);

    return { articles: mapResult.articles, failedModuleIds: [...mapResult.failedIds] };
}
```

## Tests

### Existing tests must pass unchanged:

- `test/writing/article-executor.test.ts` — tests `runArticleExecutor` (public API)
- `test/writing/hierarchical.test.ts` — tests hierarchical-specific helpers

The extracted functions are **internal** (not exported), so existing tests interact through the public `runArticleExecutor` → `runHierarchicalArticleExecutor` flow.

### Optional new tests:

If any helpers are exported for testability:
- [ ] `groupAnalysesByArea` — correct grouping, unassigned modules
- [ ] `runModuleMapPhase` — article generation with area tags
- [ ] `runAreaReducePhase` — per-area reduce with fallback
- [ ] `runProjectReducePhase` — project reduce with fallback

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- Keep all 4 helpers in the same file (`article-executor.ts`) to avoid import complexity.
- The file will still be ~700 lines, but each function is independently readable at ~80-100 lines.
- Error handling (static fallback generation) stays within each phase helper — don't centralize it since each phase has different fallback logic.
