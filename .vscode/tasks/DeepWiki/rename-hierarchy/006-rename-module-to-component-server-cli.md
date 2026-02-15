---
status: pending
---

# 006: Rename Module to Component — Server, SPA, CLI, and Commands

## Summary

Rename all "Module" references to "Component" across the deep-wiki **server layer** (wiki-data, API handlers, explore/ask/context-builder, generate-handler, file-watcher, router, index), the **SPA client layer** (sidebar, content, admin, core, graph, ask-ai, websocket, html-template, index), and the **CLI layer** (cli.ts, commands/discover, commands/generate, commands/serve, commands/seeds, ai-invoker, usage-tracker, logger, index). This includes types, interfaces, function names, API route paths, CSS classes, HTML element IDs, JSDoc comments, user-facing strings, and corresponding test files.

## Motivation

Continuing the systematic Module → Component rename across the deep-wiki codebase (see earlier plans 001–005). This plan covers the outermost layers that directly surface module terminology to end users: the HTTP API, the browser SPA, and the CLI output. Completing this ensures full consistency from the core types through to the user-facing surface.

## Changes

### Files to Modify

#### Server Layer — `packages/deep-wiki/src/server/`

**1. `wiki-data.ts`**
| Old | New |
|-----|-----|
| `interface ModuleSummary` | `interface ComponentSummary` |
| `interface ModuleDetail` | `interface ComponentDetail` |
| `ModuleDetail.module: ModuleInfo` | `ComponentDetail.component: ComponentInfo` |
| `getModuleSummaries(): ModuleSummary[]` | `getComponentSummaries(): ComponentSummary[]` |
| `getModuleDetail(moduleId): ModuleDetail \| null` | `getComponentDetail(componentId): ComponentDetail \| null` |
| `readModuleGraph(): ModuleGraph` | `readComponentGraph(): ComponentGraph` |
| `readAnalyses(): Map<string, ModuleAnalysis>` | `readAnalyses(): Map<string, ComponentAnalysis>` |
| `_graph: ModuleGraph \| null` | `_graph: ComponentGraph \| null` |
| `_analyses: Map<string, ModuleAnalysis>` | `_analyses: Map<string, ComponentAnalysis>` |
| `findModuleIdBySlug(slug)` | `findComponentIdBySlug(slug)` |
| `readMarkdownFiles()` — variable names `modulesDir`, `moduleId`, comments referencing "module" | Rename to `componentsDir`, `componentId`, update comments |
| `graph.modules.find(…)` references inside methods | `graph.components.find(…)` (depends on 002 types rename) |
| file path `'module-graph.json'` | `'component-graph.json'` |
| directory `'modules'` in `readMarkdownFiles()` | `'components'` |
| `analysis.moduleId` check | `analysis.componentId` |
| JSDoc comments mentioning "module" | Update to "component" |
| Re-exports at bottom: `ModuleSummary`, `ModuleDetail` | `ComponentSummary`, `ComponentDetail` |

**2. `api-handlers.ts`**
| Old | New |
|-----|-----|
| Route `GET /api/modules` | `GET /api/components` |
| Route `GET /api/modules/:id` | `GET /api/components/:id` |
| `handleGetModules(res, wikiData)` | `handleGetComponents(res, wikiData)` |
| `handleGetModuleById(res, wikiData, moduleId)` | `handleGetComponentById(res, wikiData, componentId)` |
| `const moduleMatch = pathname.match(/^\/api\/modules\/(.+)$/)` | `const componentMatch = pathname.match(/^\/api\/components\/(.+)$/)` |
| `wikiData.getModuleSummaries()` | `wikiData.getComponentSummaries()` |
| `wikiData.getModuleDetail(moduleId)` | `wikiData.getComponentDetail(componentId)` |
| `send404(res, 'Module not found: …')` | `send404(res, 'Component not found: …')` |
| `const exploreModuleId = …` | `const exploreComponentId = …` |
| JSDoc comments: "module summaries", "single module" | Update to "component" |

**3. `ask-handler.ts`**
| Old | New |
|-----|-----|
| `context.moduleIds` in SSE event | `context.componentIds` |
| `buildAskPrompt()` — `'## Relevant Module Documentation'` | `'## Relevant Component Documentation'` |
| `'Answer … based on the provided module documentation'` | `'… component documentation'` |
| `'Reference specific modules by name'` | `'Reference specific components by name'` |

