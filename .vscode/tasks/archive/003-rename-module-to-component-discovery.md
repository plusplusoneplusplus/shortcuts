---
status: pending
---

# 003: Rename Module to Component — Discovery, Seeds, and Consolidation

## Summary

Update all references from "Module" → "Component" across the discovery, seeds, and consolidation layers of the deep-wiki codebase. This covers type references, variable names, function names, log messages, AI prompt text, and JSDoc comments in the three source directories and their corresponding test files.

Commit 002 already renamed the core types in `types.ts` and `schemas.ts` (e.g., `ModuleGraph` → `ComponentGraph`, `ModuleInfo` → `ComponentInfo`, `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA`, `MODULE_GRAPH_REQUIRED_FIELDS` → `COMPONENT_GRAPH_REQUIRED_FIELDS`, `MODULE_INFO_REQUIRED_FIELDS` → `COMPONENT_INFO_REQUIRED_FIELDS`, `isValidModuleId` → `isValidComponentId`, `normalizeModuleId` → `normalizeComponentId`). This commit propagates those renames to every consumer.

## Motivation

Consistency with the new terminology established in 002. The word "module" is overloaded in the JS/TS ecosystem (ES modules, Node modules, `node_modules/`). "Component" better describes the architectural building blocks that deep-wiki discovers. Leaving "module" in these layers while core types use "component" would create a confusing mix.

## Changes

### Files to Modify

---

#### 1. `packages/deep-wiki/src/discovery/index.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 1 | `describing the codebase structure, modules, and dependencies.` | `describing the codebase structure, components, and dependencies.` |
| 3 | `Discover the module graph for a repository.` | `Discover the component graph for a repository.` |
| 20 | `export { parseModuleGraphResponse, ...` | `export { parseComponentGraphResponse, ...` |
| 36 | `export async function discoverModuleGraph(` | `export async function discoverComponentGraph(` |

**Import renames:** `ModuleGraph` → `ComponentGraph` (line 18 of discovery-session.ts re-export chain).

---

#### 2. `packages/deep-wiki/src/discovery/discovery-session.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 18 | `import type { DiscoveryOptions, ModuleGraph } from '../types';` | `import type { DiscoveryOptions, ComponentGraph } from '../types';` |
| 20 | `import { parseModuleGraphResponse } from './response-parser';` | `import { parseComponentGraphResponse } from './response-parser';` |
| 57 | `/** The parsed module graph */` | `/** The parsed component graph */` |
| 58 | `graph: ModuleGraph;` | `graph: ComponentGraph;` |
| 71–72 | JSDoc: `parses the AI response into a ModuleGraph` / `@returns The parsed ModuleGraph` | → `ComponentGraph` |
| 131 | `'Parsing AI response into module graph...'` | `'Parsing AI response into component graph...'` |
| 133 | `const graph = parseModuleGraphResponse(result.response);` | `const graph = parseComponentGraphResponse(result.response);` |
| 134 | `` `Parsed ${graph.modules.length} modules across...` `` | `` `Parsed ${graph.components.length} components across...` `` |
| 155 | `const graph = parseModuleGraphResponse(retryResult.response);` | `const graph = parseComponentGraphResponse(retryResult.response);` |
| 156 | `` `Retry succeeded — parsed ${graph.modules.length} modules` `` | `` `Retry succeeded — parsed ${graph.components.length} components` `` |

---

#### 3. `packages/deep-wiki/src/discovery/prompts.ts`

All AI-facing prompt text that says "module" must become "component". Key changes:

| Line(s) | Current text | Replacement text |
|----------|-------------|-----------------|
| 5 | `a structured ModuleGraph JSON` | `a structured ComponentGraph JSON` |
| 12 | `feature-oriented module graph` | `feature-oriented component graph` |
| 14 | `module structure, dependencies, and architecture. Modules should represent` | `component structure, dependencies, and architecture. Components should represent` |
| 16 | `map dependencies between modules` | `map dependencies between components` |
| 19 | `a separate module` | `a separate component` |
| 21–31 | All prompt text: `module IDs`, `module DOES`, `module per file`, etc. | → `component IDs`, `component DOES`, `component per file`, etc. |
| 25 (focus section) | `Only include modules within` | `Only include components within` |
| 35 | `node_modules, .git, dist` — **DO NOT CHANGE** this is a literal directory name |
| 48 | `feature-level sub-modules` | `feature-level sub-components` |
| 50–53 | `module IDs`, `module-name`, `module per file` | → `component IDs`, `component-name`, `component per file` |
| 59 | `## Module Naming Guidance` | `## Component Naming Guidance` |
| 60 | `Module IDs and names should` | `Component IDs and names should` |
| 63 | `**Good module IDs**` | `**Good component IDs**` |
| 69 | `**Bad module IDs**` | `**Bad component IDs**` |
| 79 | `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA` (import rename) |
| 83 | `Module IDs must be unique` | `Component IDs must be unique` |
| 84 | `Do NOT derive module IDs` | `Do NOT derive component IDs` |
| 88 | `Every module's category` | `Every component's category` |
| 90 | `per module` | `per component` |
| 92 | `modules — do NOT create one module per file` | `components — do NOT create one component per file` |

