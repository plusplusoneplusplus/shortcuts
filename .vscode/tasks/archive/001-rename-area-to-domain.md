---
status: pending
---

# 001: Rename Area to Domain

## Summary

Rename all "Area" terminology to "Domain" across the `packages/deep-wiki` codebase. This covers types, interfaces, functions, constants, variables, CSS classes, prompt text, output directory names, cache directory names, and corresponding tests. The word "area" in this context refers to the **top-level structural region** used to organize large repos (3000+ files) into hierarchical groups—not to be confused with `TopicAreaMeta` or the topic `layout: 'area'` concept (handled separately in commit 007).

## Motivation

The deep-wiki hierarchy uses three levels of terminology that are being renamed for clarity:
- **Area → Domain** (this commit): top-level structural region for large repos
- Module → Component (commit 002+): smallest analyzable unit
- Topic → Theme (commit 007): cross-cutting concern

"Domain" better conveys that these are high-level functional boundaries (e.g., "AI Pipeline Engine", "Authentication System") rather than just directory groupings.

## Changes

### 1. Type Definitions

- **`src/types.ts`**
  - `AreaInfo` → `DomainInfo` (interface, line 81)
  - `TopLevelArea` → `TopLevelDomain` (interface, line 256)
  - `area?: string` → `domain?: string` (in `ModuleInfo`, line 60)
  - `areas?: AreaInfo[]` → `domains?: DomainInfo[]` (in `ModuleGraph`, line 107)
  - `areas: TopLevelArea[]` → `domains: TopLevelDomain[]` (in `StructuralScanResult`, line 272)
  - `'area-index' | 'area-architecture'` → `'domain-index' | 'domain-architecture'` (in `ArticleType`, line 357)
  - `areaId?: string` → `domainId?: string` (in `GeneratedArticle`, line 374)
  - `layout: 'single' | 'area'` → **leave alone** (this is topic layout, commit 007)
  - `TopicAreaMeta` → **leave alone** (commit 007)
  - Update all JSDoc comments referencing "area" to say "domain" (lines 59, 78, 82, 84, 88, 90, 106, 254, 257, 271, 373, 605)
  - Update re-export of `CachedAreaGraph` → `CachedDomainGraph` (line 794)

### 2. Schemas

- **`src/schemas.ts`**
  - `STRUCTURAL_SCAN_SCHEMA`: `"areas"` → `"domains"` (line 57)
  - `"descriptive area name"` → `"descriptive domain name"` (line 59)
  - `"what this area DOES"` → `"what this domain DOES"` (line 61)

### 3. Cache Layer

- **`src/cache/types.ts`**
  - `CachedAreaGraph` → `CachedDomainGraph` (interface, line 154)
  - `"area sub-graph"` → `"domain sub-graph"` in JSDoc (lines 152, 155, 157)

- **`src/cache/discovery-cache.ts`**
  - `AREAS_DIR = 'areas'` → `DOMAINS_DIR = 'domains'` (constant, line 61)
  - `getAreasCacheDir()` → `getDomainsCacheDir()` (function, line 96)
  - `getAreaCachePath()` → `getDomainCachePath()` (function, line 111)
  - `saveAreaSubGraph()` → `saveDomainSubGraph()` (exported function, line 323)
  - `getCachedAreaSubGraph()` → `getCachedDomainSubGraph()` (exported function, line 344)
  - `scanCachedAreas()` → `scanCachedDomains()` (exported function, line 364)
  - `scanCachedAreasAny()` → `scanCachedDomainsAny()` (exported function, line 380)
  - Rename all `areaId` parameters → `domainId` (lines 111–112, 324, 345, etc.)
  - Rename `CachedAreaGraph` type references → `CachedDomainGraph`
  - Update all JSDoc comments (lines 60, 94, 109, 312, 316–319, 337–339, 357–362, 378)
  - Update section comment `// Area Sub-Graph Cache` → `// Domain Sub-Graph Cache` (line 312)