**4. `explore-handler.ts`**
| Old | New |
|-----|-----|
| `ExploreRequest` JSDoc: `POST /api/explore/:moduleId` | `POST /api/explore/:componentId` |
| `handleExploreRequest(req, res, moduleId, options)` param name | `componentId` |
| `graph.modules.find(m => m.id === moduleId)` | `graph.components.find(…)` |
| `send … 'Module not found: ${moduleId}'` | `'Component not found: …'` |
| `wikiData.getModuleDetail(moduleId)` | `wikiData.getComponentDetail(componentId)` |
| `buildExplorePrompt(mod, …)` — string `"${mod.name}" module` | `"${mod.name}" component` |
| `'## Module Information'` | `'## Component Information'` |
| `'Analyzing ${mod.name} module...'` SSE status | `'Analyzing ${mod.name} component...'` |
| All `mod.dependencies`, `mod.dependents` iteration text | Update comments only (variable names stay if they match the data shape) |
| Deep analysis task text: `'other modules'` | `'other components'` |

**5. `context-builder.ts`**
| Old | New |
|-----|-----|
| `IndexedDocument.moduleId: string` | `componentId: string` |
| `source: 'module' \| 'topic'` | `source: 'component' \| 'topic'` |
| `RetrievedContext.moduleIds: string[]` | `componentIds: string[]` |
| `contextParts.push('## Module: …')` | `'## Component: …'` |
| `buildGraphSummary()` — `'Modules: ${this.graph.modules.length}'` | `'Components: …'` |
| `'Module Graph:'` heading | `'Component Graph:'` |
| `graph.modules` iteration | `graph.components` (depends on 002) |
| `moduleScores` variable | `componentScores` |
| `topModules` → `topComponents` |
| `selectedIds`, `expandedIds` loop over `mod.dependencies` | Update variable names referencing module |
| JSDoc: "module articles", "relevant modules" | "component articles", "relevant components" |

**6. `conversation-session-manager.ts`**
- No direct "module" references in identifiers or user-facing strings. Only import types may change indirectly via 002. **No changes needed.**

**7. `router.ts`**
- No direct "module" string literals in route patterns (routes delegate to `api-handlers.ts`). Only JSDoc comment `'GET /api/* → API handlers'` — generic, no change needed. **No changes needed.**

**8. `index.ts` (server)**
| Old | New |
|-----|-----|
| `import type { ModuleGraph } from '../types'` (if present) | `ComponentGraph` (cascaded from 002) |
| `moduleGraph: wikiData.graph` in `FileWatcher` options | `componentGraph: wikiData.graph` |
| `wsServer!.broadcast({ type: 'rebuilding', modules: … })` | `{ type: 'rebuilding', components: … }` |
| `wsServer!.broadcast({ type: 'reload', modules: … })` | `{ type: 'reload', components: … }` |
| Re-export: `ModuleSummary, ModuleDetail` | `ComponentSummary, ComponentDetail` |
| Re-export: `ExploreRequest` — unchanged name, but JSDoc | Already fine |

**9. `generate-handler.ts`**
| Old | New |
|-----|-----|
| Route `POST /api/admin/generate/module/:moduleId` | `POST /api/admin/generate/component/:componentId` |
| `handleModuleRegenerate(req, res, moduleId, context)` | `handleComponentRegenerate(…, componentId, …)` |
| `runModuleRegeneration(res, context, moduleId, …)` | `runComponentRegeneration(…)` |
| `send500(res, 'Failed to regenerate module article')` | `'… component article'` |
| `send404(res, 'Module not found: …')` | `'Component not found: …'` |
| `'No analysis cached for module …'` | `'… component …'` |
| `getModuleArticleCacheStatus()` | `getComponentArticleCacheStatus()` |
| `phases['4'].modules = modules` | `phases['4'].components = components` |
| `graph.modules.find(…)` iterations | `graph.components.find(…)` |
| `'Discovered N modules'`, `'Loaded cached module graph (N modules)'` | `'… components'` |
| `'Consolidated to N modules'`, `'Analyzed N modules'` | `'… components'` |
| `'No cached module graph found'`, `'No module graph available'`, `'No module graph'` | `'… component graph …'` |
| `buildModuleArticlePrompt(…)` import | `buildComponentArticlePrompt(…)` (depends on writing rename) |
| `normalizeModuleId(…)` import | `normalizeComponentId(…)` (depends on schemas rename) |
| `type: 'module'` in article object | `type: 'component'` |
| `article.moduleId` | `article.componentId` |
| `'module-graph.json'` file path | `'component-graph.json'` |
| SSE messages: `moduleId` field in events | `componentId` field |