**Same pattern applies to `buildStructuralScanPrompt` (line 143) and `buildFocusedDiscoveryPrompt` (lines 160–206):**
- `"modules"` references in prompts → `"components"`
- `Module IDs` → `Component IDs`
- `module DOES` → `component DOES`
- `sub-modules` → `sub-components`
- `module-name` → `component-name`
- Import: `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA`

**Important:** The string literal `node_modules` (in the "skip node_modules, .git, dist" instruction) is a real directory name and must NOT be changed.

---

#### 4. `packages/deep-wiki/src/discovery/response-parser.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 4 | `AI JSON responses into ModuleGraph structures` | `AI JSON responses into ComponentGraph structures` |
| 12 | `import type { ModuleGraph, ModuleInfo, ...` | `import type { ComponentGraph, ComponentInfo, ...` |
| 13–19 | `MODULE_GRAPH_REQUIRED_FIELDS` → `COMPONENT_GRAPH_REQUIRED_FIELDS` |
| | `MODULE_INFO_REQUIRED_FIELDS` → `COMPONENT_INFO_REQUIRED_FIELDS` |
| | `isValidModuleId` → `isValidComponentId` |
| | `normalizeModuleId` → `normalizeComponentId` |
| 26 | `in module graph` | `in component graph` |
| 42 | `export function parseModuleGraphResponse(` → `export function parseComponentGraphResponse(` |
| 42 | return type `ModuleGraph` → `ComponentGraph` |
| 100–101 | `function validateAndNormalizeGraph(raw): ModuleGraph` → `: ComponentGraph` |
| 112 | `in module graph` | `in component graph` |
| 120–121 | `const modules = parseModules(raw.modules, warnings);` → `const components = parseComponents(raw.components, warnings);` |
| 131 | `for (const mod of modules)` → `for (const comp of components)` (and all `mod.` refs in that block) |
| 143–158 | `moduleIds` → `componentIds`, `mod.dependencies` → `comp.dependencies`, warning text `Module '${mod.id}'` → `Component '${comp.id}'` |
| 161–171 | `deduplicatedModules` → `deduplicatedComponents`, `Duplicate module ID` → `Duplicate component ID` |
| 180–185 | `modules: deduplicatedModules` → `components: deduplicatedComponents` |
| 191 | `'project' field in module graph` → `'project' field in component graph` |
| 217 | `function parseModules(` → `function parseComponents(` |
| 219 | `'modules' field must be an array` → `'components' field must be an array` |
| 222 | `const modules: ModuleInfo[]` → `const components: ComponentInfo[]` |
| 227 | `Skipping invalid module` → `Skipping invalid component` |
| 244 | `// Normalize module ID` → `// Normalize component ID` |
| 246 | `isValidModuleId` → `isValidComponentId` |
| 247 | `normalizeModuleId` → `normalizeComponentId` |
| 248 | `Normalized module ID` → `Normalized component ID` |
| 253 | `let modulePath` → `let componentPath` |
| 259 | `Module '${id}' has invalid complexity` → `Component '${id}' has invalid complexity` |
| 263–276 | `modules.push({` → `components.push({`, `return modules` → `return components` |

---

#### 5. `packages/deep-wiki/src/discovery/large-repo-handler.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 17–23 | `import type { ..., ModuleGraph, ModuleInfo, ...` | → `ComponentGraph, ComponentInfo, ...` |
| 25 | `normalizeModuleId` → `normalizeComponentId` |
| 28 | `parseModuleGraphResponse` → `parseComponentGraphResponse` |
| 49 | `` `(${cachedArea.modules.length} modules)` `` | `` `(${cachedArea.components.length} components)` `` |
| 54 | `` `Found ${subGraph.modules.length} modules` `` | `` `Found ${subGraph.components.length} components` `` |
| 72 | `'Cannot produce a module graph.'` | `'Cannot produce a component graph.'` |
| 77 | `` `${merged.modules.length} modules, ${merged.categories.length} categories` `` | `` `${merged.components.length} components, ...` `` |
| 85–86 | `Deduplicates modules by ID` / `Tags each module with its area slug` | → `components` |
| 90 | `tagging modules with their area` | `tagging components with their area` |
| 93–98 | `moduleMap` → `componentMap`, variable `mod` → `comp` throughout |
| 103 | `Track which modules belong` | `Track which components belong` |
| 108–112 | `const modules = Array.from(...)`, `moduleIds`, `mod.dependencies` → all to `components`/`componentIds`/`comp.dependencies` |
| 115 | `module assignments` | `component assignments` |
| 121 | `modules: areaModuleMap.get(...)` → `components: areaComponentMap.get(...)` |
| 126 | `modules,` → `components,` |
| 179 | `normalizeModuleId(area.path)` → `normalizeComponentId(area.path)` |
| 296 | `parseModuleGraphResponse(result.response)` → `parseComponentGraphResponse(result.response)` |
| 306 | `Deduplicates modules by ID` | `Deduplicates components by ID` |
| 307 | `Tags each module with its area slug` | `Tags each component with its area slug` |
| 332 | `const moduleMap = new Map<string, ModuleInfo>()` → `const componentMap = new Map<string, ComponentInfo>()` |
| 389 | `modules: areaModuleMap.get(areaSlug)` → `components: areaComponentMap.get(areaSlug)` |