- **`src/cache/article-cache.ts`**
  - `areaId` parameter in `getArticleCachePath()` — rename parameter and update comment (lines 35–40)
  - `_reduce-area-` filename prefix → `_reduce-domain-` (line 84)
  - `areaId` parameter in `getReduceArticleCachePath()` (line 81)
  - `areaId` parameter in `getCachedArticle()` (line 102)
  - `areaDir` variable → `domainDir` (line 158)
  - `areaFiles` variable → `domainFiles` (line 160)
  - `article.areaId` references — these track the renamed field from `GeneratedArticle`
  - `areaPath` variable → `domainPath` (line 384)
  - Update all comments: "area-scoped" → "domain-scoped", "area subdirectories" → "domain subdirectories" (lines 5, 35–36, 70–71, 75, 95, 99, 103, 123, 137, 157, 169, 264, 301, 304, 367, 377, 391, 405–406, 430, 506)

- **`src/cache/cache-utils.ts`**
  - Comment: `"(probes, areas)"` → `"(probes, domains)"` (line 173)

- **`src/cache/graph-cache.ts`**
  - Comment: `"focus area"` → `"focus domain"` (line 89)

- **`src/cache/index.ts`**
  - Re-exports: `saveAreaSubGraph` → `saveDomainSubGraph`, `getCachedAreaSubGraph` → `getCachedDomainSubGraph`, `scanCachedAreas` → `scanCachedDomains`, `scanCachedAreasAny` → `scanCachedDomainsAny` (lines 37–40)

### 4. Discovery Layer

- **`src/discovery/large-repo-handler.ts`**
  - Import renames: `AreaInfo` → `DomainInfo`, `TopLevelArea` → `TopLevelDomain` (lines 21, 23)
  - Import renames: `getCachedAreaSubGraph` → `getCachedDomainSubGraph`, `saveAreaSubGraph` → `saveDomainSubGraph` (lines 34–35)
  - `discoverArea()` → `discoverDomain()` (function, line 264)
  - `area: TopLevelArea` parameter → `domain: TopLevelDomain` (line 266)
  - All local variables: `areaSlug` → `domainSlug`, `cachedArea` → `cachedDomain`, `areaModuleMap` → `domainModuleMap` (lines 179, 182, 329, etc.)
  - `mergeSubGraphs()`: rename `areas: AreaInfo[]` → `domains: DomainInfo[]`, `topLevelArea` → `topLevelDomain` (lines 381–389)
  - `area: areaSlug` spread → `domain: domainSlug` (line 341)
  - Update all comments and log messages: "area" → "domain" (lines 5, 48, 125–126, 139, 149, 166–167, 170, 172–173, 181, 188, 193, 199, 208–209, 214, 218, 258, 262, 304, 307–308, 310, 327–328, 331, 340, 344, 367, 380, 399)

- **`src/discovery/prompts.ts`**
  - `buildFocusedDiscoveryPrompt()`: `areaPath` → `domainPath`, `areaDescription` → `domainDescription` (lines 162–163)
  - Structural scan prompt text: "top-level areas" → "top-level domains", "area" → "domain" throughout (lines 101, 112, 122, 124, 139, 141)
  - Focused discovery prompt text: "area" → "domain" throughout (lines 151–152, 155–156, 166, 171, 173, 177–179, 181–184, 186, 198, 200–204)
  - `## Area Naming Guidance` → `## Domain Naming Guidance` (line 122)
  - "Focus Area" section header (lines 25, in probe-prompts.ts line 58) — **leave as-is** (generic English for the `--focus` option, not the Area type)

- **`src/discovery/response-parser.ts`**
  - `TopLevelArea` import → `TopLevelDomain` (line 12)
  - `parseAreas()` → `parseDomains()` (function, line 308)
  - `areas: parseAreas(raw.areas)` → `domains: parseDomains(raw.domains)` (line 90)
  - `areas: TopLevelArea[]` → `domains: TopLevelDomain[]` (line 311)
  - Update JSDoc comment (line 306)

- **`src/discovery/index.ts`**
  - Comment: "per-area drill-downs" → "per-domain drill-downs" (line 31)

- **`src/discovery/iterative/merge-prompts.ts`**
  - Comment: "all major areas have been probed" → "all major domains have been probed" (line 83)

### 5. Writing Layer

