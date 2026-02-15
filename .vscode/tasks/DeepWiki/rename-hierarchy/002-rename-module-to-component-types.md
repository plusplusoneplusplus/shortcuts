---
status: pending
---

# 002: Rename Module to Component — Core Types and Schemas

## Summary

Rename all `Module`-related type definitions, interfaces, properties, schema constants, and helper functions across the deep-wiki type system. This is the foundational commit — every subsequent Module→Component commit (003–006) depends on the type definitions changed here.

## Motivation

The term "Module" is overloaded in software (Node modules, ES modules, Python modules). Renaming to "Component" improves clarity: a deep-wiki "component" is a logical unit of the codebase (a feature area, a library, a subsystem), not a language-level module. This commit handles the core type layer so that all consuming code has a stable foundation to migrate against.

## Changes

### 1. `packages/deep-wiki/src/types.ts`

**Interface renames:**
- `ModuleInfo` → `ComponentInfo` (line 40)
- `ModuleGraph` → `ComponentGraph` (line 97)
- `ModuleAnalysis` → `ComponentAnalysis` (line 290)
- `TopicRelatedModule` → `TopicRelatedComponent` (line 586)
- `TopicInvolvedModule` → `TopicInvolvedComponent` (line 634)

**Property renames inside interfaces:**
- `ModuleGraph.modules: ModuleInfo[]` → `ComponentGraph.components: ComponentInfo[]` (line 101)
- `ModuleGraph` comment "All discovered modules" → "All discovered components" (line 100)
- `AreaInfo.modules: string[]` → `AreaInfo.components: string[]` (line 91)
- `ModuleAnalysis.moduleId: string` → `ComponentAnalysis.componentId: string` (line 292)
- `GeneratedArticle.moduleId?: string` → `GeneratedArticle.componentId?: string` (line 372)
- `WikiOutput.failedModuleIds?: string[]` → `WikiOutput.failedComponentIds?: string[]` (line 404)
- `TopicRelatedComponent.moduleId: string` → `TopicRelatedComponent.componentId: string` (line 588)
- `TopicCoverageCheck.relatedModules` → `TopicCoverageCheck.relatedComponents` (line 580)
- `TopicOutline.involvedModules: TopicInvolvedModule[]` → `TopicOutline.involvedComponents: TopicInvolvedComponent[]` (line 610)
- `TopicInvolvedComponent.moduleId: string` → `TopicInvolvedComponent.componentId: string` (line 636)
- `TopicArticlePlan.coveredModuleIds: string[]` → `TopicArticlePlan.coveredComponentIds: string[]` (line 626)
- `TopicArticle.coveredModuleIds: string[]` → `TopicArticle.coveredComponentIds: string[]` (line 704)
- `TopicAreaMeta.involvedModuleIds: string[]` → `TopicAreaMeta.involvedComponentIds: string[]` (line 722)

**Type literal changes:**
- `ArticleType: 'module'` → `'component'` (line 357)

**Type reference updates (in option/result interfaces):**
- `DiscoveryResult.graph: ModuleGraph` → `ComponentGraph` (line 141)
- `AnalysisOptions.graph: ModuleGraph` → `ComponentGraph` (line 325)
- `AnalysisResult.analyses: ModuleAnalysis[]` → `ComponentAnalysis[]` (line 343)
- `WritingOptions.graph: ModuleGraph` → `ComponentGraph` (line 382)
- `WritingOptions.analyses: ModuleAnalysis[]` → `ComponentAnalysis[]` (line 384)

**Comment updates:**
- Phase pipeline comment block (lines 6–8): `ModuleGraph` → `ComponentGraph`, `ModuleAnalysis` → `ComponentAnalysis`
- `ModuleInfo` doc comment (line 38): "A single module/package/directory" → "A single component/package/directory"
- `ModuleAnalysis` doc comment (line 288): "Deep analysis result for a single module" → "Deep analysis result for a single component"
- `ModuleGraph` doc comment (line 95): "The complete module graph" → "The complete component graph"
- Various property doc comments referencing "module"