**10. `file-watcher.ts`**
| Old | New |
|-----|-----|
| `FileWatcherOptions.moduleGraph: ModuleGraph` | `componentGraph: ComponentGraph` |
| Internal references to `moduleGraph` / `modules` | `componentGraph` / `components` |
| `onChange: (affectedModuleIds: string[]) => void` | `(affectedComponentIds: string[]) => void` |
| Comments: "modules are affected" | "components are affected" |

**11. `admin-handlers.ts`**
- Routes `/api/admin/seeds`, `/api/admin/config` — no "module" references. Generate routes delegate to `generate-handler.ts`. **No direct changes needed** (changes cascade through `generate-handler.ts`).

**12. `types.ts` (server)**
- `ServeCommandOptions` — no "module" references. **No changes needed.**

#### SPA Layer — `packages/deep-wiki/src/server/spa/`

**13. `html-template.ts`**
| Old | New |
|-----|-----|
| `placeholder="Search modules..."` | `"Search components..."` |
| `aria-label="Search modules"` | `"Search components"` |
| `'Deep analysis of each module'` (Phase 3 desc) | `'… each component'` |
| `'Merge related modules into clusters'` (Phase 2 desc) | `'… components …'` |
| `'Modules (<span …>0</span>)'` (Phase 4 toggle) | `'Components (…)'` |
| Element IDs: `phase4-module-toggle`, `phase4-module-count`, `phase4-module-list` | `phase4-component-toggle`, `phase4-component-count`, `phase4-component-list` |

**14. `client/sidebar.ts`**
| Old | New |
|-----|-----|
| `item.className = 'nav-area-module'` (multiple) | `'nav-area-component'` |
| `item.onclick = … loadModule(mod.id)` | `loadComponent(mod.id)` |
| `document.querySelectorAll('.nav-area-module[data-id], …')` | `'.nav-area-component[data-id], …'` |
| `group.querySelectorAll('.nav-area-module:not(…)')` | `'.nav-area-component:not(…)'` |
| `item.className = 'nav-area-module nav-topic-article'` | `'nav-area-component nav-topic-article'` |
| `'.nav-item, .nav-area-module, .nav-area-item'` in `setActive()` | `'.nav-item, .nav-area-component, .nav-area-item'` |
| `'.nav-area-module[data-id="…"]'` in `setActive()` | `'.nav-area-component[data-id="…"]'` |

**15. `client/content.ts`**
| Old | New |
|-----|-----|
| `loadModule(moduleId, skipHistory)` | `loadComponent(componentId, skipHistory)` |
| `renderModulePage(mod, markdown)` | `renderComponentPage(mod, markdown)` |
| `regenerateModule(moduleId)` | `regenerateComponent(componentId)` |
| `history.pushState({ type: 'module', id: … }, '', …+'#module-'+…)` | `{ type: 'component', id: … }, …+'#component-'+…` |
| `'Loading module...'` | `'Loading component...'` |
| `fetch('/api/modules/' + …)` | `fetch('/api/components/' + …)` |
| `'Failed to load module'` | `'Failed to load component'` |
| `'Error loading module: …'` | `'Error loading component: …'` |
| `'module-regen-btn'` element ID | `'component-regen-btn'` |
| `'module-article-body'` element ID | `'component-article-body'` |
| `'module-page-header'` CSS class | `'component-page-header'` |
| `'module-regen-btn'` CSS class | `'component-regen-btn'` |
| `onclick="regenerateModule(…)"` | `"regenerateComponent(…)"` |
| `title="Regenerate this module's article…"` | `"… component's article…"` |
| `'Regenerate the article for this module?'` confirm text | `'… component?'` |
| `markdownCache[moduleId]` → variable name `moduleId` → `componentId` | Update throughout |
| `fetch('/api/admin/generate/module/' + …)` | `fetch('/api/admin/generate/component/' + …)` |
| `showHome()` — `'<h3>All Modules</h3>'` | `'All Components'` |
| `'<h3>Modules</h3><div class="value">'` in stats | `'Components'` stat card |
| `'module-grid'` CSS class | `'component-grid'` |
| `'module-card'` CSS class | `'component-card'` |
| `onclick="loadModule(…)"` in home cards | `"loadComponent(…)"` |