- **`src/writing/article-executor.ts`**
  - Imports: `AreaInfo` → `DomainInfo`, `buildAreaReducePromptTemplate` → `buildDomainReducePromptTemplate`, `getAreaReduceOutputFields` → `getDomainReduceOutputFields` (lines 34–35, 39)
  - `AreaGrouping` → `DomainGrouping` (interface, line 322)
  - `moduleAreaMap` → `moduleDomainMap`, `analysesByArea` → `analysesByDomain` (lines 323–324)
  - `AreaReduceResult` → `DomainReduceResult` (interface, line 335)
  - `areaSummary` field: `areaId` → `domainId` (line 337)
  - `groupAnalysesByArea()` → `groupAnalysesByDomain()` (exported function, line 344)
  - `areas: AreaInfo[]` parameter → `domains: DomainInfo[]` (line 346)
  - All local variables: `areaId`, `areaAnalyses`, `areaModuleSummaries`, `areaReduceInput`, `areaReduceJob`, `areaReduceExecutor`, `areaResult`, `areaOutput`, `areaSummary`, `areaSummaries` — rename `area` prefix → `domain` (lines 349–700)
  - `runAreaReducePhase()` → `runDomainReducePhase()` (function, line 452)
  - `generateStaticAreaPages()` → `generateStaticDomainPages()` (exported function, line 717)
  - `runModuleMapPhase()` parameter `moduleAreaMap` → `moduleDomainMap` (line 379)
  - `type: 'area-index'` → `type: 'domain-index'` (lines 526, 742)
  - `type: 'area-architecture'` → `type: 'domain-architecture'` (lines 543, 751)
  - `areaId: area.id` → `domainId: domain.id` (lines 507, 530, 533, 547, 746, 759)
  - `areaName` → `domainName`, `areaDescription` → `domainDescription`, `areaPath` → `domainPath` (lines 488–490)
  - `jobName: 'Area Reduce: ...'` → `'Domain Reduce: ...'` (line 502)
  - `'## Areas'` → `'## Domains'` in static pages (line 781)
  - `./areas/` → `./domains/` in markdown links (line 786)
  - Update all comments (lines 115–117, 318, 321, 334, 341–342, 373, 449, 567, 664, 666–667, 682, 688, 715, 724, 749)

- **`src/writing/reduce-prompts.ts`**
  - `buildAreaReducePromptTemplate()` → `buildDomainReducePromptTemplate()` (exported function, line 152)
  - `getAreaReduceOutputFields()` → `getDomainReduceOutputFields()` (exported function, line 219)
  - All `{{areaName}}`, `{{areaDescription}}`, `{{areaPath}}` template variables → `{{domainName}}`, `{{domainDescription}}`, `{{domainPath}}` (lines 145–147, 153, 157–159)
  - Prompt text: "area" → "domain" throughout (lines 133, 137–138, 141–142, 153–191, 204–205, 217, 228–235, 245, 254, 256, 269, 279, 281, 294–295, 310–312)
  - `## Area Information` → `## Domain Information` (line 155)
  - `## Areas` → `## Domains` (line 254)
  - `./areas/area-id/` → `./domains/domain-id/` in link instructions (lines 269, 310–312)

- **`src/writing/prompts.ts`**
  - `AreaInfo` import → `DomainInfo` (line 11)
  - `areaId` variable → `domainId` (line 112)
  - `buildCrossLinkRules(areaId?)` → `buildCrossLinkRules(domainId?)` parameter (line 167)
  - `areas/${areaId}/modules/` → `domains/${domainId}/modules/` in cross-link rules (line 181)
  - `buildModuleArticlePromptTemplate(depth, areaId?)` → `(depth, domainId?)` (line 198)
  - Update comments: "area" → "domain" (lines 162, 164, 178, 182–186, 195)

- **`src/writing/file-writer.ts`**
  - `AREAS_DIR = 'areas'` → `DOMAINS_DIR = 'domains'` (constant, line 29)
  - `areaIds` → `domainIds` (variable, line 60)
  - `article.areaId` → `article.domainId` (lines 62–63, 113)
  - `areaModulesDir` → `domainModulesDir` (line 69)
  - `case 'area-index':` → `case 'domain-index':` (line 117)
  - `case 'area-architecture':` → `case 'domain-architecture':` (line 119)
  - Update all comments (lines 28, 43–44, 59, 67, 95, 97–100, 102)