**Re-export updates (bottom of file):**
- `ProbeFoundModule` → `ProbeFoundComponent` (line 770)

### 2. `packages/deep-wiki/src/schemas.ts`

**Constant renames:**
- `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA` (line 18)
- `MODULE_ANALYSIS_SCHEMA` → `COMPONENT_ANALYSIS_SCHEMA` (line 80)
- `MODULE_ANALYSIS_REQUIRED_FIELDS` → `COMPONENT_ANALYSIS_REQUIRED_FIELDS` (line 143) — also change `'moduleId'` → `'componentId'` in the array
- `MODULE_GRAPH_REQUIRED_FIELDS` → `COMPONENT_GRAPH_REQUIRED_FIELDS` (line 174) — change `'modules'` → `'components'` in the array
- `MODULE_INFO_REQUIRED_FIELDS` → `COMPONENT_INFO_REQUIRED_FIELDS` (line 184)

**Schema string content changes in `COMPONENT_GRAPH_SCHEMA`:**
- `"modules": [` → `"components": [` (line 26)
- All interior doc-strings referencing "module" → "component" (e.g., "unique kebab-case identifier", "human-readable name", "IDs of modules this depends on" → "IDs of components this depends on")

**Schema string content changes in `COMPONENT_ANALYSIS_SCHEMA`:**
- `"moduleId": "string — must match the module ID provided"` → `"componentId": "string — must match the component ID provided"` (line 81)
- `"module": "string — module ID"` → `"component": "string — component ID"` in the internal dependencies block (line 112)
- Interior doc-strings: "how this module uses it" → "how this component uses it" (lines 113, 119)

**Function renames:**
- `isValidModuleId` → `isValidComponentId` (line 194)
- `normalizeModuleId` → `normalizeComponentId` (line 201)

**Comment updates:**
- Section header "Module Graph Schema" → "Component Graph Schema" (line 12)
- Section header "Module Analysis Schema" → "Component Analysis Schema" (line 73)
- Section header "Module Analysis Validation Helpers" → "Component Analysis Validation Helpers" (line 137)
- Doc comments on each constant: "ModuleGraph" → "ComponentGraph", "ModuleAnalysis" → "ComponentAnalysis", "ModuleInfo" → "ComponentInfo"
- "Validate that a module ID" → "Validate that a component ID" (line 193)
- "Normalize a string into a valid module ID" → "Normalize a string into a valid component ID" (line 199)

### 3. `packages/deep-wiki/src/analysis/types.ts`

**Property rename:**
- `InternalDependency.module: string` → `InternalDependency.component: string` (line 53)

**Comment updates:**
- `"Module ID of the dependency"` → `"Component ID of the dependency"` (line 52)
- File-level comment: "Sub-interfaces for ModuleAnalysis" → "Sub-interfaces for ComponentAnalysis" (line 2)
- All doc comments referencing "module" → "component" where they describe the analysis target

### 4. `packages/deep-wiki/src/discovery/iterative/types.ts`

**Interface rename:**
- `ProbeFoundModule` → `ProbeFoundComponent` (line 31)

**Property rename:**
- `TopicProbeResult.foundModules: ProbeFoundModule[]` → `TopicProbeResult.foundComponents: ProbeFoundComponent[]` (line 19)

**Comment updates:**
- "Modules found related to this topic" → "Components found related to this topic" (line 18)
- "A module found during topic probing" → "A component found during topic probing" (line 29)
- Doc comments inside `ProbeFoundComponent`: "Suggested module ID" → "Suggested component ID", etc.

**Import update:**
- `import type { ModuleGraph, TopicSeed } from '../../types'` → `import type { ComponentGraph, TopicSeed } from '../../types'` (line 10)
- `MergeResult.graph: ModuleGraph` → `ComponentGraph` (line 96)

### 5. `packages/deep-wiki/src/cache/types.ts`

**Import updates:**
- `ModuleGraph` → `ComponentGraph` (line 11)
- `ModuleAnalysis` → `ComponentAnalysis` (line 11)