**16. `client/admin.ts`**
| Old | New |
|-----|-----|
| `initPhase4ModuleList()` | `initPhase4ComponentList()` |
| `renderPhase4ModuleList(modules)` | `renderPhase4ComponentList(components)` |
| `runModuleRegenFromAdmin(moduleId)` | `runComponentRegenFromAdmin(componentId)` |
| `phase4Data.modules` | `phase4Data.components` |
| Element IDs: `phase4-module-toggle`, `phase4-module-list`, `phase4-module-count` | `phase4-component-*` |
| `phase4-mod-row-`, `phase4-mod-log-` ID prefixes | `phase4-comp-row-`, `phase4-comp-log-` |
| `'phase-module-row'`, `'phase-module-badge'`, `'phase-module-id'`, `'phase-module-name'`, `'phase-module-run-btn'`, `'phase-module-log'` CSS classes | `'phase-component-row'`, `'phase-component-badge'`, etc. |
| `onclick="runModuleRegenFromAdmin(…)"` | `"runComponentRegenFromAdmin(…)"` |
| `title="Regenerate article for …"` | stays the same (name-based) |
| `fetch('/api/admin/generate/module/' + …)` | `fetch('/api/admin/generate/component/' + …)` |
| `moduleGraph.modules.find(…)` | `moduleGraph.components.find(…)` |

**17. `client/core.ts`**
| Old | New |
|-----|-----|
| `moduleGraph` global variable | `componentGraph` |
| `setModuleGraph(graph)` | `setComponentGraph(graph)` |
| `currentModuleId` | `currentComponentId` |
| `setCurrentModuleId(id)` | `setCurrentComponentId(id)` |
| `'Failed to load module graph'` in `init()` | `'Failed to load component graph'` |
| `'Error loading wiki data'` — unchanged (generic) | No change |
| `popstate` handler: `state.type === 'module'` | `state.type === 'component'` |
| `loadModule(state.id, true)` | `loadComponent(state.id, true)` |

**18. `client/index.ts`**
| Old | New |
|-----|-----|
| `import { … loadModule, … regenerateModule } from './content'` | `loadComponent, regenerateComponent` |
| `import { … runModuleRegenFromAdmin } from './admin'` | `runComponentRegenFromAdmin` |
| `(window as any).loadModule = loadModule` | `.loadComponent = loadComponent` |
| `(window as any).regenerateModule = regenerateModule` | `.regenerateComponent = regenerateComponent` |
| `(window as any).runModuleRegenFromAdmin = …` | `.runComponentRegenFromAdmin = …` |

**19. `client/graph.ts`**
| Old | New |
|-----|-----|
| `moduleGraph.modules` usage | `componentGraph.components` |
| `moduleGraph.categories` | `componentGraph.categories` |
| `moduleGraph.project` | `componentGraph.project` |
| `currentModuleId` import | `currentComponentId` |
| `setCurrentModuleId` import | `setCurrentComponentId` |

**20. `client/ask-ai.ts`**
| Old | New |
|-----|-----|
| `moduleGraph` import | `componentGraph` |
| `addDeepDiveButton(moduleId)` — internal reference variable | `componentId` |
| `fetch('/api/explore/' + …)` — unchanged route path | No change (route path stays `/api/explore/:id`) |

**21. `client/websocket.ts`**
| Old | New |
|-----|-----|
| `currentModuleId` import | `currentComponentId` |
| `msg.modules` in reload handling | `msg.components` |

