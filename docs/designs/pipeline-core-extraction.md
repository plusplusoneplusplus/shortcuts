# Pipeline Core Package Extraction

## Overview

Extract the AI pipeline execution engine, map-reduce framework, and Copilot SDK integration into a standalone Node.js package. This enables:

1. **CLI usage** - Run pipelines from command line without VS Code
2. **Testability** - Pure Node.js tests without VS Code test runner
3. **Reusability** - Use in other tools, scripts, or applications

## Current State

After decoupling work, the following files are now **VS Code-free**:

| File | Status |
|------|--------|
| `ai-service/copilot-sdk-service.ts` | ✅ Pure (config via `configureSessionPool()`) |
| `ai-service/session-pool.ts` | ✅ Pure |
| `ai-service/types.ts` | ✅ Pure |
| `ai-service/cli-utils.ts` | ✅ Pure |
| `ai-service/prompt-builder.ts` | ✅ Pure |
| `map-reduce/**/*.ts` | ✅ All pure |
| `yaml-pipeline/*.ts` (except `ui/`) | ✅ All pure |
| `shared/file-utils.ts` | ✅ Pure |
| `shared/glob-utils.ts` | ✅ Pure |
| `shared/exec-utils.ts` | ✅ Pure |
| `shared/http-utils.ts` | ✅ Pure |
| `shared/text-matching.ts` | ✅ Pure |
| `shared/ai-response-parser.ts` | ✅ Pure |

**Remaining dependency:** `ai-service-logger.ts` → `shared/extension-logger.ts` uses `vscode.OutputChannel`

## Package Structure

```
packages/
└── pipeline-core/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── src/
    │   ├── index.ts                    # Public API exports
    │   │
    │   ├── ai/
    │   │   ├── index.ts
    │   │   ├── copilot-sdk-service.ts
    │   │   ├── session-pool.ts
    │   │   ├── cli-utils.ts
    │   │   ├── prompt-builder.ts
    │   │   ├── logger.ts               # New: simple logger interface
    │   │   └── types.ts
    │   │
    │   ├── map-reduce/
    │   │   ├── index.ts
    │   │   ├── executor.ts
    │   │   ├── concurrency-limiter.ts
    │   │   ├── prompt-template.ts
    │   │   ├── temp-file-utils.ts
    │   │   ├── types.ts
    │   │   ├── jobs/
    │   │   ├── reducers/
    │   │   └── splitters/
    │   │
    │   ├── pipeline/
    │   │   ├── index.ts
    │   │   ├── executor.ts
    │   │   ├── csv-reader.ts
    │   │   ├── template.ts
    │   │   ├── filter-executor.ts
    │   │   ├── prompt-resolver.ts
    │   │   ├── skill-resolver.ts
    │   │   ├── input-generator.ts
    │   │   └── types.ts
    │   │
    │   └── utils/
    │       ├── index.ts
    │       ├── file-utils.ts
    │       ├── glob-utils.ts
    │       ├── exec-utils.ts
    │       ├── http-utils.ts
    │       ├── text-matching.ts
    │       └── ai-response-parser.ts
    │
    └── test/
```

## Logger Abstraction

The only remaining VS Code dependency is the logger. Create a simple interface:

```typescript
// packages/pipeline-core/src/logger.ts

export interface Logger {
    debug(category: string, message: string): void;
    info(category: string, message: string): void;
    warn(category: string, message: string): void;
    error(category: string, message: string, error?: Error): void;
}

export const consoleLogger: Logger = {
    debug: (cat, msg) => console.debug(`[${cat}] ${msg}`),
    info: (cat, msg) => console.log(`[${cat}] ${msg}`),
    warn: (cat, msg) => console.warn(`[${cat}] ${msg}`),
    error: (cat, msg, err) => console.error(`[${cat}] ${msg}`, err || ''),
};

export const nullLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

// Global logger instance (can be replaced)
let globalLogger: Logger = consoleLogger;

export function setLogger(logger: Logger): void {
    globalLogger = logger;
}

export function getLogger(): Logger {
    return globalLogger;
}
```

