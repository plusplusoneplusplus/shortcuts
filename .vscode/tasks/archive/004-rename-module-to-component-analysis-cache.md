---
status: pending
---

# 004: Rename Module to Component — Analysis and Cache Layers

## Summary

Rename all "Module" → "Component" references across the deep-wiki analysis (`packages/deep-wiki/src/analysis/`) and cache (`packages/deep-wiki/src/cache/`) source and test files. This covers function names, parameter names, variable names, type references, string literals, comments, and AI prompt templates.

## Motivation

Continuing the systematic Module → Component rename across the deep-wiki codebase. The analysis and cache layers are tightly coupled — analysis produces `ModuleAnalysis` objects keyed by `moduleId`, and the cache layer persists/retrieves them using `moduleId`-based paths. Both layers must be renamed together to maintain internal consistency. AI prompt templates in `prompts.ts` are especially important because they define the terminology the AI model sees and responds with.

## Changes

### Files to Modify

#### 1. `packages/deep-wiki/src/analysis/analysis-executor.ts`

**Function renames:**
- `moduleToPromptItem(module: ModuleInfo, graph: ModuleGraph)` → `componentToPromptItem(component: ComponentInfo, graph: ComponentGraph)` (line 84)

**Variable/parameter renames inside `moduleToPromptItem`:**
- `module.id`, `module.name`, `module.path`, etc. → `component.id`, `component.name`, `component.path` (lines 86–94)
- Return object keys: `moduleId` → `componentId`, `moduleName` → `componentName`, `modulePath` → `componentPath` (lines 86–88)

**Variable renames in `runAnalysisExecutor` and `executeAnalysisRound`:**
- `const modules = graph.modules` → `const components = graph.components` (line 132)
- `modules.length` → `components.length` (line 133)
- `modules, graph, aiInvoker, ...` → `components, graph, aiInvoker, ...` (lines 143, 161)
- `const retryModules = modules.filter(...)` → `const retryComponents = components.filter(...)` (line 158)
- `modules: ModuleInfo[]` → `components: ComponentInfo[]` in `AnalysisRoundOptions` interface (line 188)

**Variable renames in `executeAnalysisRound`:**
- `const items: PromptItem[] = modules.map(m => moduleToPromptItem(m, graph))` → `... components.map(c => componentToPromptItem(c, graph))` (line 210)
- `const moduleId = mapResult.item.moduleId` → `const componentId = mapResult.item.componentId` (line 248)
- All subsequent `moduleId` → `componentId` in parse calls and `failedModuleIds` → `failedComponentIds` (lines 252–300)

**Logging strings:**
- `"Retrying ${remainingFailed.length} failed module(s)"` → `"... failed component(s)"` (line 155)
- `"Analysis parse failed for module \"${moduleId}\""` → `"... for component \"${componentId}\""` (line 260)
- `"Analysis recovered for module \"${moduleId}\""` → `"... for component \"${componentId}\""` (line 280)
- `"Analysis failed for module \"${moduleId}\""` → `"... for component \"${componentId}\""` (lines 288, 293)

**Type references:**
- `ModuleInfo` → `ComponentInfo`, `ModuleGraph` → `ComponentGraph`, `ModuleAnalysis` → `ComponentAnalysis` (line 27, throughout)

**Comments:**
- JSDoc: "Converts ModuleInfo items into PromptItems" → "Converts ComponentInfo items into PromptItems" (line 5)
- "into ModuleAnalysis objects" → "into ComponentAnalysis objects" (line 7)
- "Module graph from Phase 1" → "Component graph from Phase 1" (line 41)
- "Timeout per module" → "Timeout per component" (line 47)
- "after each individual module analysis" → "after each individual component analysis" (line 58)
- "incremental per-module cache writes" → "incremental per-component cache writes" (line 59)
- "Run the analysis executor on all modules" → "... on all components" (line 105)
- "Retry failed modules" → "Retry failed components" (line 148)
- "Execute a single round of analysis for the given modules" → "... for the given components" (line 202)
- "IDs of modules that failed" → "IDs of components that failed" (line 203)

#### 2. `packages/deep-wiki/src/analysis/prompts.ts`