**22. `client/styles.css`**
| Old | New |
|-----|-----|
| `.nav-area-module` | `.nav-area-component` |
| `.module-grid` | `.component-grid` |
| `.module-card` | `.component-card` |
| `.module-page-header` | `.component-page-header` |
| `.module-regen-btn` | `.component-regen-btn` |
| `.phase-module-*` classes | `.phase-component-*` |

**23. `spa/scripts/` (mirror of client/ for non-bundled mode)**
All files in `scripts/` mirror the `client/` changes above: `sidebar.ts`, `content.ts`, `admin.ts`, `core.ts`, `graph.ts`, `ask-ai.ts`, `theme.ts`, `toc.ts`, `websocket.ts`. Apply identical renames.

#### CLI Layer — `packages/deep-wiki/src/`

**24. `cli.ts`**
| Old | New |
|-----|-----|
| `.description('Discover module graph for a repository')` | `'Discover component graph …'` |
| `'module graph'` references in help text and error messages | `'component graph'` |

**25. `commands/discover.ts`**
| Old | New |
|-----|-----|
| `discoverModuleGraph` import | `discoverComponentGraph` (depends on discovery rename) |
| `'Deep Wiki — Discovery Phase'` header | Unchanged (generic) |
| `printKeyValue('Modules', …)` | `printKeyValue('Components', …)` |
| `printSuccess('Found cached module graph …')` | `'… component graph …'` |
| `'Discovering module graph...'` spinner | `'Discovering component graph...'` |
| `printSuccess('Module graph written to …')` | `'Component graph written to …'` |
| `printInfo('Cached module graph for future use')` | `'… component graph …'` |
| `printWarning('Failed to cache module graph …')` | `'… component graph …'` |
| `'No cached module graph found …'` error | `'… component graph …'` |
| `outputFile = 'module-graph.json'` | `'component-graph.json'` |
| `for (const mod of graph.modules)` iteration variable — cosmetic | Can keep `mod` or rename to `comp` |
| JSDoc: `'ModuleGraph JSON'` | `'ComponentGraph JSON'` |

**26. `commands/generate.ts`**
| Old | New |
|-----|-----|
| `'Discovery → ModuleGraph'` JSDoc | `'→ ComponentGraph'` |
| `'ModuleAnalysis[]'` JSDoc | `'ComponentAnalysis[]'` |
| `import type { … ModuleGraph, ModuleAnalysis }` | `ComponentGraph, ComponentAnalysis` |
| `getCachedGraph` / `getCachedGraphAny` | Unchanged function names (cascade from cache rename) |
| `let graph: ModuleGraph` | `let graph: ComponentGraph` |
| `let analyses: ModuleAnalysis[]` | `let analyses: ComponentAnalysis[]` |
| `printSuccess('Loaded cached module graph (N modules)')` | `'… component graph (N components)'` |
| `printKeyValue('Modules Discovered', …)` | `'Components Discovered'` |
| `printKeyValue('Modules Analyzed', …)` | `'Components Analyzed'` |
| `printError('No cached module graph found …')` | `'… component graph …'` |
| `printError('No cached analyses found …')` | Unchanged (generic) |
| `printSuccess('Loaded N cached module analyses')` | `'… component analyses'` |
| `graph.modules.length` display values | `graph.components.length` |
| `'module-graph.json'` file path | `'component-graph.json'` |

**27. `commands/serve.ts`**
| Old | New |
|-----|-----|
| `const graphPath = path.join(…, 'module-graph.json')` | `'component-graph.json'` |
| `printError('module-graph.json not found …')` | `'component-graph.json not found …'` |
| `printInfo('The wiki directory does not contain generated wiki data.')` | Unchanged |

**28. `commands/seeds.ts`**
- No "module" references in identifiers or user-facing strings. **No changes needed.**

**29. `ai-invoker.ts`**
| Old | New |
|-----|-----|
| JSDoc: `'Phase 3 (Analysis) uses direct sessions with MCP tools'` | Unchanged (generic) |
| `AnalysisInvokerOptions` JSDoc — no "module" word | No change |
| `createAnalysisInvoker()` — no "module" word | No change |
| `createConsolidationInvoker()` JSDoc: `'Module Consolidation'` | `'Component Consolidation'` |
| `'The AI only needs to analyze the module list'` | `'… component list'` |