**Property renames:**
- `AnalysisCacheMetadata.moduleCount: number` → `componentCount: number` (line 58)
- `CachedAnalysis.analysis: ModuleAnalysis` → `analysis: ComponentAnalysis` (line 66)
- `CachedConsolidation.graph: ModuleGraph` → `graph: ComponentGraph` (line 101)
- `CachedConsolidation.inputModuleCount: number` → `inputComponentCount: number` (line 106)
- `CachedGraph.graph: ModuleGraph` → `graph: ComponentGraph` (line 40)
- `CachedAreaGraph.graph: ModuleGraph` → `graph: ComponentGraph` (line 156)

**Comment updates:**
- "Number of cached modules" → "Number of cached components" (line 57)
- "The cached module graph" → "The cached component graph" (line 39)
- "Number of input modules before consolidation" → "Number of input components before consolidation" (line 105)
- Other doc comments referencing "module" in context of the graph/analysis

### 6. `packages/deep-wiki/src/server/wiki-data.ts`

**Import updates:**
- `ModuleGraph` → `ComponentGraph` (line 12)
- `ModuleInfo` → `ComponentInfo` (line 12)
- `ModuleAnalysis` → `ComponentAnalysis` (line 12)

**Interface renames:**
- `ModuleSummary` → `ComponentSummary` (line 21)
- `ModuleDetail` → `ComponentDetail` (line 33)

**Property renames:**
- `ModuleDetail.module: ModuleInfo` → `ComponentDetail.component: ComponentInfo` (line 34)
- `ModuleDetail.analysis?: ModuleAnalysis` → `ComponentDetail.analysis?: ComponentAnalysis` (line 36)

**Method renames on `WikiData` class:**
- `getModuleSummaries()` → `getComponentSummaries()` (line 122)
- `getModuleDetail(moduleId)` → `getComponentDetail(componentId)` (line 136)
- `readModuleGraph()` → `readComponentGraph()` (line 252) — note: the JSON filename `module-graph.json` stays unchanged for backward compat (add a TODO comment)
- `findModuleIdBySlug()` → `findComponentIdBySlug()` (line 391)

**Internal variable renames:**
- `modulesDir` → `componentsDir` (line 275)
- `areaModulesDir` → `areaComponentsDir` (line 305) — note: the directory name `modules/` on disk stays unchanged for backward compat
- `this._graph.modules` references → `this._graph.components` (line 394)
- `analysis.moduleId` → `analysis.componentId` (line 336–337)

**Property type updates:**
- `_graph: ModuleGraph | null` → `_graph: ComponentGraph | null` (line 76)
- `_analyses: Map<string, ModuleAnalysis>` → `_analyses: Map<string, ComponentAnalysis>` (line 78)
- `graph` getter return type: `ModuleGraph` → `ComponentGraph` (line 105)

**Comment updates:**
- File-level: "module graph, markdown articles, analyses" → "component graph, markdown articles, analyses" (line 4)
- "Module summary returned by /api/modules" → "Component summary returned by /api/modules" (line 19) — note: API path stays for backward compat
- "Module detail returned by /api/modules/:id" → "Component detail returned by /api/modules/:id" (line 32)

### 7. `packages/deep-wiki/src/writing/article-executor.ts`

**Import updates:**
- `ModuleGraph` → `ComponentGraph` (line 25)
- `ModuleAnalysis` → `ComponentAnalysis` (line 26)
- `normalizeModuleId` → `normalizeComponentId` (line 38)

**Interface renames:**
- `ModuleMapResult` → `ComponentMapResult` (line 329)

**Interface property renames:**
- `ArticleExecutorOptions.graph: ModuleGraph` → `graph: ComponentGraph` (line 52)
- `ArticleExecutorOptions.analyses: ModuleAnalysis[]` → `analyses: ComponentAnalysis[]` (line 54)
- `ArticleExecutorResult.failedModuleIds: string[]` → `failedComponentIds: string[]` (line 81)
- `AreaGrouping.moduleAreaMap` → `componentAreaMap` (line 323)
- `AreaGrouping.analysesByArea: Map<string, ModuleAnalysis[]>` → `Map<string, ComponentAnalysis[]>` (line 324)
- `AreaGrouping.unassignedAnalyses: ModuleAnalysis[]` → `ComponentAnalysis[]` (line 325)
- `AreaReduceResult.areaSummary.moduleCount` → `componentCount` (line 337)