---

#### 6. `packages/deep-wiki/src/discovery/iterative/types.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `import type { ModuleGraph, ...` | `import type { ComponentGraph, ...` |
| 19 | `foundModules: ProbeFoundModule[];` | `foundComponents: ProbeFoundComponent[];` |
| 28 | `interface ProbeFoundModule` | `interface ProbeFoundComponent` |
| 29–32 | JSDoc: `A module found during topic probing` / `Suggested module ID` / `Key files in this module` | → `component` |
| 96 | `/** The merged module graph (growing) */` | `/** The merged component graph (growing) */` |
| 97 | `graph: ModuleGraph;` | `graph: ComponentGraph;` |

---

#### 7. `packages/deep-wiki/src/discovery/iterative/iterative-discovery.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `import type { ModuleGraph, ...` | `import type { ComponentGraph, ...` |
| 13 | `modules: [],` | `components: [],` |
| 31 | `` `${totalModulesFound} modules found` `` | `` `${totalComponentsFound} components found` `` |
| 32 | `` `${currentGraph.modules.length} modules, coverage` `` | `` `${currentGraph.components.length} components, coverage` `` |
| 93 | Return type `: Promise<ModuleGraph>` | → `: Promise<ComponentGraph>` |
| 99 | `let currentGraph: ModuleGraph | null` | `let currentGraph: ComponentGraph | null` |
| 112 | `modules: [],` in empty graph | `components: [],` |
| 196–201 | `foundModules: []` → `foundComponents: []` in fallback results, `r.foundModules.length` → `r.foundComponents.length` |
| 202 | `totalModulesFound` → `totalComponentsFound` variable |

---

#### 8. `packages/deep-wiki/src/discovery/iterative/probe-prompts.ts`

Prompt text changes (same pattern as prompts.ts):

| Line(s) | Current | Replacement |
|---------|---------|-------------|
| 12 | `suggested module ID (kebab-case) describing the FEATURE, not the file path` | `suggested component ID ...` |
| 13 | `name describing what this module DOES` | `name describing what this component DOES` |
| 14 | `what this module does` | `what this component does` |
| 16 | `Key files in this module` | `Key files in this component` |
| 18 | `Only include modules within` | `Only include components within` |
| 20 | `"foundModules"` → `"foundComponents"` (JSON schema template variable) |
| 22 | `feature-level modules belonging` | `feature-level components belonging` |
| 24 | `Do NOT derive module IDs` | `Do NOT derive component IDs` |
| 25 | `dependencies should reference other topic IDs, not module IDs` | `...not component IDs` |
| 58 | `Only include modules within` | `Only include components within` |
| 95–101 | `## Module Naming Guidance` → `## Component Naming Guidance` |
| 97 | `Module IDs should describe` | `Component IDs should describe` |
| 110 | `Module IDs must be unique` | `Component IDs must be unique` |
| 111 | `Do NOT derive module IDs` | `Do NOT derive component IDs` |
| 115 | `not module IDs` | `not component IDs` |

---

#### 9. `packages/deep-wiki/src/discovery/iterative/probe-response-parser.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `import type { TopicProbeResult, ProbeFoundModule, ...` | `..., ProbeFoundComponent, ...` |
| 11 | `normalizeModuleId` → `normalizeComponentId` |
| 25 | `// Skip modules missing required fields` | `// Skip components missing required fields` |
| 28 | `// Normalize module ID` | `// Normalize component ID` |
| 34 | `if (!Array.isArray(obj.foundModules))` → `if (!Array.isArray(obj.foundComponents))` |
| 35 | `"foundModules"` → `"foundComponents"` in error message |
| 39 | `const foundModules: ProbeFoundModule[]` → `const foundComponents: ProbeFoundComponent[]` |
| 40–79 | Iterate over `obj.foundComponents`, push to `foundComponents` array |
| 54 | `normalizeModuleId(...)` → `normalizeComponentId(...)` |
| 71 | `foundModules.push({` → `foundComponents.push({` |
| 94 | `normalizeModuleId(...)` → `normalizeComponentId(...)` |
| 111 | `foundModules,` → `foundComponents,` in return statement |