**30. `usage-tracker.ts`**
- `TrackedPhase` uses `'discovery' | 'consolidation' | 'analysis' | 'writing'` — no "module" word. **No changes needed.**

**31. `logger.ts`**
- No "module" references in identifiers or strings. **No changes needed.**

**32. `index.ts` (CLI entry point)**
| Old | New |
|-----|-----|
| JSDoc: `'Discover module graph for a repository'` | `'… component graph …'` |

#### Test Files — `packages/deep-wiki/test/`

**33. `test/server/wiki-data.test.ts`**
- Update all `ModuleSummary` / `ModuleDetail` type references, method calls (`getModuleSummaries`, `getModuleDetail`), assertion strings (`'Module not found'`), mock file paths (`'module-graph.json'`, `'modules/'`), and variable names.

**34. `test/server/api-handlers.test.ts`**
- Update route paths (`/api/modules`, `/api/modules/:id`), handler function names, mock calls, response assertions.

**35. `test/server/ask-handler.test.ts`**
- Update `context.moduleIds` assertions, prompt text expectations.

**36. `test/server/explore-handler.test.ts`**
- Update `moduleId` parameters, `'Module not found'` assertions, prompt content checks.

**37. `test/server/context-builder.test.ts`**
- Update `moduleIds` in results, `IndexedDocument.moduleId`, graph summary text expectations.

**38. `test/server/conversation-session-manager.test.ts`**
- No "module" references expected. **Verify, likely no changes needed.**

**39. `test/server/spa-template.test.ts`**
- Update `'Search modules'` string assertions, phase description text, element ID assertions.

**40. `test/server/index.test.ts`**
- Update broadcast message assertions (`modules:` → `components:`), re-export checks.

**41. `test/server/generate-handler.test.ts`**
- Update route path `/api/admin/generate/module/`, SSE event `moduleId` field assertions, error messages.

**42. `test/server/websocket.test.ts`**
- Likely no "module" strings. **Verify, likely no changes needed.**

**43. `test/server/file-watcher.test.ts`**
- Update `moduleGraph` option name, `affectedModuleIds` callback assertions.

**44. `test/server/admin-handlers.test.ts`**
- No direct "module" route strings (delegates to generate-handler). **Verify, likely no changes needed.**

**45. `test/commands/discover.test.ts`**
- Update output/assertion strings: `'module graph'`, `'module-graph.json'`, `'Modules'` key-value.

**46. `test/commands/generate.test.ts`**
- Update `'module graph'` strings, `ModuleGraph` type references, `graph.modules.length` assertions.

**47. `test/commands/serve.test.ts`**
- Update `'module-graph.json'` path validation assertions.

**48. `test/commands/seeds.test.ts`**
- No "module" references expected. **Verify, likely no changes needed.**

**49. `test/cli.test.ts`**
- Update `'Discover module graph'` description assertion.

**50. `test/ai-invoker.test.ts`**
- Update `'Module Consolidation'` JSDoc if tested, otherwise likely no changes.

**51. `test/usage-tracker.test.ts`**
- No "module" references. **No changes needed.**

## Implementation Notes

### API Route Changes

Routes change as follows (no backward compatibility needed):

| Old Route | New Route |
|-----------|-----------|
| `GET /api/modules` | `GET /api/components` |
| `GET /api/modules/:id` | `GET /api/components/:id` |
| `POST /api/explore/:moduleId` | `POST /api/explore/:componentId` (param name only) |
| `POST /api/admin/generate/module/:moduleId` | `POST /api/admin/generate/component/:componentId` |

The SPA client `fetch()` calls in `content.ts` and `admin.ts` must update in lockstep with the server routes.

### WebSocket Message Schema Change

Broadcast messages change from `{ type: 'reload', modules: [...] }` to `{ type: 'reload', components: [...] }`. The SPA `websocket.ts` client must update its `msg.modules` to `msg.components`.

### CSS Class Rename

CSS classes `nav-area-module`, `module-grid`, `module-card`, `module-page-header`, `module-regen-btn`, and `phase-module-*` all rename to their `-component` counterparts. Both `client/styles.css` and any inline class references in TypeScript must be updated.

### HTML Element ID Rename