**Function parameter/variable renames:**
- `analysisToPromptItem(analysis: ModuleAnalysis, graph: ModuleGraph)` → `(analysis: ComponentAnalysis, graph: ComponentGraph)` (lines 94–96)
- `moduleInfo` → `componentInfo` (line 98)
- `moduleName` → `componentName` (line 99)
- `moduleId` → `componentId` in PromptItem construction (line 102) — **Note:** keep as `moduleId` key if prompt template references `{{moduleId}}`; verify template before renaming
- `failedModuleIds` → `failedComponentIds` throughout (lines 196, 215, etc.)
- `groupAnalysesByArea` parameters: `analyses: ModuleAnalysis[]` → `ComponentAnalysis[]` (line 345)
- `moduleAreaMap` → `componentAreaMap` in `groupAnalysesByArea` body (lines 348–369)
- `runModuleMapPhase` → `runComponentMapPhase` (line 375)
- Internal variables: `moduleId`, `moduleInfo`, `moduleName` → `componentId`, `componentInfo`, `componentName` throughout map/reduce phases

**Function signature updates:**
- `generateStaticAreaPages(area, analyses: ModuleAnalysis[], graph: ModuleGraph)` → `ComponentAnalysis[]`, `ComponentGraph` (line 717)
- `generateStaticHierarchicalIndexPages(graph: ModuleGraph, ...)` → `ComponentGraph` (line 768)
- `generateStaticIndexPages(graph: ModuleGraph, analyses: ModuleAnalysis[])` → `ComponentGraph`, `ComponentAnalysis[]` (line 817)
- `runHierarchicalArticleExecutor` internal variables (lines 670+)

**Schema function call updates:**
- All calls to `normalizeModuleId(...)` → `normalizeComponentId(...)` (lines 209, 737, 849)

### 8. `packages/deep-wiki/src/server/index.ts` (re-exports)

- `export type { ModuleSummary, ModuleDetail, ... }` → `export type { ComponentSummary, ComponentDetail, ... }` (line 249)

### 9. `packages/deep-wiki/src/writing/index.ts` (re-exports)

- `buildModuleArticlePrompt` → `buildComponentArticlePrompt` (line 15)
- `buildModuleArticlePromptTemplate` → `buildComponentArticlePromptTemplate` (line 15)
- `buildModuleSummaryForReduce` → `buildComponentSummaryForReduce` (line 16)
- `readModuleGraph` → `readComponentGraph` (line 19)

### 10. `packages/deep-wiki/src/consolidation/index.ts` (re-exports)

- `consolidateModules` → `consolidateComponents` (line 12)
- `getModuleDirectory` → `getComponentDirectory` (line 13)

### 11. `packages/deep-wiki/src/discovery/index.ts` (re-exports)

- `parseModuleGraphResponse` → `parseComponentGraphResponse` (line 20)
- `discoverModuleGraph` → `discoverComponentGraph` (line 36)

### 12. `packages/deep-wiki/src/analysis/index.ts` (re-exports)

- `analyzeModules` → `analyzeComponents` (line 35)

### 13. `packages/deep-wiki/src/cache/index.ts` (re-exports)

- `getModulesNeedingReanalysis` → `getComponentsNeedingReanalysis` (line 82)

## Implementation Notes

1. **Backward-compatible JSON filenames on disk stay unchanged for now.** The file `module-graph.json` and directories like `modules/` are part of the persisted wiki output format. Renaming these is a separate, breaking change that should be handled in a later migration commit. Add `// TODO(rename-hierarchy): rename file to component-graph.json in output format migration` comments where applicable.

2. **Prompt template variables:** The `{{moduleId}}` and `{{moduleName}}` template variables used in `article-executor.ts` PromptItem construction must be kept in sync with the prompt templates in `writing/prompts.ts` and `writing/reduce-prompts.ts`. Those prompt files are updated in commit 003 or 004. Until then, keep the PromptItem keys as `moduleId`/`moduleName` to avoid breaking the template engine, OR update prompts in the same commit.