- **`src/writing/website-data.ts`**
  - `areasDir` → `domainsDir` (variable, line 115)
  - `areaDirs` → `domainDirs` (variable, line 117)
  - `areaId` → `domainId` (variable, line 121)
  - `areaDir` → `domainDir` (variable, line 122)
  - `__area_` key prefix → `__domain_` (line 129)
  - `areaModulesDir` → `domainModulesDir` (variable, line 134)
  - `'areas'` string literal → `'domains'` (line 115)
  - Update comments (lines 42, 45, 114, 124, 133)

- **`src/writing/website-styles.ts`**
  - `.nav-area-group` → `.nav-domain-group` (line 148)
  - `.nav-area-item` → `.nav-domain-item` (lines 149, 158, 159)
  - `.nav-area-children` → `.nav-domain-children` (line 161)
  - `.nav-area-module` → `.nav-domain-module` (lines 162, 170, 171)
  - Update comment: "Area-based sidebar" → "Domain-based sidebar" (line 147)

- **`src/writing/website-client-script.ts`**
  - `hasAreas` → `hasDomains` (lines 128, 157, 432, 433)
  - `moduleGraph.areas` → `moduleGraph.domains` (lines 128, 157, 219, 229, 242, 432, 434, 459)
  - `buildAreaSidebar()` → `buildDomainSidebar()` (function definition line 217, call line 159)
  - `areaModules` → `domainModules` (variables, lines 218–237, 271, 435–437, 439, 447)
  - `area.id`, `area.name`, `area.description`, `area.modules` → `domain.id`, `domain.name`, etc. (loop variables, lines 219–252, 434–461)
  - `.nav-area-*` CSS class strings → `.nav-domain-*` (lines 173, 182–188, 247, 250, 256, 260, 274–278, 281, 284, 306, 309, 314, 318, 384, 388)
  - `data-area-id` attribute → `data-domain-id` (line 251)
  - Comments: "area-based" → "domain-based" (lines 158, 216, 295)

- **`src/writing/index.ts`**
  - Re-export renames: `buildAreaReducePromptTemplate` → `buildDomainReducePromptTemplate`, `getAreaReduceOutputFields` → `getDomainReduceOutputFields` (line 16)
  - Re-export renames: `generateStaticAreaPages` → `generateStaticDomainPages` (line 17)

### 6. Server & SPA

- **`src/server/spa/client/sidebar.ts`**
  - `buildDomainSidebar()` function (was `buildAreaSidebar`, ~line 68+ in scripts version)
  - All `.nav-area-*` class references → `.nav-domain-*` (lines 44, 50–54, 103, 106, 112, 116, 130, 132, 137, 140, 163, 166, 171, 175, 202, 205, 211, 215, 232, 237, 241, 255, 259)
  - `areaMap` → `domainMap`, `areaModules` → `domainModules`, `areaItem` → `domainItem` (variable renames throughout)
  - `data-area-id` attribute → `data-domain-id`
  - `moduleGraph.areas` → `moduleGraph.domains`
  - `mod.area` → `mod.domain`
  - `topic.layout === 'area'` → **leave alone** (commit 007)
  - Comments: "area-based", "non-area repos" → "domain-based", "non-domain repos"

- **`src/server/spa/scripts/sidebar.ts`** — Same changes as client/sidebar.ts (ES5 script version)

- **`src/server/spa/client/content.ts`**
  - `hasAreas` → `hasDomains` (line 44)
  - `moduleGraph.areas` → `moduleGraph.domains` (lines 39, 42, 46, 68)
  - `areaModules` → `domainModules` (lines 43, 47, 51, 55)
  - `area.name`, `area.description`, `area.id`, `area.modules` → `domain.*` (lines 42–70)
  - `mod.area` → `mod.domain` (lines 44, 48, 70)

- **`src/server/spa/scripts/content.ts`** — Same changes (ES5 script version)

- **`src/server/spa/client/markdown.ts`**
  - `areas/` → `domains/` in regex patterns (lines 88–89)