**AI prompt template strings — critical for AI response consistency:**
- `"investigate this module:"` → `"investigate this component:"` (lines 22, 36, 53)
- `"Identify the module's primary purpose"` → `"Identify the component's primary purpose"` (line 25)
- `"module's internal structure"` → `"component's internal structure"` (lines 44, 64)
- `"suitable for critical modules"` → `"suitable for critical components"` (line 49)
- `"Read ALL files in the module"` → `"Read ALL files in the component"` (line 55)
- `{{moduleName}}`, `{{moduleId}}`, `{{modulePath}}` → `{{componentName}}`, `{{componentId}}`, `{{componentPath}}` in template placeholders (line 88)
- `"analyzing module \"{{moduleName}}\""` → `"analyzing component \"{{componentName}}\""` (line 98)
- `"Module ID: {{moduleId}}"` → `"Component ID: {{componentId}}"` (line 100)
- `"Module path: {{modulePath}}"` → `"Component path: {{componentPath}}"` (line 101)
- `"Dependencies (other modules)"` → `"Dependencies (other components)"` (line 106)
- `"Dependents (modules that depend on this)"` → `"Dependents (components that depend on this)"` (line 107)
- `"The \"moduleId\" field MUST be exactly \"{{moduleId}}\""` → `"The \"componentId\" field MUST be exactly \"{{componentId}}\""` (line 119)
- Output field: `'moduleId'` → `'componentId'` (line 133)

**Comments:**
- "Each module is analyzed" → "Each component is analyzed" (line 4)

#### 3. `packages/deep-wiki/src/analysis/response-parser.ts`

**Field access renames:**
- `obj.module` → `obj.component` (line 192, both occurrences)
- Return object: `module: obj.module` → `component: obj.component` (line 195)
- `raw.moduleId` → `raw.componentId` (line 271)
- Return object: `moduleId` → `componentId` (line 275)

**Parameter renames:**
- `expectedModuleId` → `expectedComponentId` (line 258 JSDoc, line 271 usage)

#### 4. `packages/deep-wiki/src/analysis/index.ts`

**Export renames:**
- `moduleToPromptItem` → `componentToPromptItem` (line 18)

**Comments:**
- "Converts ModuleGraph modules" → "Converts ComponentGraph components" (line 4)
- "Analyze all modules in the graph" → "Analyze all components in the graph" (line 28)

#### 5. `packages/deep-wiki/src/analysis/types.ts`

Type definitions should already be renamed in task 002. Verify these comments are updated:
- "A key concept identified in a module" → "... in a component" (line 11)
- "A public API entry point of a module" → "... of a component" (line 24)
- "An illustrative code example from a module" → "... from a component" (line 36)
- "An internal dependency (another module in the same project)" → "... another component ..." (line 50)
- Field: `module: string` → `component: string` (line 53)
- "How this module uses the dependency" → "How this component uses the dependency" (line 54)
- "How this module uses the package" → "How this component uses the package" (line 64)

#### 6. `packages/deep-wiki/src/cache/cache-constants.ts`

**Constant value change (breaking — affects cache file paths on disk):**
- `GRAPH_CACHE_FILE = 'module-graph.json'` → `'component-graph.json'` (line 13)

**Comments:**
- "all domain-specific cache modules" → keep as-is (refers to code modules, not domain concept)
- "per-module analysis cache" → "per-component analysis cache" (line 16)
- "per-module article cache" → "per-component article cache" (line 19)

#### 7. `packages/deep-wiki/src/cache/cache-utils.ts`

**Comments:**
- "used by all cache modules" → keep as-is (refers to code modules) (line 4)

#### 8. `packages/deep-wiki/src/cache/index.ts`

**Type import:**
- `ModuleGraph` → `ComponentGraph` (line 11)

**Function rename:**
- `getModulesNeedingReanalysis(` → `getComponentsNeedingReanalysis(` (line 82)

**Variable renames inside `getModulesNeedingReanalysis`:**
- `for (const module of graph.modules)` → `for (const component of graph.components)` (line 122)
- `const modulePath = module.path...` → `const componentPath = component.path...` (line 123)
- `const keyFiles = module.keyFiles...` → `const keyFiles = component.keyFiles...` (line 124)
- `affectedModules.push(module.id)` → `affectedComponents.push(component.id)` (line 141)

**Comments/JSDoc:**
- "which modules need re-analysis" → "which components need re-analysis" (line 70)
- "For each module, check if any changed file falls under module.path" → "For each component ..." (line 74)
- "@param graph - Module graph" → "@param graph - Component graph" (line 77)
- "@returns Array of module IDs" → "@returns Array of component IDs" (line 80)
- "Re-exports all cache functions from domain-specific modules" → keep as-is (code modules) (line 4)

