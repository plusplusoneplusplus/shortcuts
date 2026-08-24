# Deep Wiki

CLI in `packages/deep-wiki/`, published as `@plusplusoneplusplus/deep-wiki`, generating a wiki
for any codebase through a six-phase AI pipeline plus optional theme articles. Requires Node.js
≥ 24 and depends at runtime on `@plusplusoneplusplus/forge`,
`@plusplusoneplusplus/coc-agent-sdk`, and `@plusplusoneplusplus/coc-workflow` so the bundled CLI
can externalize Forge and its dependency chain. The CoC server serves the output directory — see
[wiki-serving.md](wiki-serving.md).

## CLI Commands

```bash
deep-wiki seeds <repo>         # Generate theme seeds (Phase 0)
deep-wiki discover <repo>      # Phase 1 only → ComponentGraph JSON
deep-wiki generate <repo>      # Full six-phase pipeline
deep-wiki theme <repo> [name]  # Cross-cutting theme articles
deep-wiki init                 # Template config file
```

Flags: `--output`, `--model`, `--concurrency`, `--timeout`, `--depth` (shallow/normal/deep),
`--seeds` (auto or file), `--phase` (start from N), `--force`, `--use-cache`,
`--skip-website`, `--no-cluster`, `--theme` (light/dark/auto).

## Six-Phase Pipeline

- **0 · Seeds** (optional) — AI + MCP tools scan for key themes/domains, falling back to
  top-level directory names. Outputs `ThemeSeed[]` (theme, description, hints); seed files are
  JSON or CSV.
- **1 · Discovery** — one AI session with MCP tools (grep, glob, view); 3000+-file repos use
  multi-round or iterative breadth-first discovery seeded by Phase 0. Outputs `ComponentGraph`
  (`ProjectInfo`, `ComponentInfo[]`, `CategoryInfo[]`, optional `DomainInfo[]`), caching
  intermediates for crash recovery.
- **2 · Consolidation** — rule-based merge of same-directory components plus AI semantic
  grouping; skipped by `--no-cluster`.
- **3 · Analysis** — per-component analysis with MCP tools under concurrency control; git-hash
  caching re-analyzes only changed components. Outputs `ComponentAnalysis[]`.
- **4 · Writing** — per-component articles plus reduce/synthesis for overview and cross-cutting
  articles; the file writer organizes markdown by domain/category.
- **5 · Website** — static HTML with navigation, light/dark/auto themes, Mermaid zoom/pan, and
  customizable CSS/client JS.

## Core Concepts

| Concept | Level | Description |
|---------|-------|-------------|
| **Component** | Smallest unit | A code directory/unit with a specific purpose. Always present |
| **Domain** | Structural grouping | Top-level directory regions; large repos (3000+ files) only |
| **Theme** | Cross-cutting | User-defined concerns spanning multiple components |

```
ComponentGraph
├── components: ComponentInfo[]        ← always present
│   └── domain?: string                ← links to domain (large repos)
├── domains?: DomainInfo[]             ← large repos only
│   └── components: string[]           ← IDs in this domain
└── themes?: ThemeAreaMeta[]           ← user-created themes
    └── involvedComponentIds: string[] ← components involved
```

## Theme Pipeline

`deep-wiki theme` runs Probe → Outline → Analysis → Articles → File Writing & Wiki Integration →
optional Website Regeneration. Modules in `src/theme/`: `coverage-checker.ts` (loads
`module-graph.json`, finds gaps), `theme-probe.ts` (iterative single-theme probe),
`outline-generator.ts` (sub-article outline), `theme-analysis.ts`, `article-generator.ts`,
`file-writer.ts` (writes into the wiki output directory), and `wiki-integrator.ts` (updates
`module-graph.json`, adds cross-links).

## Caching

Invalidation keys off the git HEAD hash, per phase (seeds, discovery, consolidation, analysis,
articles). Shared cache utilities provide atomic writes (temp + rename), generic read with
validation, and batch scan; analysis is incremental over changed components. `--force` bypasses
all caches, `--use-cache` ignores the hash, `--phase N` skips earlier phases.

## Key Types

```typescript
interface ComponentGraph {
    project: ProjectInfo;
    components: ComponentInfo[];
    categories: CategoryInfo[];
    domains?: DomainInfo[];
    themes?: ThemeAreaMeta[];
}

interface ComponentInfo {
    id: string;           // kebab-case
    name: string;
    path: string;         // relative to repo root
    purpose: string;
    keyFiles: string[];
    dependencies: string[];
    complexity: 'low' | 'medium' | 'high';
    category: string;
    domain?: string;      // large repos only
}

interface ComponentAnalysis {
    componentId: string;
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}
```

## Package Structure

`packages/deep-wiki/src/` holds `index.ts`, `cli.ts`, `types.ts`, `schemas.ts`,
`ai-invoker.ts`, `logger.ts`, `usage-tracker.ts`, `config-loader.ts`, and one directory per
stage: `commands/` (CLI + phase runners), `seeds/`, `discovery/`, `consolidation/`,
`analysis/`, `writing/` (articles + website), `theme/`, `utils/` (errors, git, AI parsing),
`rendering/` (Mermaid zoom/pan), and `cache/`. Vitest tests live in
`packages/deep-wiki/test/`; run `npm run test:run` in that package.