**In extension**, bridge to VS Code logger:

```typescript
// vscode-extension/src/adapters/logger-adapter.ts
import { Logger, setLogger } from 'pipeline-core';
import { getExtensionLogger, LogCategory } from './shared/extension-logger';

export function initializeCoreLogger(): void {
    const vscodeLogger = getExtensionLogger();

    setLogger({
        debug: (cat, msg) => vscodeLogger.debug(cat as LogCategory, msg),
        info: (cat, msg) => vscodeLogger.info(cat as LogCategory, msg),
        warn: (cat, msg) => vscodeLogger.warn(cat as LogCategory, msg),
        error: (cat, msg, err) => vscodeLogger.error(cat as LogCategory, msg, err),
    });
}
```

## File Migration Map

### AI Service

| Source | Destination | Changes |
|--------|-------------|---------|
| `copilot-sdk-service.ts` | `src/ai/` | Replace `getExtensionLogger()` with `getLogger()` |
| `session-pool.ts` | `src/ai/` | None |
| `types.ts` | `src/ai/` | None |
| `cli-utils.ts` | `src/ai/` | None |
| `prompt-builder.ts` | `src/ai/` | None |

### Map-Reduce (all files move as-is)

| Source | Destination |
|--------|-------------|
| `executor.ts` | `src/map-reduce/` |
| `concurrency-limiter.ts` | `src/map-reduce/` |
| `prompt-template.ts` | `src/map-reduce/` |
| `temp-file-utils.ts` | `src/map-reduce/` |
| `types.ts` | `src/map-reduce/` |
| `jobs/*.ts` | `src/map-reduce/jobs/` |
| `reducers/*.ts` | `src/map-reduce/reducers/` |
| `splitters/*.ts` | `src/map-reduce/splitters/` |

### YAML Pipeline (core files only)

| Source | Destination |
|--------|-------------|
| `executor.ts` | `src/pipeline/` |
| `csv-reader.ts` | `src/pipeline/` |
| `template.ts` | `src/pipeline/` |
| `filter-executor.ts` | `src/pipeline/` |
| `prompt-resolver.ts` | `src/pipeline/` |
| `skill-resolver.ts` | `src/pipeline/` |
| `input-generator.ts` | `src/pipeline/` |
| `types.ts` | `src/pipeline/` |

**Stay in extension:**
- `yaml-pipeline/ui/*` - VS Code tree views and commands
- `yaml-pipeline/bundled/*` - VS Code-specific bundled pipelines

### Shared Utils

| Source | Destination |
|--------|-------------|
| `file-utils.ts` | `src/utils/` |
| `glob-utils.ts` | `src/utils/` |
| `exec-utils.ts` | `src/utils/` |
| `http-utils.ts` | `src/utils/` |
| `text-matching.ts` | `src/utils/` |
| `ai-response-parser.ts` | `src/utils/` |

## Package Configuration

### package.json

```json
{
  "name": "pipeline-core",
  "version": "1.0.0",
  "description": "AI pipeline execution engine with map-reduce framework",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./ai": "./dist/ai/index.js",
    "./map-reduce": "./dist/map-reduce/index.js",
    "./pipeline": "./dist/pipeline/index.js",
    "./utils": "./dist/utils/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "lint": "eslint src"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0",
    "js-yaml": "^4.1.0",
    "csv-parse": "^5.5.0",
    "glob": "^10.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0",
    "@types/js-yaml": "^4.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

## Public API

### Main Exports

```typescript
// packages/pipeline-core/src/index.ts

// Logger
export { Logger, consoleLogger, nullLogger, setLogger, getLogger } from './logger';

// AI Service
export {
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
    SendMessageOptions,
    SDKInvocationResult,
    PermissionHandler,
    approveAllPermissions,
    denyAllPermissions,
} from './ai';

export { SessionPool } from './ai/session-pool';

