---
status: pending
---

# 005: Rename Module to Component — Writing Layer

## Summary

Rename all "module" references to "component" in the deep-wiki **writing layer** (`packages/deep-wiki/src/writing/`) and its associated tests. This covers article generation, file writing, prompt templates, reduce prompts, website generation, and the client-side script. Output directory paths change from `modules/` to `components/`.

## Motivation

Part of the codebase-wide "Module → Component" rename (see 001–004). The writing layer is the heaviest consumer of the word "module" — it appears in variable names, function names, interface fields, prompt text, output directory paths, cross-link URLs, HTML class names, and embedded client-side JavaScript. This task ensures the generated wiki output consistently uses "component" terminology.

## Changes

### Files to Modify

#### 1. `article-executor.ts` — Heaviest file

**Interface / Type renames:**
- `ArticleExecutorResult.failedModuleIds` → `failedComponentIds` (line 81)
- `AreaGrouping.moduleAreaMap` → `AreaGrouping.componentDomainMap` (line 323)
- `ModuleMapResult` (local interface, line 329) → `ComponentMapResult`
- `AreaReduceResult.areaSummary.moduleCount` → `componentCount` (line 338)

**Import renames (already renamed in prior tasks):**
- `ModuleGraph` → `ComponentGraph` (from `../types`, task 002)
- `ModuleAnalysis` → `ComponentAnalysis` (from `../types`, task 002)
- `normalizeModuleId` → `normalizeComponentId` (from `../schemas`, task 001)

**Variable / parameter renames throughout:**
| Old name | New name | Occurrences (approx.) |
|---|---|---|
| `moduleId` | `componentId` | ~20 (lines 98, 201, 208, 213, 215, 234, 324, 349–350, 358–359, 424–427, 471) |
| `moduleInfo` | `componentInfo` | ~4 (lines 98, 201, 425) |
| `moduleName` | `componentName` | ~4 (lines 99, 103, 202, 426) |
| `moduleGraph` (PromptItem field) | `componentGraph` | ~1 (line 105) |
| `moduleSummaries` | `componentSummaries` | ~1 (line 222) |
| `moduleAreaMap` | `componentDomainMap` | ~5 (lines 323, 348, 369, 378, 427) |
| `failedModuleIds` | `failedComponentIds` | ~4 (lines 81, 196, 215, 704) |
| `moduleCount` | `componentCount` | ~3 (lines 338, 510, 512, 536) |
| `areaModuleSummaries` | `areaComponentSummaries` | ~1 (line 460) |

**Function-internal renames in `runFlatArticleExecutor`:**
- `moduleSummaries` (line 222) → `componentSummaries`
- `buildModuleSummaryForReduce` call arguments stay (renamed in reduce-prompts.ts)

**Function-internal renames in `runModuleMapPhase` → rename to `runComponentMapPhase`:**
- Function name: `runModuleMapPhase` → `runComponentMapPhase` (line 375)

**Function-internal renames in `groupAnalysesByArea`:**
- `moduleAreaMap` → `componentDomainMap` (lines 323, 348–349, 358)
- Loop var `moduleId` in `area.modules` → `componentId` in `area.components` (depends on type rename in 002)

**Static fallback functions:**
- `generateStaticAreaPages`: string literal `'## Modules'` → `'## Components'` (line 731); link path `./modules/` → `./components/` (line 738)
- `generateStaticHierarchicalIndexPages`: string `(${summary.moduleCount} modules)` → `(${summary.componentCount} components)` (line 786)
- `generateStaticIndexPages`: section header `'## Modules'` → `'## Components'` (line 829); link path `./modules/` → `./components/` (line 850)

**GeneratedArticle type field `'module'`:**
- All `type: 'module'` → `type: 'component'` (lines 208, 433) — depends on 002 updating the `ArticleType` union

**Doc comments:** Update references to "per-module" → "per-component", "module articles" → "component articles" throughout file header and function JSDoc.

#### 2. `file-writer.ts`

**Constants:**
- `MODULES_DIR = 'modules'` → `COMPONENTS_DIR = 'components'` (line 27)
- All references to `MODULES_DIR` → `COMPONENTS_DIR` (lines 52, 69, 114)

**Variables:**
- `modulesDir` → `componentsDir` (lines 52, 57)

**`getArticleFilePath` switch cases:**
- `case 'module':` → `case 'component':` (line 112) — depends on 002

**Comment / doc-string updates:**
- File header: `modules/` → `components/` in the directory layout diagram (lines 9–12)
- JSDoc: "module articles" → "component articles"; `wiki/modules/` → `wiki/components/`; `wiki/areas/{areaId}/modules/` → `wiki/areas/{areaId}/components/` (lines 41–48, 97–107)
- Constant comment: "Subdirectory for module articles" → "Subdirectory for component articles" (line 26)