---

#### 10. `packages/deep-wiki/src/discovery/iterative/probe-session.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 25 | `` `found ${parsed.foundModules.length} modules` `` | `` `found ${parsed.foundComponents.length} components` `` |
| 76–81 | `foundModules: [],` → `foundComponents: [],` (SDK unavailable fallback) |
| 110–116 | `foundModules: [],` → `foundComponents: [],` (probe failure fallback) |
| 127–132 | `foundModules: [],` → `foundComponents: [],` (error fallback) |

---

#### 11. `packages/deep-wiki/src/discovery/iterative/merge-session.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 16 | `import type { ModuleGraph, ModuleInfo, ...` | `import type { ComponentGraph, ComponentInfo, ...` |
| 18 | `normalizeModuleId` → `normalizeComponentId` |
| 40 | `` `existingGraph.modules.length + ' existing modules'` `` | `` `existingGraph.components.length + ' existing components'` `` |
| 47 | `AI merge returned fewer modules` | `AI merge returned fewer components` |
| 48 | `mergeResult.graph.modules.length` → `.components.length` |
| 48 | `probeModuleCount` → `probeComponentCount` |
| 49 | `AI merge returned 0 modules` | `AI merge returned 0 components` |
| 56 | `Deduplicates modules by ID` | `Deduplicates components by ID` |
| 61 | `const moduleMap = new Map<string, ModuleInfo>()` → `const componentMap = new Map<string, ComponentInfo>()` |
| 64–66 | `existing graph modules` comments, `existingGraph.modules` → `.components`, `mod` → `comp` |
| 69 | `Merge probe results into modules` | `...into components` |
| 71 | `moduleMap.has(id)` → `componentMap.has(id)` |
| 72 | `moduleMap.set(id, {` → `componentMap.set(id, {` |
| 79 | `const modules = Array.from(moduleMap.values())` → `const components = Array.from(componentMap.values())` |
| 80 | `` `Local merge: ${modules.length} modules` `` | `` `Local merge: ${components.length} components` `` |
| 83 | `modules,` → `components,` |
| 100 | `r.foundModules.length` → `r.foundComponents.length` |
| 113–115 | `probeModuleCount` → `probeComponentCount`, `r.foundModules` → `r.foundComponents` |
| 139 | `const moduleMap = new Map<string, ModuleInfo>()` → `componentMap`... |
| 144–149 | `existingGraph.modules` → `.components`, `moduleMap.set` → `componentMap.set` |
| 152–178 | `probe.foundModules` → `probe.foundComponents`, `moduleMap.has/set` → `componentMap.has/set` |
| 181 | `const modules = Array.from(moduleMap.values())` → `components` |
| 196 | `normalizeModuleId(dt.topic)` → `normalizeComponentId(dt.topic)` |
| 212 | `Local merge: ${modules.length} modules` → `components` |

---

#### 12. `packages/deep-wiki/src/discovery/iterative/merge-prompts.ts`

| Line(s) | Current | Replacement |
|---------|---------|-------------|
| 4 | `Combine modules found across different probes` | `Combine components found across...` |
| 5 | `overlapping module claims` | `overlapping component claims` |
| 6 | `Deduplicate modules with the same ID` | `Deduplicate components with...` |
| 7 | `Ensure module IDs are unique` | `Ensure component IDs are unique` |
| 12 | `MODULE_GRAPH_SCHEMA` import → `COMPONENT_GRAPH_SCHEMA` |
| 94 | `Module IDs must be unique` | `Component IDs must be unique` |

---

#### 13. `packages/deep-wiki/src/discovery/iterative/merge-response-parser.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `import type { ModuleGraph, ...` | `import type { ComponentGraph, ...` |
| 12 | `import { parseModuleGraphResponse }` | `import { parseComponentGraphResponse }` |
| 13 | `normalizeModuleId` → `normalizeComponentId` |
| 37 | `let graph: ModuleGraph;` | `let graph: ComponentGraph;` |
| 39 | `graph = parseModuleGraphResponse(...)` | `graph = parseComponentGraphResponse(...)` |
| 54 | `normalizeModuleId(...)` → `normalizeComponentId(...)` |

---