#### 9. `packages/deep-wiki/src/cache/discovery-cache.ts`

**Type import:**
- `ModuleGraph` → `ComponentGraph` (line 32)

**Function call:**
- `normalizeModuleId(topic)` → `normalizeComponentId(topic)` (line 112 — depends on `schemas.ts` rename in 002)

**Parameter type:**
- `graph: ModuleGraph` → `graph: ComponentGraph` (line 325)

#### 10. `packages/deep-wiki/src/cache/analysis-cache.ts`

**File-level comments:**
- "Per-Module Analysis Results" → "Per-Component Analysis Results" (line 2)
- "Caches per-module analysis results" → "Caches per-component analysis results" (line 4)

**Type import:**
- `ModuleAnalysis` → `ComponentAnalysis` (line 12)

**Function `getCachedAnalysis`:**
- Parameter: `moduleId: string` → `componentId: string` (line 58)
- JSDoc: "@param moduleId - Module ID" → "@param componentId - Component ID" (line 54)
- `getAnalysisCachePath(outputDir, moduleId)` → `getAnalysisCachePath(outputDir, componentId)` (line 60)
- Validator: `d.analysis.moduleId` → `d.analysis.componentId` (line 61)

**Function `getAllCachedAnalyses`:**
- Validator: `d.analysis.moduleId` → `d.analysis.componentId` (line 94)

**Function `saveAnalysis`:**
- Parameter: `moduleId: string` → `componentId: string` (line 127)
- Parameter: `analysis: ModuleAnalysis` → `analysis: ComponentAnalysis` (line 128)
- JSDoc: "@param moduleId - Module ID" → "@param componentId - Component ID" (line 121)
- JSDoc: "@param analysis - The analysis to cache" (line 122, keep)
- `getAnalysisCachePath(outputDir, moduleId)` → `... componentId` (line 132)

**Function `saveAllAnalyses`:**
- `saveAnalysis(analysis.moduleId, analysis, ...)` → `saveAnalysis(analysis.componentId, analysis, ...)` (line 158)

**Function `scanIndividualAnalysesCache`:**
- Parameter: `moduleIds: string[]` → `componentIds: string[]` (line 188)
- JSDoc: "@param moduleIds - Module IDs" → "@param componentIds - Component IDs" (line 181)
- JSDoc: "module IDs not found or stale" → "component IDs not found or stale" (line 186)
- Validator: `cached.analysis.moduleId` → `cached.analysis.componentId` (line 195)

**Function `scanIndividualAnalysesCacheAny`:**
- Parameter: `moduleIds: string[]` → `componentIds: string[]` (line 208)
- JSDoc: "@param moduleIds - Module IDs" → "@param componentIds - Component IDs" (line 203)
- JSDoc: "module IDs not found" → "component IDs not found" (line 205)
- Validator: `cached.analysis.moduleId` → `cached.analysis.componentId` (line 214)

#### 11. `packages/deep-wiki/src/cache/article-cache.ts`

**File-level comments:**
- "Per-Module Article Results" → "Per-Component Article Results" (line 2)
- "Caches per-module articles" → "Caches per-component articles" (line 4)

**Function `getArticleCachePath`:**
- Parameter: `moduleId: string` → `componentId: string` (line 36)
- All usages of `moduleId` in path construction → `componentId` (lines 40, 42)
- Comment: "articles/{module-id}.json" → "articles/{component-id}.json" (lines 34–35)

**Function `getCachedArticle`:**
- Parameter: `moduleId: string` → `componentId: string` (line 102)
- JSDoc: "@param moduleId - Module ID" → "@param componentId - Component ID" (line 97)
- All `getArticleCachePath(outputDir, moduleId, ...)` → `... componentId ...` (lines 105–106)

**Function `saveArticle`:**
- Parameter: `moduleId: string` → `componentId: string` (line 267)
- JSDoc: "@param moduleId - Module ID" → "@param componentId - Component ID" (line 263)
- `getArticleCachePath(outputDir, moduleId, ...)` → `... componentId ...` (line 277)

**Function `saveAllArticles`:**
- `articles.filter(a => a.type === 'module' && a.moduleId)` → `a.type === 'component' && a.componentId` (line 302)
- `const moduleArticles` → `const componentArticles` (line 302)
- `for (const article of moduleArticles)` → `... componentArticles` (line 305)
- `saveArticle(article.moduleId!, ...)` → `saveArticle(article.componentId!, ...)` (line 306)
- Comment: "only 'module' type articles are cached" → "only 'component' type articles are cached" (line 287)

