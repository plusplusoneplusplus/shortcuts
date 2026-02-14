# R3: Extract Phase Runners from `commands/generate.ts` (1,174 lines)

## Problem

`commands/generate.ts` is 1,174 lines. It contains `executeGenerate()` (the orchestrator) plus 5 `runPhaseN()` functions defined as inner functions, each 150-340 lines. The file is hard to navigate and phases can't be worked on independently.

## Approach

Move each `runPhaseN()` to its own file under `commands/phases/`. Convert closured variables to explicit parameters. Keep `executeGenerate()` as the thin orchestrator.

## Key Challenge: Closured Variables

The `runPhaseN()` functions are defined inside `executeGenerate()` and access these closured variables:
- `absoluteRepoPath`, `options`, `isCancelled()` — all phases
- `usageTracker` — phases 2-4
- `graph` (mutable) — phases 2-4
- `analyses` (mutable) — phase 4
- `reanalyzedModuleIds` — phase 4

Each extracted function must receive these as explicit parameters.

## File Changes

### 1. Create `commands/phases/discovery-phase.ts`

Move `runPhase1()` (lines 356-509):

```typescript
export interface DiscoveryPhaseParams {
    absoluteRepoPath: string;
    options: GenerateCommandOptions;
    isCancelled: () => boolean;
}

export async function runDiscoveryPhase(params: DiscoveryPhaseParams): Promise<ModuleGraph>
```

### 2. Create `commands/phases/consolidation-phase.ts`

Move `runPhase2Consolidation()` (lines 520-595):

```typescript
export interface ConsolidationPhaseParams {
    absoluteRepoPath: string;
    graph: ModuleGraph;
    options: GenerateCommandOptions;
    usageTracker: UsageTracker;
}

export async function runConsolidationPhase(params: ConsolidationPhaseParams): Promise<ModuleGraph>
```

### 3. Create `commands/phases/analysis-phase.ts`

Move `runPhase3Analysis()` (lines 610-838):

```typescript
export interface AnalysisPhaseParams {
    absoluteRepoPath: string;
    graph: ModuleGraph;
    options: GenerateCommandOptions;
    isCancelled: () => boolean;
    usageTracker: UsageTracker;
}

export interface AnalysisPhaseResult {
    analyses: ModuleAnalysis[];
    reanalyzedModuleIds: Set<string>;
}

export async function runAnalysisPhase(params: AnalysisPhaseParams): Promise<AnalysisPhaseResult>
```

### 4. Create `commands/phases/writing-phase.ts`

Move `runPhase4Writing()` (lines 850-1175):

```typescript
export interface WritingPhaseParams {
    absoluteRepoPath: string;
    graph: ModuleGraph;
    analyses: ModuleAnalysis[];
    options: GenerateCommandOptions;
    isCancelled: () => boolean;
    usageTracker: UsageTracker;
    reanalyzedModuleIds: Set<string>;
}

export async function runWritingPhase(params: WritingPhaseParams): Promise<GeneratedArticle[]>
```

### 5. Create `commands/phases/website-phase.ts`

Move `runPhase5Website()` (lines 1186-1210):

```typescript
export interface WebsitePhaseParams {
    absoluteRepoPath: string;
    options: GenerateCommandOptions;
}

export async function runWebsitePhase(params: WebsitePhaseParams): Promise<void>
```

### 6. Keep in `commands/generate.ts`

- `executeGenerate()` — now ~100-150 lines, calling each phase function
- `formatDuration()` — utility
- `printTokenUsageSummary()` — utility
- `generateReduceOnlyArticles()` — helper used by writing phase (or move it to writing-phase.ts)

### 7. Create `commands/phases/index.ts` barrel

```typescript
export * from './discovery-phase';
export * from './consolidation-phase';
export * from './analysis-phase';
export * from './writing-phase';
export * from './website-phase';
```

## Refactored `executeGenerate()` sketch

```typescript
export async function executeGenerate(options: GenerateCommandOptions, isCancelled: () => boolean): Promise<number> {
    // ... validation, setup (~50 lines)

    // Phase 1: Discovery
    const graph = await runDiscoveryPhase({ absoluteRepoPath, options, isCancelled });

    // Phase 2: Consolidation
    const consolidatedGraph = await runConsolidationPhase({ absoluteRepoPath, graph, options, usageTracker });

    // Phase 3: Analysis
    const { analyses, reanalyzedModuleIds } = await runAnalysisPhase({
        absoluteRepoPath, graph: consolidatedGraph, options, isCancelled, usageTracker
    });

    // Phase 4: Writing
    await runWritingPhase({
        absoluteRepoPath, graph: consolidatedGraph, analyses, options, isCancelled, usageTracker, reanalyzedModuleIds
    });

    // Phase 5: Website
    await runWebsitePhase({ absoluteRepoPath, options });

    printTokenUsageSummary(usageTracker);
    return EXIT_SUCCESS;
}
```

## Imports to Move

Each phase file will need its own imports. Move only the imports actually used by that phase (discovery imports, cache imports, etc.).

## Tests

### Existing: `test/commands/generate.test.ts`

Must pass unchanged. Tests call `executeGenerate()` which is still exported from the same module. The internal restructuring is transparent.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- The `startPhase()` helper and the Spinner usage will need to be either moved to a shared utility or passed as a parameter.
- Logger calls (`printInfo`, `printSuccess`, `printWarning`) are stateless and can be imported directly in each phase file.
- Consider doing this refactoring last among the structural changes, since it touches the most code and has the most risk of merge conflicts.