#### 14. `packages/deep-wiki/src/seeds/response-parser.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 12 | `import { normalizeModuleId } from '../schemas';` | `import { normalizeComponentId } from '../schemas';` |
| 79 | `const topicId = normalizeModuleId(String(obj.topic));` | `normalizeComponentId(...)` |

---

#### 15. `packages/deep-wiki/src/seeds/seed-file-parser.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 13 | `import { normalizeModuleId } from '../schemas';` | `import { normalizeComponentId } from '../schemas';` |
| 101 | `const topicId = normalizeModuleId(dirName);` → `normalizeComponentId(dirName)` |
| 132–137 | All `normalizeModuleId(...)` calls → `normalizeComponentId(...)` |
| 188 | `normalizeModuleId(row[topicIdx].trim())` → `normalizeComponentId(...)` |

---

#### 16. `packages/deep-wiki/src/seeds/heuristic-fallback.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 13 | `import { normalizeModuleId } from '../schemas';` | `import { normalizeComponentId } from '../schemas';` |
| 101 | `const topicId = normalizeModuleId(dirName);` | `normalizeComponentId(dirName)` |

**Note:** The string `'node_modules'` in the `EXCLUDED_DIRS` set (line 24) is a real directory name and must NOT be renamed.

---

#### 17. `packages/deep-wiki/src/consolidation/index.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `Module Consolidation — Public API` | `Component Consolidation — Public API` |
| 5 | `Reduces the number of modules` | `Reduces the number of components` |
| 12 | `export { consolidateModules }` | `export { consolidateComponents }` |
| 13 | `export { consolidateByDirectory, getModuleDirectory }` | `..., getComponentDirectory }` |

---

#### 18. `packages/deep-wiki/src/consolidation/consolidator.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `Module Consolidation Orchestrator` | `Component Consolidation Orchestrator` |
| 5 | `reduce module count` | `reduce component count` |
| 11 | `The original module graph` | `The original component graph` |
| 13 | `import type { ModuleGraph } from '../types';` | `import type { ComponentGraph } from '../types';` |
| 13 | `graph.modules.length` → `graph.components.length` (3 occurrences at lines 46, 51, 74) |
| 23 | `DEFAULT_TARGET_MODULE_COUNT` → `DEFAULT_TARGET_COMPONENT_COUNT` |
| 40 | `export async function consolidateModules(` → `consolidateComponents(` |
| 40 | `graph: ModuleGraph` → `graph: ComponentGraph` |
| 47 | `options.targetModuleCount` → `options.targetComponentCount` |
| 7 | `merge modules by directory` | `merge components by directory` |

---

#### 19. `packages/deep-wiki/src/consolidation/types.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `module consolidation interfaces` | `component consolidation interfaces` |
| 4 | `module consolidation pipeline` | `component consolidation pipeline` |
| 10 | `import type { ModuleGraph }` → `import type { ComponentGraph }` |
| 12 | `Maximum number of modules` | `Maximum number of components` |
| 13 | `targetModuleCount` → `targetComponentCount` |
| 14 | `The consolidated module graph` | `The consolidated component graph` |
| 15 | `graph: ModuleGraph` → `graph: ComponentGraph` |
| 15–19 | `Number of modules before/after` → `Number of components before/after` |
| 22 | `Suggested ID for the merged module` | `Suggested ID for the merged component` |
| 24 | `IDs of modules to merge` | `IDs of components to merge` |

---

#### 20. `packages/deep-wiki/src/consolidation/constants.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `constants for module consolidation` | `constants for component consolidation` |
| 6 | `from a set of modules` | `from a set of components` |
| 7 | param `modules` → `components` |

---