Element IDs: `module-regen-btn`, `module-article-body`, `phase4-module-toggle`, `phase4-module-count`, `phase4-module-list`, `phase4-mod-row-*`, `phase4-mod-log-*` all rename to use `component`/`comp` equivalents. These appear in both `html-template.ts` and the client TypeScript.

### File Path Changes

- `module-graph.json` → `component-graph.json` (wiki-data.ts, discover.ts, generate.ts, serve.ts, generate-handler.ts)
- `modules/` directory → `components/` directory (wiki-data.ts readMarkdownFiles)

### Ordering Consideration

This plan depends on **002** (core types: `ModuleGraph` → `ComponentGraph`, `ModuleInfo` → `ComponentInfo`, `ModuleAnalysis` → `ComponentAnalysis`) being completed first. It also depends on **004/005** (writing/schemas: `buildModuleArticlePrompt` → `buildComponentArticlePrompt`, `normalizeModuleId` → `normalizeComponentId`).

### `scripts/` vs `client/` Directories

The `spa/scripts/` directory contains a parallel set of TypeScript files that mirror `spa/client/`. Both sets need identical renames. If `scripts/` is auto-generated from `client/`, only `client/` needs editing; otherwise both require manual updates.

## Tests

- Run `npm run test:run` in `packages/deep-wiki/` to execute all Vitest tests
- All 23 test files across server, commands, and CLI must pass
- Focus verification on:
  - `test/server/api-handlers.test.ts` — route path assertions
  - `test/server/wiki-data.test.ts` — method name and type assertions
  - `test/server/explore-handler.test.ts` — parameter name assertions
  - `test/server/context-builder.test.ts` — result field name assertions
  - `test/server/generate-handler.test.ts` — route and SSE event assertions
  - `test/server/spa-template.test.ts` — HTML content assertions
  - `test/commands/discover.test.ts` — output string assertions
  - `test/commands/generate.test.ts` — type and string assertions
  - `test/commands/serve.test.ts` — file path assertions
  - `test/cli.test.ts` — command description assertions

## Acceptance Criteria

- [ ] All `ModuleSummary` → `ComponentSummary` and `ModuleDetail` → `ComponentDetail` types renamed in `wiki-data.ts` and re-exports in `index.ts`
- [ ] All `getModuleSummaries()` / `getModuleDetail()` methods renamed to `getComponentSummaries()` / `getComponentDetail()`
- [ ] API routes `/api/modules` and `/api/modules/:id` changed to `/api/components` and `/api/components/:id`
- [ ] Admin route `/api/admin/generate/module/:moduleId` changed to `/api/admin/generate/component/:componentId`
- [ ] All SPA `fetch()` calls updated to use new API routes
- [ ] CSS classes `nav-area-module`, `module-grid`, `module-card`, `phase-module-*` renamed to `*-component` equivalents
- [ ] HTML element IDs `module-regen-btn`, `module-article-body`, `phase4-module-*` renamed
- [ ] SPA global functions `loadModule`, `regenerateModule`, `runModuleRegenFromAdmin` renamed to `loadComponent`, `regenerateComponent`, `runComponentRegenFromAdmin`
- [ ] SPA core globals `moduleGraph` → `componentGraph`, `currentModuleId` → `currentComponentId`
- [ ] WebSocket broadcast messages use `components` field instead of `modules`
- [ ] CLI `discover` command description says "component graph" not "module graph"
- [ ] File paths `module-graph.json` → `component-graph.json` and `modules/` → `components/` directory
- [ ] All user-facing strings (error messages, spinner text, status messages) updated
- [ ] All corresponding test files updated and passing
- [ ] `npm run test:run` in `packages/deep-wiki/` passes all tests
- [ ] No remaining references to "module" (case-insensitive grep excluding `node_modules/`) in the changed files, except where "module" refers to JavaScript/Node.js modules (e.g., `import`, `export`, ES module system)

## Dependencies

- Depends on: 002 (core types rename: `ModuleGraph` → `ComponentGraph`, `ModuleInfo` → `ComponentInfo`, `ModuleAnalysis` → `ComponentAnalysis`)
- Depends on: 004 (writing layer: `buildModuleArticlePrompt` → `buildComponentArticlePrompt`)
- Depends on: 005 (schemas: `normalizeModuleId` → `normalizeComponentId`)