#### 3. `prompts.ts`

**Import renames (from 002):**
- `ModuleAnalysis` → `ComponentAnalysis`
- `ModuleGraph` → `ComponentGraph`
- `ModuleInfo` → `ComponentInfo`

**Prompt text string literals (all three depth variants):**
- `SHALLOW_STYLE`: "summarizing the module's purpose" → "summarizing the component's purpose" (line 37); "what this module does" → "what this component does" (line 39); "how to use this module" → "how to use this component" (line 42)
- `NORMAL_STYLE`: same pattern — ~6 occurrences of "module" in lines 47–57
- `DEEP_STYLE`: same pattern — ~12 occurrences of "module" in lines 59–76

**Function renames:**
- `buildModuleArticlePrompt` → `buildComponentArticlePrompt` (line 101)
- `buildModuleArticlePromptTemplate` → `buildComponentArticlePromptTemplate` (line 198)

**Variable renames inside `buildModuleArticlePrompt`:**
- `moduleInfo` → `componentInfo` (line 110)
- `moduleName` → `componentName` (line 111)

**Template placeholder renames:**
- `{{moduleName}}` → `{{componentName}}` (lines 202, 209, 235)
- `{{moduleGraph}}` → `{{componentGraph}}` (line 219)
- `{{moduleId}}` in PromptItem field references (line 102)

**Cross-link rules in `buildCrossLinkRules`:**
- Flat: `[Module Name](./modules/module-id.md)` → `[Component Name](./components/component-id.md)` (lines 172–174)
- Hierarchical: `areas/{areaId}/modules/` → `areas/{areaId}/components/` (lines 181–187)

**Prompt body text:**
- `"${moduleName}" module` → `"${componentName}" component` (line 115, template line 202)
- `## Module Graph` → `## Component Graph` (line 128, template line 217)
- "cross-references to other modules" → "cross-references to other components" (line 129, template line 219)
- Format section: `src/module/file.ts:42` → `src/component/file.ts:42` (line 154, template line 243)

#### 4. `reduce-prompts.ts`

**Function renames:**
- `buildModuleSummaryForReduce` → `buildComponentSummaryForReduce` (line 118)

**Parameter renames in `buildModuleSummaryForReduce`:**
- `moduleId` → `componentId` (line 119)
- `moduleName` → `componentName` (line 120)

**Template text in `buildReducePromptTemplate`:**
- `## Module Articles` → `## Component Articles` (line 38)
- `{{COUNT}} modules have been analyzed` → `{{COUNT}} components have been analyzed` (line 40)
- Section instructions: "module listing" → "component listing", "module articles" → "component articles", `./modules/module-id.md` → `./components/component-id.md` (lines 54–57, 68–69, 96–97)
- `[Module Name](./modules/module-id.md)` → `[Component Name](./components/component-id.md)` (line 96)

**Template text in `buildAreaReducePromptTemplate`:**
- `## Module Articles` → `## Component Articles` (line 164)
- `{{COUNT}} modules in this area` → `{{COUNT}} components in this area` (line 166)
- `Module listing` → `Component listing`; `./modules/module-id.md` → `./components/component-id.md` (lines 177–178)
- Cross-link rules: `./modules/module-id.md` → `./components/component-id.md`; `../../other-area-id/modules/` → `../../other-area-id/components/` (lines 204–205)

**Template text in `buildHierarchicalReducePromptTemplate`:**
- `./areas/area-id/modules/module-id.md` → `./areas/area-id/components/component-id.md` (line 310)

**Doc comments:** All JSDoc referencing "module summaries" → "component summaries".

#### 5. `website-generator.ts`

**Import renames (from 002):**
- `ModuleGraph` → `ComponentGraph` (via `website-data.ts` re-export)

**Function renames in re-exports:**
- `readModuleGraph` → `readComponentGraph` (line 26, re-exported)

**Variables:**
- `moduleGraph` → `componentGraph` (line 59)

**HTML template:**
- `Search modules...` → `Search components...` (line 147)

#### 6. `website-data.ts`

**Import renames (from 002):**
- `ModuleGraph` → `ComponentGraph`

**Function renames:**
- `readModuleGraph` → `readComponentGraph` (line 23)
- `findModuleIdBySlug` → `findComponentIdBySlug` (line 211, private)

