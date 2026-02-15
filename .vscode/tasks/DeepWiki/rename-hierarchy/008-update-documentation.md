---
status: pending
---

# 008: Update Documentation and Final Cleanup

## Summary

Update all documentation files to reflect the completed hierarchy rename (Area → Domain, Module → Component, Topic → Theme) and verify no stale references remain in deep-wiki source code. This is the final commit in the rename series.

## Motivation

Commits 001–007 renamed types, functions, variables, file paths, cache directories, and test files across the entire `packages/deep-wiki/` codebase. The documentation still uses the old terminology everywhere — type names, phase descriptions, output directory examples, CLI help text references, and conceptual explanations. Shipping renamed code with stale docs would confuse contributors and users.

## Changes

### Files to Modify

#### 1. `packages/deep-wiki/AGENTS.md` — Full terminology sweep

**Package Structure section (lines ~5–84)**
| Location | Old | New |
|----------|-----|-----|
| Line 12 (types.ts comment) | `ModuleGraph, ModuleAnalysis, GeneratedArticle` | `ComponentGraph, ComponentAnalysis, GeneratedArticle` |
| Line 18 (discover.ts comment) | `outputs **ModuleGraph JSON**` | `outputs **ComponentGraph JSON**` |
| Line 23 (seeds index comment) | `generateTopicSeeds()`, `TopicSeed[]` | `generateThemeSeeds()`, `ThemeSeed[]` |
| Line 26 (seeds response-parser comment) | `Parse AI response into **TopicSeed[]**` | `Parse AI response into **ThemeSeed[]**` |
| Line 27 (seed-file-parser comment) | `Parse JSON/CSV seed files into **TopicSeed[]**` | `Parse JSON/CSV seed files into **ThemeSeed[]**` |
| Line 30 (discovery index comment) | `discoverModuleGraph()` | `discoverComponentGraph()` |
| Line 33 (discovery response-parser comment) | `Parse AI response into **ModuleGraph**` | `Parse AI response into **ComponentGraph**` |
| Lines 38–43 (iterative/ subdirectory) | `Per-topic probe` | `Per-theme probe` |
| Line 45 (consolidation index comment) | `consolidateModules()` | `consolidateComponents()` |
| Line 50 (analysis index comment) | `analyzeModules()` | `analyzeComponents()` |
| Line 51 (analysis-executor comment) | `Per-module AI analysis` | `Per-component AI analysis` |
| Line 52 (analysis prompts comment) | `per-module deep dive` | `per-component deep dive` |
| Line 53 (analysis response-parser comment) | `Parse analysis response into ModuleAnalysis` | `Parse analysis response into ComponentAnalysis` |
| Line 56 (writing article-executor comment) | `Per-module article generation` | `Per-component article generation` |
| Line 66 (api-handlers comment) | `/api/modules` | `/api/components` |
| Line 68 (explore-handler comment) | `Module deep-dive` | `Component deep-dive` |
| Directory name `seeds/` | If renamed to `themes/` in code, update here | Match whatever commit 007 produced |

**Phase descriptions (lines ~86–132)**
| Location | Old | New |
|----------|-----|-----|
| Line 91 | `identify key **topics/areas**` | `identify key **themes/domains**` |
| Line 93 | `Output: **TopicSeed[]**` | `Output: **ThemeSeed[]**` |
| Line 99 | `Produces a **ModuleGraph** JSON` | `Produces a **ComponentGraph** JSON` |
| Line 103 | `**ModuleGraph** with ProjectInfo, **ModuleInfo[]**, CategoryInfo[], optional **AreaInfo[]**` | `**ComponentGraph** with ProjectInfo, **ComponentInfo[]**, CategoryInfo[], optional **DomainInfo[]**` |
| Line 101 | `per-area drill-down` | `per-domain drill-down` |
| Line 118 | `Produces **ModuleAnalysis[]**` | `Produces **ComponentAnalysis[]**` |
| Line 126 | `articles organized by **area/category**` | `articles organized by **domain/category**` |

**Core Concepts section (lines ~255–293) — Full rewrite**

Replace `## Core Concepts: Module, Area, and Topic` with:

```markdown
## Core Concepts: Domain, Component, and Theme

The wiki generator organizes codebases using three concepts:

| Concept | Level | Description |
|---------|-------|-------------|
| **Component** | Smallest unit | A code directory/unit with a specific purpose. Every repo has these. Code type: `ComponentInfo`. |
| **Domain** | Structural grouping | Top-level directory regions. **Only exists for large repos (3000+ files)**. Each domain contains multiple components. Code type: `DomainInfo`. |
| **Theme** | Cross-cutting grouping | User-defined business/architectural concerns that span multiple components (e.g., "Authentication" touching auth, middleware, and config components). Code type: `ThemeMeta`. |

> **Note:** The conceptual hierarchy is "Domain → Module → Component" but the current code
> has no explicit "Module" mid-tier entity. "Module" is reserved for a future grouping
> level between Domain and Component.
```