3. **Re-export backward compatibility:** Consider adding deprecated type aliases for the old names (e.g., `export type ModuleGraph = ComponentGraph`) in a `deprecated.ts` file to ease migration for any external consumers. This is optional if the package is internal-only.

4. **Search-and-replace order:** Rename interfaces and types first, then properties, then function names, then local variables. This minimizes intermediate type errors during implementation.

5. **`AreaInfo.modules` → `AreaInfo.components`:** This field holds component IDs (strings). The field name changes but the semantics are the same — it's a list of component IDs belonging to the area.

6. **`ArticleType: 'module'` → `'component'`:** This is a string literal type used in discriminated unions. All consumers that match on `type === 'module'` must update to `type === 'component'`. Search for `'module'` string literals in writing and server code.

## Tests

### Update `test/types.test.ts`
- All imports: `ModuleGraph` → `ComponentGraph`, `ModuleInfo` → `ComponentInfo`, etc.
- All schema constant references: `MODULE_GRAPH_REQUIRED_FIELDS` → `COMPONENT_GRAPH_REQUIRED_FIELDS`, etc.
- `isValidModuleId` → `isValidComponentId` test suite and all calls
- `normalizeModuleId` → `normalizeComponentId` test suite and all calls
- Type-checking tests that reference `modules` property → `components`
- `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA`, `MODULE_ANALYSIS_SCHEMA` → `COMPONENT_ANALYSIS_SCHEMA`

### Update test helper factories (across ~44 test files)
- Helper functions like `makeModule()`, `createTestModuleGraph()`, `makeGraphModule()`, `makeModuleAnalysis()` must be renamed to `makeComponent()`, `createTestComponentGraph()`, `makeGraphComponent()`, `makeComponentAnalysis()` — these are updated in commits 003–006 alongside their consuming source files.

### This commit's test scope
Only `test/types.test.ts` is updated in this commit since it directly tests the schemas and validation helpers being renamed. Other test files are updated alongside their corresponding source files in subsequent commits.

## Acceptance Criteria

- [ ] All 7 core type/schema files compile with zero errors (`cd packages/deep-wiki && npx tsc --noEmit`)
- [ ] `isValidComponentId` and `normalizeComponentId` pass all existing tests under new names
- [ ] `COMPONENT_GRAPH_REQUIRED_FIELDS` contains `['project', 'components', 'categories']`
- [ ] `COMPONENT_ANALYSIS_REQUIRED_FIELDS` contains `['componentId', 'overview']`
- [ ] `COMPONENT_INFO_REQUIRED_FIELDS` contains `['id', 'name', 'path']`
- [ ] `COMPONENT_GRAPH_SCHEMA` string contains `"components": [` (not `"modules": [`)
- [ ] `COMPONENT_ANALYSIS_SCHEMA` string contains `"componentId":` (not `"moduleId":`)
- [ ] `ArticleType` includes `'component'` (not `'module'`)
- [ ] `test/types.test.ts` passes: `cd packages/deep-wiki && npx vitest run test/types.test.ts`
- [ ] No references to old names remain in the 7 files listed above (verified via `grep -rn 'ModuleGraph\|ModuleInfo\|ModuleAnalysis\|MODULE_GRAPH\|MODULE_ANALYSIS\|MODULE_INFO\|isValidModuleId\|normalizeModuleId' packages/deep-wiki/src/types.ts packages/deep-wiki/src/schemas.ts packages/deep-wiki/src/analysis/types.ts packages/deep-wiki/src/discovery/iterative/types.ts packages/deep-wiki/src/cache/types.ts packages/deep-wiki/src/server/wiki-data.ts packages/deep-wiki/src/writing/article-executor.ts`)

## Dependencies

- **Depends on:** 001 (Area → Domain rename must land first so we branch from clean state)
- **Depended on by:** 003, 004, 005, 006 (all subsequent Module→Component commits import from types/schemas changed here)