- **`src/server/spa/scripts/markdown.ts`** — Same changes (lines 91–92, 95–96)

- **`src/server/spa/client/styles.css`**
  - `.nav-area-item` → `.nav-domain-item` (lines 275, 287, 288, 293)
  - `.nav-area-children` → `.nav-domain-children` (line 295)
  - `.nav-area-module` → `.nav-domain-module` (lines 296, 307, 308, 314)

- **`src/server/wiki-data.ts`**
  - `areasDir` → `domainsDir` (line 286)
  - `areaDirs` → `domainDirs` (line 288)
  - `areaId` → `domainId` (line 292)
  - `areaDir` → `domainDir` (line 293)
  - `__area_` prefix → `__domain_` (line 300)
  - `areaModulesDir` → `domainModulesDir` (line 305)
  - `'areas'` string → `'domains'` (line 286)
  - Comments: "area files" → "domain files" (lines 285, 295, 304)
  - `TopicAreaMeta` import and usage → **leave alone** (commit 007)

- **`src/server/generate-handler.ts`**
  - `moduleInfo.area` → `moduleInfo.domain` (line 629)
  - `areaId` variable and parameter → `domainId` (lines 629, 636, 808, 811)
  - `mod.area` → `mod.domain` (line 726)
  - Comments: "area-scoped" → "domain-scoped" (lines 803, 810)

- **`src/server/api-handlers.ts`** — **Leave alone** (only "topic areas" comments, commit 007)

- **`src/server/context-builder.ts`** — **Leave alone** (only `TopicAreaMeta` reference, commit 007)

- **`src/server/spa/html-template.ts`** — **Leave alone** (`<!-- Main Content Area -->` is generic English; `textarea` elements are HTML)

### 7. Consolidation

- **`src/consolidation/ai-consolidator.ts`**
  - `m.area` → `m.domain` (line 328)
  - `areas` variable → `domains` (line 328)
  - `area` variable → `domain` (line 329)
  - `area,` spread → `domain,` (line 341)
  - Comment: "Preserve area if consistent" → "Preserve domain if consistent" (line 327)

- **`src/consolidation/rule-based-consolidator.ts`**
  - `m.area` → `m.domain` (line 183)
  - `areas` variable → `domains` (line 183)
  - `area` variable → `domain` (line 184)
  - `area,` spread → `domain,` (line 196)
  - Comment: "Preserve area if all modules share the same area" → "...domain...domain" (line 182)

### 8. Commands

- **`src/commands/generate.ts`**
  - `graph.areas` → `graph.domains` (line 308)
  - `'Areas'` label → `'Domains'` (line 309)

- **`src/commands/phases/writing-phase.ts`**
  - `moduleInfo?.area` → `moduleInfo?.domain` (line 203)
  - `areaId` variable → `domainId` (line 203 context)
  - Comment: "reduce/area artifacts" → "reduce/domain artifacts" (line 241)

- **`src/commands/topic.ts`** — **Leave alone** (`TopicAreaMeta`, `listTopicAreas`, "topic area" — all commit 007)

### 9. Topic Module

- **`src/topic/coverage-checker.ts`**
  - `mod?.area` → `mod?.domain` (line 246)
  - `graph.areas` → `graph.domains` (line 246)
  - `area` variable → `domain` (lines 247–249)
  - `areas/${area.id}/modules/` → `domains/${domain.id}/modules/` (line 249)
  - `layout: 'area'` → **leave alone** (commit 007)
  - "topic areas" comments → **leave alone** (commit 007)

- Other topic files (`outline-generator.ts`, `outline-prompts.ts`, `article-prompts.ts`, `file-writer.ts`, `wiki-integrator.ts`) — **Leave alone** (all `area` references relate to topic layout `'area'`, commit 007)

### 10. Output Directories

- The output directory `wiki/areas/` → `wiki/domains/` is handled by the `AREAS_DIR` constant renames in `file-writer.ts` and `website-data.ts`.
- The cache directory `.wiki-cache/discovery/areas/` → `.wiki-cache/discovery/domains/` is handled by the `AREAS_DIR` constant rename in `discovery-cache.ts`.
- **Note:** Existing generated wikis and caches will need to be regenerated after this rename. No automatic migration of on-disk directory names is provided.