**Function `scanIndividualArticlesCache`:**
- Parameter: `moduleIds: string[]` → `componentIds: string[]` (line 415)
- JSDoc: "@param moduleIds - Module IDs" → "@param componentIds - Component IDs" (line 408)
- JSDoc: "module IDs not found or stale" → "component IDs not found or stale" (line 412)

**Function `scanIndividualArticlesCacheAny`:**
- Parameter: `moduleIds: string[]` → `componentIds: string[]` (line 437)
- JSDoc: "@param moduleIds - Module IDs" → "@param componentIds - Component IDs" (line 432)
- JSDoc: "module IDs not found" → "component IDs not found" (line 434)

**Function `restampArticles`:**
- Parameter: `moduleIds: string[]` → `componentIds: string[]` (line 466)
- JSDoc: "@param moduleIds - Module IDs whose articles" → "@param componentIds - Component IDs whose articles" (line 460)
- `for (const moduleId of moduleIds)` → `for (const componentId of componentIds)` (line 472)

#### 12. `packages/deep-wiki/src/cache/topic-cache.ts`

No module references found. No changes needed. (Topic → Theme is tracked in task 007.)

### Test Files to Modify

#### 13. `packages/deep-wiki/test/analysis/prompts.test.ts`

- Template placeholder assertions: `'{{moduleName}}'`, `'{{moduleId}}'`, `'{{modulePath}}'` → `'{{componentName}}'`, `'{{componentId}}'`, `'{{componentPath}}'` (line 24)
- `expect(template).toContain('"moduleId"')` → `'"componentId"'` (line 36)
- `expect(template).toContain('{{moduleName}}')` → `'{{componentName}}'` (line 59)
- `expect(fields).toContain('moduleId')` → `'componentId'` (line 122)

#### 14. `packages/deep-wiki/test/analysis/response-parser.test.ts`

**Fixture data:**
- `VALID_ANALYSIS_JSON.moduleId: 'auth'` → `componentId: 'auth'` (line 17)
- `overview: 'The auth module handles...'` → `'The auth component handles...'` (line 18)
- `internal: [{ module: 'database', usage: ... }]` → `{ component: 'database', ... }` (line 35)

**All `moduleId` references in test assertions** (~40 occurrences, lines 90–438):
- `result.moduleId` → `result.componentId`
- JSON strings: `"moduleId": "auth"` → `"componentId": "auth"`
- Destructuring: `const { moduleId, ...rest }` → `const { componentId, ...rest }`
- Test descriptions: `'should use expected moduleId'` → `'should use expected componentId'`

**String literals in test data:**
- `'A test module for unit testing.'` → `'A test component for unit testing.'`
- `'A minimal module.'` → `'A minimal component.'`
- `'A well-structured module.'` → `'A well-structured component.'`
- `'test-module'` → `'test-component'` (line 140)
- Various narrative strings mentioning "module" in AI response simulations

#### 15. `packages/deep-wiki/test/cache/discovery-cache.test.ts`

- Type import: `ModuleGraph` → `ComponentGraph` (line 17)
- Helper function: `createTestGraph(moduleIds: string[]): ModuleGraph` → `createTestGraph(componentIds: string[]): ComponentGraph` (line 98)
- `modules: moduleIds.map(...)` → `components: componentIds.map(...)` (line 107)
- `purpose: \`${id} module\`` → `\`${id} component\`` (line 111)
- `categories: [{ name: 'core', description: 'Core modules' }]` → `'Core components'` (line 118)

#### 16. `packages/deep-wiki/test/cache/analysis-cache.test.ts`

- Type imports: `ModuleAnalysis`, `ModuleGraph` → `ComponentAnalysis`, `ComponentGraph` (line 13)
- Comment: "per-module analysis caching" → "per-component analysis caching" (line 4)
- Helper: `createTestAnalysis(moduleId: string): ModuleAnalysis` → `createTestAnalysis(componentId: string): ComponentAnalysis` (line 46)
- Return object: `moduleId` field → `componentId` (line 48)
- Helper: `createTestGraph(moduleIds: string[]): ModuleGraph` → `... componentIds ...`: ComponentGraph` (line 62)
- `modules: moduleIds.map(...)` → `components: componentIds.map(...)` (line 71)
- `purpose: \`${id} module\`` → `\`${id} component\`` (line 75)
- `describe('getModulesNeedingReanalysis', ...)` → `'getComponentsNeedingReanalysis'` (line 260)
- All `getModulesNeedingReanalysis(...)` calls → `getComponentsNeedingReanalysis(...)` (lines 262, 277, 290, 305, 317, 329, 341)