**File path constants:**
- `'module-graph.json'` → `'component-graph.json'` (line 24) — or keep if file is renamed in a separate task
- `'modules'` directory references (line 68) — already handled by `MODULES_DIR` in file-writer, but `readMarkdownFiles` hardcodes `'modules'` (line 68) → `'components'`
- `'areas'` subdirectory `'modules'` (line 134) → `'components'`

**Variable renames:**
- `modulesDir` → `componentsDir` (line 68)
- `moduleGraph` parameter names → `componentGraph` (lines 51, 73, 139, 167, 211)
- `moduleId` → `componentId` (lines 73–74, 139–140)
- `modSlug` → `compSlug` (line 214)

**Embedded data constants:**
- `MODULE_GRAPH` → `COMPONENT_GRAPH` (line 175) — also update client script
- `MARKDOWN_DATA` — no rename needed

**Doc comments:** Update all "module graph" → "component graph", "module ID" → "component ID".

#### 7. `website-client-script.ts`

**JavaScript variable renames (string template):**
- `moduleGraph` → `componentGraph` (~40+ occurrences, lines 28, 35, 43, 124–125, 128, 166, 219–243, 298, 340, 384, 399, 408–482, 499, 558–561)
- `currentModuleId` → `currentComponentId` (~8 occurrences)
- `MODULE_GRAPH` → `COMPONENT_GRAPH` (line 35)
- `loadModule()` → `loadComponent()` function name (~15 call sites + definition at line 498)
- `findModuleIdBySlugClient()` → `findComponentIdBySlugClient()` (lines 705, 719)
- `areaModules` → `areaComponents` (lines 218–287)
- `otherModules` → `otherComponents` (lines 271–287)

**String literals in HTML generation:**
- `'Search modules...'` → `'Search components...'` (if present in script)
- `'Error loading module graph'` → `'Error loading component graph'` (line 43)
- `'Modules'` stat card heading → `'Components'` (line 418)
- `'All Modules'` heading → `'All Components'` (line 480)
- CSS class references: `'module-grid'` → `'component-grid'`, `'module-card'` → `'component-card'` (lines 446, 448, 468, 470, 481, 483)
- `'nav-area-module'` CSS class → `'nav-area-component'` (lines 173, 183, 260, 284, 318, 384, 388)
- History state: `'#module-'` → `'#component-'` (line 508)
- `'modules/'` in slug stripping regex (line 691) → `'components/'`

#### 8. `website-styles.ts`

**CSS class renames:**
- `.nav-area-module` → `.nav-area-component` (lines 162, 170, 171)
- `.module-grid` → `.component-grid` (line 350)
- `.module-card` → `.component-card` (lines 356, 364, 368, 369)

#### 9. `rendering/mermaid-zoom.ts`

**Doc comment only:**
- `Shared Mermaid Zoom/Pan Module` → `Shared Mermaid Zoom/Pan Component` (line 2) — or leave as-is since "module" here refers to a JS/TS module, not a domain concept. **Decision: skip** unless project convention is to rename all instances.

#### 10. `index.ts` (writing barrel)