// Map-Reduce
export { MapReduceExecutor, createExecutor } from './map-reduce';
export type { MapReduceOptions, MapReduceResult, MapJob } from './map-reduce/types';

// Pipeline
export { executePipeline, parsePipelineYaml } from './pipeline';
export type { PipelineConfig, PipelineResult } from './pipeline/types';

// Utils
export * from './utils';
```

## Usage Examples

### Standalone CLI Usage

```typescript
import {
    CopilotSDKService,
    executePipeline,
    consoleLogger,
    setLogger
} from 'pipeline-core';
import { readFileSync } from 'fs';

// Use console logger (default)
setLogger(consoleLogger);

// Get the service and configure
const aiService = CopilotSDKService.getInstance();
aiService.configureSessionPool({
    maxSessions: 5,
    idleTimeoutMs: 300000
});

// Execute pipeline
const pipelineYaml = readFileSync('./pipeline.yaml', 'utf-8');
const result = await executePipeline({
    pipelineYaml,
    basePath: './my-pipeline',
    aiService,
    onProgress: (current, total) => {
        console.log(`Processing ${current}/${total}`);
    }
});

console.log('Results:', result.outputs);
```

### VS Code Extension Usage

```typescript
// In extension activation
import {
    CopilotSDKService,
    setLogger
} from 'pipeline-core';
import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from './shared/extension-logger';

export function activate(context: vscode.ExtensionContext) {
    // Bridge logger to VS Code output channel
    const vscodeLogger = getExtensionLogger();
    setLogger({
        debug: (cat, msg) => vscodeLogger.debug(cat as LogCategory, msg),
        info: (cat, msg) => vscodeLogger.info(cat as LogCategory, msg),
        warn: (cat, msg) => vscodeLogger.warn(cat as LogCategory, msg),
        error: (cat, msg, err) => vscodeLogger.error(cat as LogCategory, msg, err),
    });

    // Configure SDK service from VS Code settings
    const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.sdk');
    const aiService = CopilotSDKService.getInstance();
    aiService.configureSessionPool({
        maxSessions: config.get('maxSessions', 5),
        idleTimeoutMs: config.get('sessionTimeout', 300000)
    });
}
```

## Monorepo Setup

### Directory Structure

```
shortcuts/
├── package.json                  # Workspace root
├── packages/
│   └── pipeline-core/            # pipeline-core
│       ├── package.json
│       └── src/
└── vscode-extension/             # VS Code extension
    ├── package.json              # depends on pipeline-core
    └── src/
        ├── extension.ts
        └── shortcuts/
            ├── ai-service/       # Only VS Code-specific files remain
            │   ├── ai-process-manager.ts
            │   ├── ai-process-tree-provider.ts
            │   └── ...
            └── yaml-pipeline/
                └── ui/           # Only UI components remain