#### 17. `packages/deep-wiki/test/cache/article-cache.test.ts`

- Comment: "per-module article caching" → "per-component article caching" (line 4)
- Test article fixture: `type: 'module'` → `'component'` (line 49)
- `moduleId` field in fixtures → `componentId` (line 53)
- All `article.moduleId` / `result.found.map(a => a.moduleId)` → `.componentId` (lines 99, 190, 217, 307, 333, 364, 450, 580, 581, 624, 661, 700, 780)
- `expect(loaded!.type).toBe('module')` → `'component'` (line 168)
- Test description: "should only cache module-type articles" → "should only cache component-type articles" (line 205)
- Comment: "Verify metadata count reflects only module articles" → "... component articles" (line 219)
- `'my-complex_module.v2'` → `'my-complex_component.v2'` (lines 580–581)
- Test description: "concurrent saves to different modules" → "... different components" (line 622)
- `\`module-${i}\`` → `\`component-${i}\`` (line 624)

#### 18. `packages/deep-wiki/test/cache/reduce-article-cache.test.ts`

- Comment: "module articles change" → "component articles change" (line 9)
- Comment: "Isolation from module article cache" → "... component article cache" (line 10)
- Helper: `createModuleArticle(moduleId: ...)` → `createComponentArticle(componentId: ...)` (line 57)
- `type: 'module'` → `'component'` (line 59)
- `moduleId` field → `componentId` (line 63)
- Test descriptions and comments: all "module articles" → "component articles" (lines 151, 167, 332, 336, 391, 392, 414–416, 429, 433, 458, 460, 508–509, 590, 717, 720, 732, 763, 778, 786, 801, 812, 827, 833)
- `moduleMetadata` variable → `componentMetadata` (line 472)
- `moduleMetadata.moduleCount` → `componentMetadata.componentCount` (line 479)
- `moduleArticles` variable → `componentArticles` (lines 416, 720, 763)
- `moduleResult` variable → `componentResult` (lines 786, 812, 833)
- All `.every(a => a.type !== 'module')` → `!== 'component'` (line 164)
- All `.every(a => a.type === 'module')` → `=== 'component'` (line 433)
- `loaded!.moduleId` → `loaded!.componentId` (lines 407, 411)

#### 19. `packages/deep-wiki/test/cache/area-article-cache.test.ts`

- Helper: `createTestArticle(moduleId: string, ...)` → `createTestArticle(componentId: string, ...)` (line 49)
- `title: \`${moduleId} Module\`` → `\`${componentId} Component\`` (line 53)
- `moduleId` field → `componentId` (line 55)
- All `loaded!.moduleId` → `loaded!.componentId` (lines 101, 113, 217, 302)
- `result.found.map(a => a.moduleId)` → `.componentId` (line 155)

#### 20. `packages/deep-wiki/test/cache/cache-utils.test.ts`

- `probeResult: { topic: string; modules: string[] }` → `components: string[]` (line 372)
- Update corresponding test data that uses this interface

#### 21. `packages/deep-wiki/test/cache/index.test.ts`

- `moduleId: 'mod-a'` → `componentId: 'mod-a'` (lines 339, 407)
- Any other `moduleId` references in cached analysis fixtures

## Implementation Notes

1. **Cache file path breaking change:** Changing `GRAPH_CACHE_FILE` from `'module-graph.json'` to `'component-graph.json'` means existing caches on disk won't be found. This is acceptable for a major rename — users will simply regenerate. Document in CHANGELOG.

2. **AI prompt changes are semantically significant.** The `prompts.ts` changes affect what terms the AI model uses in its responses. The `response-parser.ts` changes must match — it now expects `componentId` in JSON output instead of `moduleId`. These two files must be updated atomically.

3. **Type renames (`ModuleAnalysis` → `ComponentAnalysis`, etc.) are done in task 002.** This task uses the new type names but must wait for 002 to land first. If working on a branch, rebase onto 002 before starting.