#### 21. `packages/deep-wiki/src/consolidation/rule-based-consolidator.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `Rule-Based Module Consolidator` | `Rule-Based Component Consolidator` |
| 4 | `Merges fine-grained modules` | `Merges fine-grained components` |
| 7–11 | `Group modules`, `Merge modules`, `merged modules` | → `components` |
| 17 | `import type { ModuleInfo, ModuleGraph, ...` | → `ComponentInfo, ComponentGraph, ...` |
| 18 | `normalizeModuleId` → `normalizeComponentId` |
| 27 | `Intermediate grouping of modules` | `...of components` |
| 32 | `modules: ModuleInfo[];` | `components: ComponentInfo[];` |
| 40 | `Consolidate modules by directory` | `Consolidate components by directory` |
| 41–43 | JSDoc: `Modules sharing` → `Components sharing`, `merged module` → `merged component`, `module graph` → `component graph` |
| 50 | `const modules = graph.modules;` → `const components = graph.components;` |
| 52 | `if (modules.length === 0)` → `if (components.length === 0)` |
| 57 | `groupModulesByDirectory(modules)` → `groupComponentsByDirectory(components)` |
| 64 | `group.modules.length === 1` → `group.components.length === 1` |
| 66 | `const mod = group.modules[0]` → `const comp = group.components[0]` |
| 72 | `for (const mod of group.modules)` → `for (const comp of group.components)` |
| 80 | `fixDependencyReferences(mergedModules, ...)` → variable rename to `mergedComponents` |
| 83 | `deriveCategories(fixedModules)` — variable rename of fixed array |
| 87 | `modules: fixedModules` → `components: fixedComponents` |
| 100 | `export function getModuleDirectory(modulePath)` → `export function getComponentDirectory(componentPath)` |
| 120 | `function groupModulesByDirectory(modules: ModuleInfo[])` → `groupComponentsByDirectory(components: ComponentInfo[])` |
| 123 | `for (const mod of modules)` → `for (const comp of components)` |
| 124 | `getModuleDirectory(mod.path)` → `getComponentDirectory(comp.path)` |
| 131 | `modules: mods` → `components: mods` |
| 140 | `function mergeModuleGroup(` → `function mergeComponentGroup(` |
| 141 | `const { dirPath, modules } = group;` → `const { dirPath, components } = group;` |
| 152–178 | All `modules.flatMap(m =>` → `components.flatMap(m =>`, `modules.map(m =>` → `components.map(m =>` |
| 160 | `// Remove self-references (modules within this group)` | → `components` |
| 205–210 | `function fixDependencyReferences(modules: ModuleInfo[], ...)` → param rename `components: ComponentInfo[]` |
| 209 | `const moduleIds = new Set(modules.map(...))` → `componentIds` |
| 211 | `return modules.map(mod =>` → `return components.map(comp =>` |
| 229 | `function deriveCategories(modules: ModuleInfo[])` → param rename |
| 241 | `Contains ${moduleIds.size} module(s)` → `Contains ${componentIds.size} component(s)` |
| 253 | `function pickHighestComplexity(modules: ModuleInfo[])` → param rename |
| 257 | `function pickMostCommonCategory(modules: ModuleInfo[])` → param rename |
| 262 | `let best = modules[0].category` → `components[0].category` |
| 273 | `function combinePurposes(modules: ModuleInfo[])` → param rename |
| 274–278 | `modules.length`, `modules[0].purpose`, `modules.map(m =>` → `components.*` |
| 277 | `first module's purpose` | `first component's purpose` |

---

#### 22. `packages/deep-wiki/src/consolidation/ai-consolidator.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 2 | `AI-Assisted Module Consolidator` | `AI-Assisted Component Consolidator` |
| 3–4 | `cluster pre-consolidated modules` / `module list` | → `components` |
| 9 | `Modules within each cluster` → `Components within...` |
| 16 | `import type { ModuleInfo, ModuleGraph, ...` | → `ComponentInfo, ComponentGraph, ...` |
| 25 | `Default target module count` → `Default target component count` |
| 41 | `Target number of modules` → `...components` |
| 50–57 | `Cluster modules`, `Sends the module list`, `merges each cluster into a single module`, `Consolidated module graph` | → all `component` |
| 59 | `graph: ModuleGraph` → `graph: ComponentGraph` |
| 62 | return type `Promise<ModuleGraph>` → `Promise<ComponentGraph>` |
| 67 | `const modules = graph.modules` → `const components = graph.components` |
| 70 | `if (modules.length <= targetCount)` → `components.length` |
| 75 | `buildClusteringPrompt(modules, ...)` → `buildClusteringPrompt(components, ...)` |
| 86 | `parseClusterResponse(result.response, modules)` → `..., components)` |
| 105 | `function buildClusteringPrompt(modules: ModuleInfo[], ...)` → param rename |
| 110–111 | `const moduleList = modules` → `const componentList = components` |
| 115 | `` `which has ${modules.length} modules` `` → `` `...${components.length} components` `` |
| 116 | `cluster semantically related modules` | → `components` |
| 124 | `Group these modules` | → `Group these components` |
| 125–128 | `modules that serve`, `tightly coupled modules` | → `components` |
| 131 | `Every module ID` | → `Every component ID` |
| 134 | `single module` → `single component` |
| 145 | `"module-id-1", "module-id-2"` → `"component-id-1", "component-id-2"` |
| 163 | `modules: ModuleInfo[]` → `components: ComponentInfo[]` |
| 185 | `const validModuleIds = new Set(modules.map(...))` → `validComponentIds` |
| 210–211 | `Assign any unassigned modules` → `...components` |
| 232 | `graph: ModuleGraph` → `graph: ComponentGraph` |
| 236 | `const moduleMap = new Map(graph.modules.map(...))` → `componentMap = new Map(graph.components.map(...))` |
| 238 | `const mergedModules: ModuleInfo[]` → `mergedComponents: ComponentInfo[]` |
| 253 | `Merge members into cluster module` → `...cluster component` |
| 263 | `const moduleIds = new Set(mergedModules.map(...))` → `componentIds = new Set(mergedComponents.map(...))` |
| 280 | `modules: fixedModules` → `components: fixedComponents` |
| 284 | `function deriveFreshCategories(modules: ModuleInfo[])` → param rename |
| 287 | `` `Contains ${count} module(s)` `` → `` `Contains ${count} component(s)` `` |