**Re-export renames:**
- `buildModuleArticlePrompt` → `buildComponentArticlePrompt` (line 15)
- `buildModuleArticlePromptTemplate` → `buildComponentArticlePromptTemplate` (line 15)
- `buildModuleSummaryForReduce` → `buildComponentSummaryForReduce` (line 16)
- `generateStaticIndexPages` — no rename (name doesn't contain "module")
- `readModuleGraph` → `readComponentGraph` (line 19)
- Update type re-exports if `ArticleExecutorResult.failedModuleIds` changed

**Function `generateArticles`:**
- `result.failedModuleIds` → `result.failedComponentIds` (line 65)

## Implementation Notes

1. **Ordering:** This task depends on **002** (types renamed) and **001** (schemas renamed). The types `ModuleGraph`, `ModuleAnalysis`, `ModuleInfo`, `GeneratedArticle.type: 'module'`, and `normalizeModuleId` must already be renamed before this task begins.

2. **Output directory is a breaking change:** Renaming `modules/` → `components/` in wiki output changes the on-disk layout. Consumers of generated wikis (the `serve` command, any cached wikis) need updates. The `readMarkdownFiles` function in `website-data.ts` reads from `modules/` — update to `components/`. The `module-graph.json` filename may be renamed in a separate task (check 002 scope).

3. **Client-side JS is a string template:** `website-client-script.ts` generates JavaScript as a template literal. All renames are within string content — use find-and-replace carefully to avoid breaking JavaScript syntax. The `MODULE_GRAPH` global constant name must match what `website-data.ts` emits in `generateEmbeddedData`.

4. **CSS class renames must be synchronized:** `website-styles.ts` class names must match the class names used in `website-client-script.ts`. Rename both atomically.

5. **Prompt template placeholders:** `{{moduleName}}`, `{{moduleGraph}}`, `{{moduleId}}` are used by the map-reduce template engine. Renaming these requires updating both the template strings (in `prompts.ts`) and the `PromptItem` field names produced in `article-executor.ts` (`analysisToPromptItem`).

6. **`area.modules` field:** The `AreaInfo.modules` array (listing component IDs per area) will be renamed in 002. References in `groupAnalysesByArea` (`area.modules`) must use the new field name.

## Tests

### Test files to update

| Test file | Key changes |
|---|---|
| `test/writing/article-executor.test.ts` | `ModuleGraph` → `ComponentGraph`, `ModuleAnalysis` → `ComponentAnalysis`, `createTestGraph().modules` → `.components`, `moduleId` → `componentId`, `moduleName` → `componentName`, `failedModuleIds` → `failedComponentIds`, `moduleGraph` field in PromptItem → `componentGraph`, `'./modules/'` in assertions → `'./components/'` |
| `test/writing/file-writer.test.ts` | `'modules'` directory paths → `'components'` in all assertions and setup code, `type: 'module'` → `type: 'component'`, `MODULES_DIR` if referenced |
| `test/writing/prompts.test.ts` | `buildModuleArticlePrompt` → `buildComponentArticlePrompt`, `buildModuleArticlePromptTemplate` → `buildComponentArticlePromptTemplate`, assertion strings `{{moduleName}}` → `{{componentName}}`, `{{moduleGraph}}` → `{{componentGraph}}`, `'./modules/'` → `'./components/'`, `ModuleAnalysis`/`ModuleGraph` type imports |
| `test/writing/website-generator.test.ts` | `createTestModuleGraph` → `createTestComponentGraph`, `readModuleGraph` → `readComponentGraph`, `'module-graph.json'` → `'component-graph.json'`, `'modules'` dir → `'components'`, `ModuleGraph` type → `ComponentGraph`, `'Search modules'` → `'Search components'`, `MODULE_GRAPH` → `COMPONENT_GRAPH` in embedded data assertions |
| `test/writing/hierarchical.test.ts` | `ModuleGraph`/`ModuleAnalysis` type imports, `modules` array fields → `components`, `moduleId` → `componentId`, `moduleCount` → `componentCount`, `./modules/` → `./components/` in path assertions, `area.modules` → `area.components`, `'module'` type literals → `'component'` |

### Test expectations to verify after rename

- All flat-layout paths use `components/` not `modules/`
- All hierarchical paths use `areas/{id}/components/` not `areas/{id}/modules/`
- Template placeholders use `{{componentName}}`, `{{componentGraph}}`
- Embedded data JS uses `COMPONENT_GRAPH` constant name
- CSS classes `component-grid`, `component-card`, `nav-area-component` in HTML output
- `failedComponentIds` array returned correctly from executor
- Static fallback pages link to `./components/{slug}.md`

## Acceptance Criteria

- [ ] No occurrences of `moduleId`, `moduleName`, `moduleGraph`, `moduleInfo`, `moduleSummaries`, `moduleCount`, `modulesDir`, `MODULES_DIR`, `ModuleMapResult`, `failedModuleIds`, `moduleAreaMap` remain in `packages/deep-wiki/src/writing/` (excluding `rendering/mermaid-zoom.ts` line 2 JSDoc where "module" means JS module)
- [ ] No occurrences of `buildModuleArticlePrompt`, `buildModuleArticlePromptTemplate`, `buildModuleSummaryForReduce`, `readModuleGraph`, `findModuleIdBySlug` remain as export names
- [ ] Output directory constant changed from `'modules'` to `'components'`
- [ ] All prompt templates use "component" not "module" in natural-language text
- [ ] All cross-link URL patterns use `./components/` not `./modules/`
- [ ] All CSS classes renamed: `nav-area-component`, `component-grid`, `component-card`
- [ ] Client-side JS global renamed: `COMPONENT_GRAPH`, `loadComponent()`, `currentComponentId`
- [ ] `index.ts` barrel re-exports updated to new names
- [ ] All 5 writing test files updated and passing
- [ ] `npm run test:run` in `packages/deep-wiki/` passes with zero failures
- [ ] No regressions in other test suites (run from repo root)

## Dependencies

- Depends on: **002** (type renames: `ModuleGraph` → `ComponentGraph`, `ModuleAnalysis` → `ComponentAnalysis`, `ModuleInfo` → `ComponentInfo`, `GeneratedArticle` type field, `AreaInfo.modules` → `AreaInfo.components`)
- Depends on: **001** (schema renames: `normalizeModuleId` → `normalizeComponentId`)