Update the hierarchy, relationships, and phase-usage subsections accordingly:
- `ModuleGraph` → `ComponentGraph`
- `modules: ModuleInfo[]` → `components: ComponentInfo[]`
- `areas?: AreaInfo[]` → `domains?: DomainInfo[]`
- `topics?: TopicAreaMeta[]` → `themes?: ThemeAreaMeta[]`
- "Module vs Area" → "Component vs Domain"
- "Module vs Topic" → "Component vs Theme"
- "Area vs Topic" → "Domain vs Theme"

**Key Types section (lines ~294–362) — Update all interfaces**

```typescript
// Phase 0 output
interface ThemeSeed {
    theme: string;           // was: topic
    description: string;
    hints?: string[];
}

// Phase 1 output
interface ComponentGraph {               // was: ModuleGraph
    project: ProjectInfo;
    components: ComponentInfo[];          // was: modules: ModuleInfo[]
    categories: CategoryInfo[];
    domains?: DomainInfo[];              // was: areas?: AreaInfo[]
    themes?: ThemeAreaMeta[];            // was: topics?: TopicAreaMeta[]
}

interface ComponentInfo {                // was: ModuleInfo
    id: string;
    name: string;
    path: string;
    purpose: string;
    keyFiles: string[];
    dependencies: string[];
    dependents: string[];
    complexity: 'low' | 'medium' | 'high';
    category: string;
    domain?: string;                     // was: area?: string
    mergedFrom?: string[];
}

interface DomainInfo {                   // was: AreaInfo
    id: string;
    name: string;
    path: string;
    description: string;
    components: string[];                // was: modules: string[]
}

interface ThemeAreaMeta {                 // was: TopicAreaMeta
    id: string;
    title: string;
    description: string;
    layout: 'single' | 'domain';        // was: 'single' | 'area'
    articles: { slug: string; title: string; path: string }[];
    involvedComponentIds: string[];      // was: involvedModuleIds
    directoryPath: string;
}

// Phase 3 output
interface ComponentAnalysis {            // was: ModuleAnalysis
    componentId: string;                 // was: moduleId
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}

// Phase 4 output
interface GeneratedArticle {
    componentId: string;                 // was: moduleId
    title: string;
    content: string;
    domain?: string;                     // was: area?: string
}
```

**CLI Commands section (lines ~134–177)**
| Location | Old | New |
|----------|-----|-----|
| Line 136 heading | `deep-wiki seeds` | `deep-wiki themes` (if command was renamed) |
| Line 138 | `Generate topic seeds` | `Generate theme seeds` |
| Line 141 | `deep-wiki seeds ./my-project --output seeds.json --max-topics 50` | `deep-wiki themes ./my-project --output themes.json --max-themes 50` |
| Line 144 | `--max-topics` | `--max-themes` |
| Line 148 | `Outputs ModuleGraph JSON` | `Outputs ComponentGraph JSON` |
| Line 152–153 | `--seeds seeds.json` / `--seeds auto` | `--themes themes.json` / `--themes auto` (if flag renamed) |
| Line 156 | `--seeds` | `--themes` (if flag renamed) |
| Line 166 | `--seeds` | `--themes` (if flag renamed) |
| Line 170 | `module exploration` | `component exploration` |

**Caching section (lines ~364–372)**
- `.wiki-cache/discovery/` → verify directory names match code changes
- "seeds, probe results" → "themes, probe results" if seeds dir renamed

**Server architecture section** (if present)
- `/api/modules` → `/api/components`
- "module exploration" → "component exploration"

**Testing section**
- Update test count if it changed
- Update test file name references if renamed

---

#### 2. `packages/deep-wiki/README.md` — Output structure and references

**Output Structure (lines ~67–107)**

Small repos section:
- `module-graph.json` → `component-graph.json`
- `modules/` → `components/`
- `Per-module article` → `Per-component article`

Large repos section:
- `areas/` → `domains/`
- `areas/packages-core/` → `domains/packages-core/`
- `Area index` → `Domain index`
- `Area-level architecture diagram` → `Domain-level architecture diagram`
- `modules/` (inside domain) → `components/`
- `modules live under their area` → `components live under their domain`
- "hierarchical layout activates automatically when Phase 1 discovers top-level areas" → "…discovers top-level domains"

**Five-Phase Pipeline (lines ~109–149)**
- Line 113: `ModuleGraph` → `ComponentGraph`
- Line 115: `Modules (id, name, …)` → `Components (id, name, …)`
- Line 122: `module graph` → `component graph`
- Line 126: `analyze every module` → `analyze every component`
- Line 140: `one article per module` → `one article per component`
- Line 143: `areas` → `domains` (all occurrences)
- Line 144: `Per-area reduce` → `Per-domain reduce`, `area index + area architecture` → `domain index + domain architecture`, `modules per area` → `components per domain`
- Line 145: `area summaries` → `domain summaries`

