# Shortcuts Module - Developer Reference

This is the main module directory for the "Markdown Review & Workspace Shortcuts" VSCode extension. Each subdirectory is a self-contained feature module with its own AGENTS.md for detailed documentation.

## Recent Refactoring (2026-01)

**Tree Data Provider Base Classes** - Eliminated code duplication across tree data providers:
- Created 5 new shared modules: `base-tree-data-provider`, `filterable-tree-data-provider`, `tree-filter-utils`, `tree-icon-utils`, `tree-error-handler`
- Migrated 4 providers to extend base classes: GlobalNotesTreeDataProvider, TasksTreeDataProvider, PipelinesTreeDataProvider, LogicalTreeDataProvider
- Result: Eliminated ~210 lines of duplication, all 5690 tests passing, 100% backward compatible

## Module Overview

| Module | Description |
|--------|-------------|
| **ai-service** | Generic AI process tracking and Copilot CLI invocation |
| **code-review** | Review Git diffs against custom coding rules |
| **debug-panel** | Debug tree view for development/testing |
| **discovery** | AI-powered feature discovery and file organization |
| **git** | Git integration, status monitoring, commit history |
| **git-diff-comments** | Inline commenting on Git diffs |
| **global-notes** | Quick-access notes available across workspaces |
| **lm-tools** | Language model tools for Copilot Chat integration |
| **map-reduce** | Parallel AI processing framework |
| **markdown-comments** | Inline commenting on markdown files |
| **shared** | Shared utilities (logging, text matching, **tree provider base classes**) |
| **sync** | Cloud synchronization via VSCode Settings Sync |
| **tasks-viewer** | Markdown task list management |
| **yaml-pipeline** | YAML configuration layer for map-reduce |

## Module Dependencies

```
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
└─────┬─────┘ │ └─────┬─────┘ └───────────┘ └───────────────┘
      │       │       │
      ▼       │       ▼
┌─────────────┴───────────────┐
│        map-reduce           │
│  (executor, splitters,      │
│   reducers, templates)      │
└─────────────┬───────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
┌───────────┐   ┌─────────────┐
│code-review│   │yaml-pipeline│
└───────────┘   └─────────────┘

┌───────────┐   ┌───────────┐   ┌───────────┐
│ discovery │──▶│ai-service │   │  lm-tools │
└───────────┘   └───────────┘   └─────┬─────┘
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
              ┌───────────────┐               ┌───────────────┐
              │markdown-      │               │git-diff-      │
              │comments       │               │comments       │
              └───────────────┘               └───────────────┘

┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│global-note│   │tasks-viewe│   │debug-panel│   │   sync    │
│(standalone)   │(standalone)   │(standalone)   │(standalone)
└───────────┘   └───────────┘   └───────────┘   └───────────┘
```

## Dependency Summary

### Core Infrastructure
- **shared** → Used by almost all modules for logging, utilities, base classes

### AI Processing Stack
- **ai-service** → Base AI tracking, used by discovery, code-review
- **map-reduce** → Uses ai-service for process tracking
- **yaml-pipeline** → Configuration layer on top of map-reduce
- **code-review** → Uses map-reduce for parallel rule checking

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
| `logical-tree-data-provider.ts` | Main tree view provider |
| `tree-items.ts` | Tree item classes |
| `drag-drop-controller.ts` | Drag and drop handling |
| `error-handler.ts` | Error handling utilities |
| `theme-manager.ts` | Theme-aware icons |
| `types.ts` | Shared type definitions |
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