---

### Test Files to Modify

Each test file mirrors its corresponding source file. Apply the same renaming patterns:

#### Discovery Tests

| Test File | Key Changes |
|-----------|------------|
| `test/discovery/response-parser.test.ts` | `parseModuleGraphResponse` → `parseComponentGraphResponse`; all `modules:` keys in mock data → `components:`; `module` in describe/it names → `component`; `result.modules` → `result.components` |
| `test/discovery/prompts.test.ts` | Update string expectations: `toContain('modules')` → `toContain('components')`; it-block names: `module naming guidance` → `component naming guidance`; `module IDs` → `component IDs`; `feature-oriented module graph` → `...component graph`; **keep** `node_modules` expectation unchanged |
| `test/discovery/area-tagging.test.ts` | `modulesData` → `componentsData`; `modules:` in mock graphs → `components:`; `result.modules` → `result.components`; `should tag modules with area slug` → `...components...` |
| `test/discovery/large-repo-handler.test.ts` | `modules:` in mock data → `components:`; `result.modules` → `result.components`; merge function assertions |
| `test/discovery/discovery-logging.test.ts` | `modules: [...]` in mock data → `components: [...]` |
| `test/discovery/iterative/probe-response-parser.test.ts` | `foundModules` → `foundComponents` in mock data and assertions; `valid-module` → `valid-component` in mock IDs; `normalize module IDs` → `normalize component IDs` |
| `test/discovery/iterative/probe-prompts.test.ts` | `module naming guidance` → `component naming guidance`; `module IDs` → `component IDs`; `feature-level modules` → `feature-level components`; `what this module DOES` → `what this component DOES` |
| `test/discovery/iterative/iterative-discovery.test.ts` | `modules: []` / `modules: [...]` in mock data → `components:`; `result.modules` → `result.components` |
| `test/discovery/iterative/iterative-discovery-cache.test.ts` | `createMockGraph(moduleIds)` → `createMockGraph(componentIds)` or update the helper; `modules.map(...)` → `components.map(...)`; `` `${id} module` `` → `` `${id} component` `` |
| `test/discovery/iterative/merge-prompts.test.ts` | `modules:` in mock data; string expectations about `modules` |
| `test/discovery/iterative/merge-response-parser.test.ts` | `modules: [...]` in mock data → `components: [...]`; `result.graph.modules` → `result.graph.components`; `'Core modules'` in category descriptions |

#### Seeds Tests