```

### Root package.json

```json
{
  "name": "shortcuts-monorepo",
  "private": true,
  "workspaces": [
    "packages/*",
    "vscode-extension"
  ]
}
```

## Implementation Tasks

### Phase 1: Setup ✅ COMPLETED
- [x] Create monorepo structure with npm workspaces
- [x] Set up `packages/pipeline-core/` with package.json and tsconfig
- [x] Create logger abstraction module

### Phase 2: Copy Files ✅ COMPLETED
- [x] Copy map-reduce module to core package
- [x] Copy pipeline module to core package
- [x] Copy utils module to core package
- [x] Copy ai module to core package

### Phase 3: Update Extension ✅ COMPLETED
- [x] Update extension to import from `pipeline-core` instead of local files
- [x] Initialize logger bridge in extension activation
- [x] Verify all functionality works with core package imports (6900 tests passing)
- [x] Remove duplicated files from `src/shortcuts/`

**Current state:** Extension index files re-export from `pipeline-core`. Duplicated source files
have been removed from the extension. All imports now use either the index files (which re-export
from pipeline-core) or import directly from `@anthropic-ai/pipeline-core`.

### Phase 4: Test Migration ✅ COMPLETED
- [x] Set up vitest for core package (`vitest.config.ts`)
- [x] Migrated all pure logic tests (see Test Migration Map below)
- [x] All 569 tests passing in pipeline-core package
- [x] All 6900 extension tests passing
- [x] Remove duplicated tests from extension after Phase 3 completion

### Phase 5: Cleanup ✅ COMPLETED
- [x] Remove duplicated source files from extension after Phase 3
- [x] Remove duplicated test files from extension after Phase 4
- [x] Update all AGENTS.md files
- [x] Final documentation updates

## Test Migration Map

### Map-Reduce Tests

| Test File | Status | Tests | Destination |
|-----------|--------|-------|-------------|
| `concurrency-limiter.test.ts` | ✅ Migrated | 21 | `test/map-reduce/` |
| `temp-file-utils.test.ts` | ✅ Migrated | 38 | `test/map-reduce/` |
| `executor.test.ts` | ✅ Migrated | 19 | `test/map-reduce/` |
| `prompt-template.test.ts` | ✅ Migrated | 35 | `test/map-reduce/` |
| `reducers.test.ts` | ✅ Migrated | 20 | `test/map-reduce/` |
| `splitters.test.ts` | ✅ Migrated | 23 | `test/map-reduce/` |
| `reduce-process-tracking.test.ts` | ✅ Migrated | 6 | `test/map-reduce/` |

### Pipeline Tests

| Test File | Status | Tests | Destination |
|-----------|--------|-------|-------------|
| `csv-reader.test.ts` | ✅ Migrated | 40 | `test/pipeline/` |
| `executor.test.ts` | ✅ Migrated | 56 | `test/pipeline/` |
| `template.test.ts` | ✅ Migrated | 65 | `test/pipeline/` |
| `skill-resolver.test.ts` | ✅ Migrated | 42 | `test/pipeline/` |
| `input-generator.test.ts` | ✅ Migrated | 48 | `test/pipeline/` |
| `edge-cases.test.ts` | ✅ Migrated | 22 | `test/pipeline/` |
| `ai-reduce.test.ts` | ✅ Migrated | 19 | `test/pipeline/` |
| `batch-mapping.test.ts` | ✅ Migrated | 26 | `test/pipeline/` |
| `text-mode.test.ts` | ✅ Migrated | 38 | `test/pipeline/` |
| `results-file.test.ts` | ✅ Migrated | 12 | `test/pipeline/` |
| `multi-model-fanout.test.ts` | ✅ Migrated | 32 | `test/pipeline/` |
| `index.test.ts` | ✅ Migrated | 25 | `test/pipeline/` |

**Total: 569 tests migrated to pipeline-core package**

### Tests That Stay in Extension (VS Code UI)

| Test File | Reason |
|-----------|--------|
| `commands.test.ts` | Tests VS Code commands |
| `pipeline-executor-service.test.ts` | Uses MockAIProcessManager, VS Code integration |
| `preview-content.test.ts` | Tests UI, imports from `ui/types` |
| `preview-mermaid.test.ts` | Tests UI, imports from `ui/types` |
| `result-viewer.test.ts` | Tests UI content generation |

## What Stays in Extension

These files remain in the VS Code extension (not extracted):

| Module | Files | Reason |
|--------|-------|--------|
| AI Service | `ai-process-manager.ts` | Uses vscode.Memento |
| AI Service | `ai-process-tree-provider.ts` | VS Code TreeDataProvider |
| AI Service | `ai-process-document-provider.ts` | VS Code TextDocumentContentProvider |
| AI Service | `copilot-cli-invoker.ts` | Uses vscode config/clipboard |
| AI Service | `interactive-session-*.ts` | VS Code UI |
| Pipeline | `yaml-pipeline/ui/*` | VS Code tree views |
| Pipeline | `yaml-pipeline/bundled/*` | VS Code-specific |
| Shared | `extension-logger.ts` | Uses vscode.OutputChannel |
| Shared | `*-tree-data-provider.ts` | VS Code TreeDataProvider |
| Shared | `*-document-provider.ts` | VS Code providers |