**CLI Command Examples (lines ~20–44)**
- Update `--seeds` to `--themes` (if flag was renamed in commit 007)
- Comment on line 23: `5 phases` → `6 phases` if pipeline was expanded, or keep as-is

**Architecture section (lines ~174–212)**
- `discoverModuleGraph()` → `discoverComponentGraph()`
- `consolidateModules()` → `consolidateComponents()`
- `analyzeModules()` → `analyzeComponents()`
- `ModuleAnalysis` → `ComponentAnalysis`

---

#### 3. Root `CLAUDE.md` — Deep Wiki Generator section (lines ~22–46)

| Line | Old | New |
|------|-----|-----|
| 27 | `produce a \`ModuleGraph\` JSON` | `produce a \`ComponentGraph\` JSON` |
| 29 | `Per-module deep analysis producing \`ModuleAnalysis[]\`` | `Per-component deep analysis producing \`ComponentAnalysis[]\`` |
| 40 | `Discover module graph only` | `Discover component graph only` |
| 42 | `module exploration` | `component exploration` |
| 44 | `per-area drill-down` | `per-domain drill-down` |

Also update the "Modules:" subsection labels if they refer to deep-wiki internal modules by old directory names (e.g., if `seeds` command became `themes`).

---

#### 4. Root `AGENTS.md` — Deep Wiki references

Apply same changes as CLAUDE.md for the duplicated Deep Wiki Generator section:
- Line 27: `ModuleGraph` → `ComponentGraph`
- Line 29: `ModuleAnalysis[]` → `ComponentAnalysis[]`
- Line 40: `module graph` → `component graph`
- Line 42: `module exploration` → `component exploration`

---

### Cleanup Verification (no file changes, just checks)

1. **Stale reference scan** in `packages/deep-wiki/src/`:
   ```bash
   # Should return zero hits (excluding generic "module" usage like ES module imports)
   grep -rn '\bAreaInfo\b\|ModuleGraph\b\|ModuleInfo\b\|ModuleAnalysis\b\|TopicSeed\b\|TopicAreaMeta\b' packages/deep-wiki/src/
   ```

2. **Build verification**:
   ```bash
   cd packages/deep-wiki && npm run build
   ```

3. **Test verification**:
   ```bash
   cd packages/deep-wiki && npm run test:run
   ```
   Record test count and confirm it matches pre-rename count.

4. **Generic "module" audit** — spot-check that generic uses of "module" (ES module imports, `node_modules`, etc.) were NOT incorrectly renamed to "component".

## Implementation Notes

The conceptual hierarchy is "Domain → Module → Component" but in the current code there is no explicit "Module" mid-tier entity. The documentation should clarify:
- **Domain** = `DomainInfo` (top-level structural grouping, only for large repos with 3000+ files)
- **Component** = `ComponentInfo` (smallest analyzable code unit, every repo has these)
- **Theme** = `ThemeMeta` / `ThemeAreaMeta` (cross-cutting concern spanning multiple components)
- **Module** is reserved as a future mid-tier grouping concept between Domain and Component

When writing the "Core Concepts" section, be explicit that the code uses "Component" for what was previously called "Module", and that the word "Module" is intentionally absent from the current type system to avoid confusion with the future mid-tier concept.

Care must be taken not to rename generic English uses of "module" (e.g., "ES module", "Node.js module system") — only rename references to the deep-wiki `ModuleInfo` / `ModuleGraph` / `ModuleAnalysis` type system.

## Tests

- No new tests — this is documentation only
- Final verification: `npm run build && npm run test:run` in `packages/deep-wiki/`
- Confirm test count matches the count after commit 007

## Acceptance Criteria

- [ ] `packages/deep-wiki/AGENTS.md` uses Domain/Component/Theme terminology throughout
- [ ] `packages/deep-wiki/AGENTS.md` Core Concepts section explains the hierarchy clearly with a note about the reserved "Module" mid-tier
- [ ] `packages/deep-wiki/AGENTS.md` Key Types section shows renamed interfaces with `// was:` annotations removed (clean final form)
- [ ] `packages/deep-wiki/README.md` output structure shows `domains/` and `components/` directories
- [ ] `packages/deep-wiki/README.md` pipeline descriptions use Component/Domain terminology
- [ ] Root `CLAUDE.md` Deep Wiki section updated (ComponentGraph, ComponentAnalysis, per-domain)
- [ ] Root `AGENTS.md` Deep Wiki section updated to match CLAUDE.md
- [ ] `grep -rn 'AreaInfo\|ModuleGraph\|ModuleInfo\|ModuleAnalysis\|TopicSeed\|TopicAreaMeta' packages/deep-wiki/src/` returns zero results
- [ ] `npm run build` succeeds in `packages/deep-wiki/`
- [ ] `npm run test:run` succeeds in `packages/deep-wiki/` with same test count as post-007
- [ ] No false renames of generic "module" (ES module, node_modules, etc.)

## Dependencies

- Depends on: 001, 002, 003, 004, 005, 006, 007
