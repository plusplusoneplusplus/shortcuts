# Shortcuts Module - Developer Reference

This is the main module directory for the "Markdown Review & Workspace Shortcuts" VSCode extension. Each subdirectory is a self-contained feature module with its own AGENTS.md for detailed documentation.

## Recent Refactoring (2026-01)

**Pipeline Core Package Extraction** - Extracted pipeline execution engine into standalone package:
- New package: `pipeline-core` in `packages/pipeline-core/`
- Pure Node.js (no VS Code dependencies), usable in CLI tools
- Modules: logger, utils, ai (SDK service, session pool), map-reduce, pipeline
- Monorepo with npm workspaces
- Extension imports core functionality from the package

**Deep Wiki Generator** - Standalone CLI tool for auto-generating wiki documentation:
- New package: `deep-wiki` in `packages/deep-wiki/`
- CLI tool that auto-generates wiki documentation for any codebase
- 3-phase pipeline: Discovery → Analysis → Writing
- Uses pipeline-core for AI SDK and map-reduce

**Tree Data Provider Base Classes** - Eliminated code duplication across tree data providers:
- Created 5 new shared modules: `base-tree-data-provider`, `filterable-tree-data-provider`, `tree-filter-utils`, `tree-icon-utils`, `tree-error-handler`
- Migrated 4 providers to extend base classes: GlobalNotesTreeDataProvider, TasksTreeDataProvider, PipelinesTreeDataProvider, LogicalTreeDataProvider
- Result: Eliminated ~210 lines of duplication, all 6900 tests passing, 100% backward compatible

## Module Overview

| Module | Description |
|--------|-------------|
| **ai-service** | Generic AI process tracking, VS Code integration (core in `pipeline-core`) |
| **code-review** | Review Git diffs against custom coding rules |
| **debug-panel** | Debug tree view for development/testing |
| **discovery** | AI-powered feature discovery and file organization |
| **git** | Git integration, status monitoring, commit history |
| **git-diff-comments** | Inline commenting on Git diffs |
| **global-notes** | Quick-access notes available across workspaces |
| **lm-tools** | Language model tools for Copilot Chat integration |
| **markdown-comments** | Inline commenting on markdown files |
| **shared** | Shared utilities (logging, text matching, **tree provider base classes**) |
| **sync** | Cloud synchronization via VSCode Settings Sync |
| **tasks-viewer** | Markdown task list management |
| **skills** | Skill installation from GitHub repos, local dirs, or bundled sources |
| **yaml-pipeline** | VS Code UI layer (core in `pipeline-core`) |

## Module Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│              pipeline-core (npm package)          │
│  (logger, utils, ai/copilot-sdk, map-reduce core, pipeline)     │
└─────────────────────────────────────────────────────────────────┘
        ▲           ▲           ▲           ▲
        │           │           │           │
┌───────┴───┐ ┌─────┴─────┐ ┌───┴───────────┴───┐
│ai-service │ │yaml-      │ │  code-review      │
│(VS Code)  │ │pipeline   │ │                   │
└───────────┘ │(VS Code)  │ └───────────────────┘
              └───────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         shared                                  │
│  (logging, text-matching, **tree base classes**, webview utils) │
└─────────────────────────────────────────────────────────────────┘
        ▲           ▲           ▲           ▲           ▲
        │           │           │           │           │
        │     ┌─────┴─────┐     │     ┌─────┴─────┐     │
        │     │           │     │     │           │     │
┌───────┴───┐ │ ┌─────────┴─┐ ┌─┴─────┴───┐ ┌─────┴─────┴───┐
│ai-service │ │ │  git      │ │ markdown- │ │ git-diff-     │
│           │ │ │           │ │ comments  │ │ comments      │
└───────────┘ │ └───────────┘ └───────────┘ └───────────────┘
              │
┌───────────┐ │ ┌───────────┐   ┌───────────┐
│ discovery │─┘ │  lm-tools │   │   sync    │
└───────────┘   └─────┬─────┘   └───────────┘
                      │
                      ▼
              ┌───────────────┐
              │markdown-      │
              │comments       │
              └───────────────┘

┌───────────┐   ┌───────────┐   ┌───────────┐
│global-note│   │tasks-viewe│   │debug-panel│
│(standalone)   │(standalone)   │(standalone)
└───────────┘   └───────────┘   └───────────┘
```

## Dependency Summary

### Core Infrastructure
- **pipeline-core** → Pure Node.js package with AI/pipeline execution engine
- **shared** → Used by almost all modules for logging, utilities, base classes

### AI Processing Stack
- **ai-service** → VS Code integration layer, uses pipeline-core for SDK/CLI
- **yaml-pipeline** → VS Code UI layer, uses pipeline-core for execution
- **code-review** → Uses pipeline-core map-reduce for parallel rule checking

### Commenting Features
- **markdown-comments** → Uses shared for anchoring and prompts
- **git-diff-comments** → Uses shared and git module for diff content

### Git Integration
- **git** → Core Git service, used by git-diff-comments, code-review
- **git-diff-comments** → Uses git for diff content

### Standalone Modules
- **global-notes** → Independent, uses configuration-manager only
- **tasks-viewer** → Independent, parses markdown files
- **debug-panel** → Independent, for development debugging
- **sync** → Independent, cloud sync for configuration
- **lm-tools** → Uses markdown-comments and git-diff-comments managers

## Root-Level Files

| File | Purpose |
|------|---------|
| `index.ts` | Main exports for the shortcuts panel |
| `commands.ts` | Centralized command registration |
| `configuration-manager.ts` | YAML config management |
| `config-migrations.ts` | Version migration for configs |
| `logical-tree-data-provider.ts` | Main tree view provider (supports commit items) |
| `tree-items.ts` | Tree item classes (includes `CommitShortcutItem`, `CommitFileItem`) |
| `drag-drop-controller.ts` | Drag and drop handling |
| `error-handler.ts` | Error handling utilities |
| `theme-manager.ts` | Theme-aware icons |
| `types.ts` | Shared type definitions (`LogicalGroupItemType` includes `'commit'`) |
| `notification-manager.ts` | User notifications |
| `inline-search-provider.ts` | Tree search functionality |
| `keyboard-navigation.ts` | Keyboard shortcuts |
| `file-system-watcher-manager.ts` | File watching |

## Adding a New Module

1. Create a new directory under `src/shortcuts/`
2. Add an `index.ts` with exports
3. Create an `AGENTS.md` following the pattern of existing modules
4. Update this file's module table and dependency diagram
5. If using shared utilities, import from `../shared`
6. If tracking AI processes, use `../ai-service`