## Tests

All test files referencing "area" in the Area→Domain sense must be updated. Below is the full list with match counts to estimate scope:

| Test File | Matches | Key Changes |
|-----------|---------|-------------|
| `test/types.test.ts` | ~54 | `AreaInfo`, `TopLevelArea`, `area` property, `areaId`, `'area-index'`, `'area-architecture'` |
| `test/cache/discovery-cache.test.ts` | ~20 | `saveAreaSubGraph`, `getCachedAreaSubGraph`, `scanCachedAreas`, `scanCachedAreasAny`, `AREAS_DIR` paths |
| `test/cache/area-article-cache.test.ts` | ~53 | File may need renaming → `domain-article-cache.test.ts`; `areaId` params, `_reduce-area-` prefixes, area-scoped paths |
| `test/cache/reduce-article-cache.test.ts` | ~37 | `areaId` params, `_reduce-area-` prefixes, `area-index`/`area-architecture` types |
| `test/cache/article-cache.test.ts` | ~5 | `areaId` param, area-scoped comments |
| `test/cache/topic-cache.test.ts` | ~2 | Minor area references |
| `test/discovery/area-tagging.test.ts` | ~55 | File may need renaming → `domain-tagging.test.ts`; area tagging logic, `area` property, `AreaInfo` |
| `test/discovery/prompts.test.ts` | ~14 | `areaPath`, `areaDescription`, prompt text assertions |
| `test/discovery/response-parser.test.ts` | ~8 | `areas` field parsing, `TopLevelArea` fixtures |
| `test/discovery/large-repo-handler.test.ts` | ~7 | `discoverArea` mocks, area cache stubs |
| `test/discovery/iterative/probe-prompts.test.ts` | ~2 | "Focus Area" — leave if generic |
| `test/writing/hierarchical.test.ts` | ~159 | `groupAnalysesByArea`, `runAreaReducePhase`, `generateStaticAreaPages`, `AreaGrouping`, all area variables |
| `test/writing/website-generator.test.ts` | ~74 | `areas` in ModuleGraph fixtures, `areasDir`, CSS class assertions, `__area_` keys |
| `test/server/spa-template.test.ts` | ~45 | `.nav-area-*` class assertions, `buildAreaSidebar` references, `data-area-id`, `moduleGraph.areas` |
| `test/server/wiki-data.test.ts` | ~8 | `areasDir`, `__area_` keys, area directory scanning |
| `test/server/topic-support.test.ts` | ~3 | Area references in topic context — evaluate if Area→Domain or leave for 007 |
| `test/server/ask-panel.test.ts` | ~9 | Mostly `textarea` — leave alone; check for any `area` data references |
| `test/consolidation/rule-based-consolidator.test.ts` | ~12 | `area` property in module fixtures, preservation assertions |
| `test/consolidation/ai-consolidator.test.ts` | ~4 | `area` property in module fixtures |
| `test/topic/coverage-checker.test.ts` | ~5 | `mod.area`, `graph.areas` — rename; `layout: 'area'` — leave alone |
| `test/topic/outline-generator.test.ts` | ~16 | Mostly `layout: 'area'` — **leave alone** (commit 007) |
| `test/topic/wiki-integrator.test.ts` | ~12 | Mostly `layout: 'area'`, `TopicAreaMeta` — **leave alone** |
| `test/topic/file-writer.test.ts` | ~5 | Mostly `layout: 'area'` — **leave alone** |
| `test/topic/article-generator.test.ts` | ~4 | "topic area" — **leave alone** |
| `test/topic/topic-analysis.test.ts` | ~1 | Evaluate context |
| `test/commands/discover.test.ts` | ~3 | `areas` in graph fixtures |
| `test/commands/generate.test.ts` | ~3 | `graph.areas` → `graph.domains` |
| `test/commands/topic.test.ts` | ~6 | `TopicAreaMeta`, "topic areas" — **leave alone** |
| `test/commands/phases/phase-runners.test.ts` | ~2 | `area` property in fixtures |

