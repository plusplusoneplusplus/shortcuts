# Workflow Core Package Boundary

## Overview

The workflow core boundary keeps AI workflow execution, map-reduce helpers, git utilities, diff providers, editor-independent rendering helpers, and SDK integration in reusable Node packages. CoC then consumes those packages from the CLI, HTTP server, queue executors, and dashboard.

This boundary serves three goals:

1. **CLI usage** - `coc run` and package APIs run workflows without a UI runtime.
2. **Testability** - Pure logic has Vitest coverage in package tests.
3. **Reusability** - Other tools can consume workflow, AI, git, diff, and rendering helpers through package exports.

## Package Responsibilities

| Package | Responsibility |
|---------|----------------|
| `@plusplusoneplusplus/coc-workflow` | Pure DAG workflow compiler/executor, legacy pipeline YAML compatibility, workflow logger contracts, workflow errors, and Ralph portable helpers. |
| `@plusplusoneplusplus/forge` | AI utilities, map-reduce, git CLI services, diff providers, process store, review helpers, editor-independent rendering/anchor helpers, and compatibility exports. |
| `@plusplusoneplusplus/coc-agent-sdk` | Provider-agnostic Copilot/Codex SDK wrapper, model registry, session lifecycle, warm client registry, and streaming state machine. |
| `@plusplusoneplusplus/coc` | CLI, HTTP server, queue executors, dashboard SPA, workspace routing, and runtime persistence. |
| `@plusplusoneplusplus/coc-client` | Framework-free REST and realtime client for dashboard and external consumers. |

Shared behavior belongs in these packages. Runtime surfaces that depend on CoC workspace state, HTTP routes, queue semantics, or dashboard components stay in `packages/coc/`.

## Core Module Layout

```text
packages/coc-workflow/src/
  index.ts
  logger.ts
  errors/
  workflow/
    compiler.ts
    executor.ts
    scheduler.ts
    validator.ts
    pipeline-compat.ts
    nodes/
    types.ts
  ralph/

packages/forge/src/
  ai/
  map-reduce/
  git/
  diff/
  editor/
  review/
  workflow/
  utils/

packages/coc-agent-sdk/src/
  providers/
  services/
  model-registry/
  warm-client-registry.ts
```

## Logger Abstraction

Package code uses a small logger interface instead of depending on any host UI.

```typescript
export interface Logger {
  debug(category: string, message: string): void;
  info(category: string, message: string): void;
  warn(category: string, message: string): void;
  error(category: string, message: string, error?: Error): void;
}

export const consoleLogger: Logger = {
  debug: (category, message) => console.debug(`[${category}] ${message}`),
  info: (category, message) => console.log(`[${category}] ${message}`),
  warn: (category, message) => console.warn(`[${category}] ${message}`),
  error: (category, message, error) => console.error(`[${category}] ${message}`, error ?? ''),
};

let globalLogger: Logger = consoleLogger;

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getLogger(): Logger {
  return globalLogger;
}
```

CoC wraps this contract with Pino-backed server logging. Tests can use a null or in-memory logger.

## Public Workflow API

```typescript
import {
  compileToWorkflow,
  executeWorkflow,
  flattenWorkflowResult,
} from '@plusplusoneplusplus/coc-workflow';

const config = compileToWorkflow(yamlContent);
const result = await executeWorkflow(config, {
  aiInvoker,
  workingDirectory,
  onProgress,
  signal,
});

const flat = flattenWorkflowResult(result);
```

## Public Diff API

```typescript
import {
  createCommitDiffProvider,
  createRangeDiffProvider,
  createWorkingTreeDiffProvider,
} from '@plusplusoneplusplus/forge';

const provider = createRangeDiffProvider('/repo', 'origin/main', 'HEAD');
const files = await provider.listFiles();
const diff = await provider.getFileDiff(files[0].path, { maxLines: 500 });
```

The diff provider contract supports single commits, commit ranges, working tree changes, pull requests, and pull-request iterations behind one interface.

## Public AI Service Boundary

The SDK package owns provider process lifecycle and per-turn session creation. Higher packages may warm provider client processes for a short TTL, but they must not cache session objects or add follow-up shortcuts that bypass the per-turn session lifecycle.

```typescript
import { SDKServiceRegistry } from '@plusplusoneplusplus/coc-agent-sdk';

const service = SDKServiceRegistry.get(provider);
const result = await service.sendMessage(prompt, {
  workingDirectory,
  model,
  reasoningEffort,
  signal,
});
```

## CoC Integration

CLI execution:

```bash
coc run path/to/workflow.yaml
coc validate path/to/workflow.yaml
```

Queue execution:

```typescript
import { compileToWorkflow, executeWorkflow } from '@plusplusoneplusplus/coc-workflow';

const config = compileToWorkflow(yamlContent);
const result = await executeWorkflow(config, {
  aiInvoker: createQueueAIInvoker(task, workspace),
  workingDirectory: workspace.root,
  onProgress: event => publishProgress(task.id, event),
  signal: task.abortSignal,
});
```

Dashboard integration:

- Workflow list and run controls call CoC routes.
- Process detail subscribes to progress events.
- Task and diff comments use workspace-scoped persistence.
- Git, PR, branch range, and work item features consume Forge services through server routes.

## Workspace and Persistence Rules

- All per-repo runtime data lives under `~/.coc/repos/<workspaceId>/`.
- Use `getRepoDataPath(dataDir, workspaceId, filename)` when adding repo-scoped server data.
- Work items are created and updated through the CoC REST API.
- Runtime paths must support multiple registered workspaces in one server.
- YAML workflow examples may live in `.vscode/workflows/` or `.vscode/pipelines/` as repository configuration directories.

## Test Strategy

Package tests:

- Workflow compiler, validator, scheduler, node executors, parameters, and progress events.
- Map-reduce executor, splitters, reducers, concurrency limits, and temp-file utilities.
- Git range, git log, branch services, and diff provider parsing.
- Logger adapters and error helpers.

CoC tests:

- CLI command behavior.
- Server queue execution.
- Workspace-scoped route handling.
- Dashboard rendering and browser flows.

## Build Contract

Root package build order:

```text
coc-agent-sdk -> coc-workflow -> forge -> coc-client -> coc-memory -> teams-bot -> coc -> deep-wiki
```

Direct package builds keep the same dependency order through package prebuild scripts.

## Design Constraints

1. Keep pure workflow execution in `coc-workflow`.
2. Keep compatibility utilities and git/diff/review helpers in `forge`.
3. Keep HTTP, queue, workspace, and dashboard concerns in `coc`.
4. Keep SDK provider lifecycle in `coc-agent-sdk`.
5. Do not introduce repo-scoped runtime data outside `~/.coc/repos/<workspaceId>/`.
6. Do not break multi-repo routing.