| Test File | Key Changes |
|-----------|------------|
| `test/seeds/heuristic-fallback.test.ts` | `'node_modules'` string in `fs.mkdirSync` — **keep unchanged** (literal dir name); `'node-modules'` in `toContain` — **keep unchanged** (normalized from literal); no "module" renames needed here unless test descriptions reference modules |
| `test/seeds/response-parser.test.ts` | `normalizeModuleId` references in test imports/mocks if any |
| `test/seeds/seed-file-parser.test.ts` | `normalizeModuleId` references if tested directly |
| `test/seeds/prompts.test.ts` | No "module" in seed prompt text (verified — seeds prompts don't mention modules) |

#### Consolidation Tests

| Test File | Key Changes |
|-----------|------------|
| `test/consolidation/rule-based-consolidator.test.ts` | `makeGraph(modules: ...)` helper → `makeGraph(components: ...)`; all `modules:` keys in mock data → `components:`; `getModuleDirectory` → `getComponentDirectory`; `consolidateByDirectory` assertions on `.modules` → `.components`; `module(s)` in category descriptions → `component(s)` |
| `test/consolidation/ai-consolidator.test.ts` | Same pattern: `makeGraph(modules: ...)` → `components`; all mock `.modules` → `.components`; `buildClusteringPrompt` expectations about `modules` → `components`; `module-id-1` → `component-id-1` in mock cluster data |
| `test/consolidation/consolidator.test.ts` | `makeGraph(modules: ...)` → `components`; `.modules.length` → `.components.length`; `consolidateModules` → `consolidateComponents` |

---

## Implementation Notes

1. **Order matters.** Complete 002 (core types + schemas) before starting 003. Every import rename here depends on the types already existing as `ComponentGraph`, `ComponentInfo`, etc.

2. **Literal `node_modules` must NOT be renamed.** This appears as:
   - `EXCLUDED_DIRS` set in `heuristic-fallback.ts` line 24
   - Prompt text in `prompts.ts` line 35: `"skip node_modules, .git, dist"`
   - Test files creating `node_modules` directories
   
   These are real filesystem directory names. Use a case-sensitive search for `module` and skip matches inside `node_modules` or `node-modules` (its kebab-case normalized form).

3. **JSON field renames in AI prompts.** When AI prompt schemas reference `"modules": [...]`, these must become `"components": [...]` so the AI outputs the correct field name. Similarly `"foundModules"` → `"foundComponents"` in probe schemas.

4. **`MODULE_GRAPH_SCHEMA` in `schemas.ts`** was renamed to `COMPONENT_GRAPH_SCHEMA` in 002. Update all imports in this commit.

5. **Search strategy for variable renames.** Use case-sensitive regex:
   - `\bmodules\b` → `components` (but skip `node_modules`)
   - `\bmodule\b` → `component` (but skip `node_modules`, `node-modules`)
   - `\bModule\b` → `Component` (types and interface names)
   - `\bMODULE_\b` → `COMPONENT_` (constant prefixes)

6. **Re-export chain.** `discovery/index.ts` re-exports `parseModuleGraphResponse` and `discoverModuleGraph`. These become `parseComponentGraphResponse` and `discoverComponentGraph`. All consumers of these re-exports (likely in `commands/` and `generate.ts`) will need updating in a later commit (004+), or aliased here with `export { parseComponentGraphResponse as parseModuleGraphResponse }` as a temporary backward-compat shim.

7. **`consolidation/index.ts` re-exports.** Same pattern: `consolidateModules` → `consolidateComponents`, `getModuleDirectory` → `getComponentDirectory`.

## Tests

### Run the full deep-wiki test suite:

```bash
cd packages/deep-wiki && npm run test:run
```

### Specific test files to verify:

```bash
# Discovery tests
npx vitest run test/discovery/response-parser.test.ts
npx vitest run test/discovery/prompts.test.ts
npx vitest run test/discovery/area-tagging.test.ts
npx vitest run test/discovery/large-repo-handler.test.ts
npx vitest run test/discovery/discovery-logging.test.ts
npx vitest run test/discovery/iterative/

# Seeds tests
npx vitest run test/seeds/

# Consolidation tests
npx vitest run test/consolidation/
```

### Verify no stale references remain:

```bash
# Should return ONLY legitimate node_modules/node-modules references
cd packages/deep-wiki
grep -rn '\bmodule\b\|\bModule\b\|\bMODULE\b' src/discovery/ src/seeds/ src/consolidation/ \
  | grep -v 'node_modules' | grep -v 'node-modules'
```

### Build check:

```bash
cd packages/deep-wiki && npm run build
```

## Acceptance Criteria

- [ ] All `ModuleGraph` type references in discovery/seeds/consolidation → `ComponentGraph`
- [ ] All `ModuleInfo` type references → `ComponentInfo`
- [ ] `parseModuleGraphResponse` → `parseComponentGraphResponse`
- [ ] `discoverModuleGraph` → `discoverComponentGraph`
- [ ] `consolidateModules` → `consolidateComponents`
- [ ] `getModuleDirectory` → `getComponentDirectory`
- [ ] `groupModulesByDirectory` → `groupComponentsByDirectory`
- [ ] `MODULE_GRAPH_SCHEMA` imports → `COMPONENT_GRAPH_SCHEMA`
- [ ] `normalizeModuleId` → `normalizeComponentId` in all import sites
- [ ] `isValidModuleId` → `isValidComponentId` in all import sites
- [ ] All AI prompt text uses "component" instead of "module" (except literal `node_modules`)
- [ ] JSON schema templates in prompts use `"components"` field name, not `"modules"`
- [ ] `ProbeFoundModule` type → `ProbeFoundComponent`; field `foundModules` → `foundComponents`
- [ ] All log messages say "component(s)" not "module(s)"
- [ ] All JSDoc comments updated
- [ ] `node_modules` string literals in `EXCLUDED_DIRS` and prompt text are NOT renamed
- [ ] All 23 deep-wiki test files pass (`npm run test:run`)
- [ ] TypeScript builds cleanly (`npm run build`)
- [ ] No stale `module`/`Module` references remain (verified by grep, excluding `node_modules`)

## Dependencies

- **Depends on: 002** — Core types and schemas must be renamed first (`ModuleGraph` → `ComponentGraph`, `ModuleInfo` → `ComponentInfo`, `MODULE_GRAPH_SCHEMA` → `COMPONENT_GRAPH_SCHEMA`, validator functions, etc.)