### Test file renames (optional but recommended)

- `test/cache/area-article-cache.test.ts` → `test/cache/domain-article-cache.test.ts`
- `test/discovery/area-tagging.test.ts` → `test/discovery/domain-tagging.test.ts`

## Implementation Notes

1. **Order of changes:** Start with `types.ts` (the source of truth), then update all consumers. Use the TypeScript compiler to find missed references — any remaining `AreaInfo`, `TopLevelArea`, etc. usage will produce type errors.

2. **Search strategy:** Use case-sensitive search for `AreaInfo`, `TopLevelArea`, `CachedAreaGraph`, then case-insensitive search for `[Aa]rea` to catch variables, comments, and string literals. Exclude:
   - `TopicAreaMeta` and all topic-related "area" references
   - `textarea` HTML elements
   - `layout: 'area'` (topic layout)
   - `listTopicAreas` and "topic area" phrases
   - Generic English "Focus Area" in `--focus` prompt sections

3. **CSS class rename:** The `.nav-area-*` → `.nav-domain-*` rename spans 4 files (2 style sources + 2 script sources × 2 versions each). These must be kept in sync.

4. **Template variables in prompts:** The reduce prompts use `{{areaName}}`, `{{areaDescription}}`, `{{areaPath}}` as template variables. These must be renamed to `{{domainName}}`, `{{domainDescription}}`, `{{domainPath}}` **and** the corresponding parameter objects in `article-executor.ts` must use matching keys.

5. **Cache filename prefix:** The `_reduce-area-{areaId}` cache filename becomes `_reduce-domain-{domainId}`. This is a cache-breaking change — old caches will not be found. This is acceptable since the entire rename is a breaking change.

6. **On-disk directories:** `wiki/areas/` → `wiki/domains/` and `.wiki-cache/discovery/areas/` → `.wiki-cache/discovery/domains/`. No backward-compatibility shim is provided; users must regenerate.

7. **`areaId` field in GeneratedArticle:** This is serialized to JSON cache files. The rename from `areaId` to `domainId` means old cached articles won't match the new field name. Acceptable for a major rename.

## Acceptance Criteria

- [ ] No TypeScript compilation errors in `packages/deep-wiki/` (`npm run build` in `packages/deep-wiki`)
- [ ] All Vitest tests pass (`npm run test:run` in `packages/deep-wiki`)
- [ ] Zero occurrences of `AreaInfo`, `TopLevelArea`, `CachedAreaGraph` in src/ (excluding `TopicAreaMeta`)
- [ ] Zero occurrences of `AREAS_DIR` constant (renamed to `DOMAINS_DIR`)
- [ ] Zero occurrences of `saveAreaSubGraph`, `getCachedAreaSubGraph`, `scanCachedAreas`, `scanCachedAreasAny` in src/
- [ ] Zero occurrences of `groupAnalysesByArea`, `runAreaReducePhase`, `generateStaticAreaPages` in src/
- [ ] Zero occurrences of `buildAreaReducePromptTemplate`, `getAreaReduceOutputFields` in src/
- [ ] Zero occurrences of `buildAreaSidebar` in src/
- [ ] Zero occurrences of `'area-index'` or `'area-architecture'` string literals in src/
- [ ] Zero occurrences of `.nav-area-` CSS class prefix in src/
- [ ] Zero occurrences of `_reduce-area-` cache filename prefix in src/
- [ ] `areaId` field does not appear in types.ts `GeneratedArticle` interface (replaced by `domainId`)
- [ ] `area?: string` field does not appear in types.ts `ModuleInfo` interface (replaced by `domain?: string`)
- [ ] `TopicAreaMeta` remains unchanged (verified still present)
- [ ] `layout: 'single' | 'area'` in topic types remains unchanged
- [ ] All test file renames (if done) are reflected in test runner configuration
- [ ] Git diff shows no unintended changes outside the Area→Domain scope

## Dependencies

- Depends on: None (this is the first rename commit in the series)
- Blocks: 002 (Module→Component) — Module rename may reference `domainId` in types
- Blocks: 007 (Topic→Theme) — `TopicAreaMeta` rename depends on this being completed first