4. **`article-cache.ts` article type filter:** The `type === 'module'` filter in `saveAllArticles` (line 302) and tests must change to `type === 'component'`. This interacts with the `GeneratedArticle.type` field rename in the types layer (task 002). Verify the `type` enum/literal is updated there.

5. **`normalizeModuleId` → `normalizeComponentId`** in `discovery-cache.ts` depends on the schemas rename in task 002. Verify the export exists before importing.

6. **`topic-cache.ts` has zero module references** — no changes needed here. Topic → Theme renaming is tracked separately in task 007.

7. **No `executor.test.ts` exists** in `test/analysis/`. The analysis executor is tested indirectly through integration tests. No new test file needed.

8. **`moduleCount` in reduce-article metadata:** The `_reduce_metadata.json` files contain `moduleCount`. This is a serialized field — check if `reduce-article-cache.ts` reads/writes it and update accordingly (covered in `reduce-article-cache.test.ts` assertions at lines 351, 383, 479, 648).

## Tests

Run after all changes:

```bash
cd packages/deep-wiki && npm run test:run
```

Expected: all 23 test files pass. Key test files to watch:

| Test File | What It Validates |
|-----------|-------------------|
| `test/analysis/prompts.test.ts` | Template placeholders now use `componentId`/`componentName`/`componentPath` |
| `test/analysis/response-parser.test.ts` | Parser extracts `componentId` from AI JSON responses |
| `test/cache/analysis-cache.test.ts` | Per-component analysis save/load/scan with `componentId` |
| `test/cache/article-cache.test.ts` | Per-component article save/load/scan, `type: 'component'` filter |
| `test/cache/reduce-article-cache.test.ts` | Reduce cache isolation from component articles, `componentCount` metadata |
| `test/cache/area-article-cache.test.ts` | Hierarchical article caching with `componentId` |
| `test/cache/discovery-cache.test.ts` | `ComponentGraph` type usage in test helpers |
| `test/cache/cache-utils.test.ts` | Probe result interface with `components` field |
| `test/cache/index.test.ts` | `getComponentsNeedingReanalysis` function export |

Also run a grep to verify no stray `moduleId`, `ModuleAnalysis`, `moduleToPromptItem`, or `getModulesNeedingReanalysis` references remain:

```bash
cd packages/deep-wiki
grep -rn --include='*.ts' -E '(moduleId|ModuleAnalysis|ModuleGraph|ModuleInfo|moduleToPromptItem|getModulesNeedingReanalysis|normalizeModuleId|moduleName|modulePath|module-graph\.json)' src/analysis/ src/cache/ test/analysis/ test/cache/
```

Expected: zero matches (except any `module` references that refer to Node.js/ES modules rather than the domain concept).

## Acceptance Criteria

- [ ] `moduleToPromptItem` renamed to `componentToPromptItem` in source and re-exported from `analysis/index.ts`
- [ ] All AI prompt templates in `prompts.ts` use "component" terminology and `{{componentId}}`/`{{componentName}}`/`{{componentPath}}` placeholders
- [ ] `response-parser.ts` expects and extracts `componentId` from AI responses
- [ ] `GRAPH_CACHE_FILE` constant changed to `'component-graph.json'`
- [ ] `getCachedAnalysis`, `saveAnalysis`, `scanIndividualAnalysesCache`, `scanIndividualAnalysesCacheAny` all use `componentId` parameter
- [ ] `getCachedArticle`, `saveArticle`, `saveAllArticles`, `scanIndividualArticlesCache`, `scanIndividualArticlesCacheAny`, `restampArticles` all use `componentId` parameter
- [ ] `saveAllArticles` filters on `type === 'component'` instead of `type === 'module'`
- [ ] `getModulesNeedingReanalysis` renamed to `getComponentsNeedingReanalysis` in `cache/index.ts`
- [ ] All test files updated with new function names, field names, and assertion values
- [ ] `npm run test:run` in `packages/deep-wiki` passes with zero failures
- [ ] No stray `moduleId`/`ModuleAnalysis`/`ModuleGraph` references in `src/analysis/`, `src/cache/`, `test/analysis/`, `test/cache/`

## Dependencies

- Depends on: **002** (type definitions: `ModuleInfo` → `ComponentInfo`, `ModuleGraph` → `ComponentGraph`, `ModuleAnalysis` → `ComponentAnalysis`, `normalizeModuleId` → `normalizeComponentId` in schemas)
