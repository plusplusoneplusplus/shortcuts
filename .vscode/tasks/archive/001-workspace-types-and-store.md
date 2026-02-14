---
status: pending
---

# 001: Add workspace-aware process types and ProcessStore interface

## Summary

Introduce workspace awareness to AI process tracking by adding a `WorkspaceInfo` type, optional workspace fields on `GenericProcessMetadata`, and a `ProcessStore` interface that abstracts process persistence with workspace-scoped querying. This is the foundational data-layer commit for the standalone AI execution web server (`pipeline serve`).

## Motivation

Today, AI processes are stored per-workspace via VS Code's Memento API inside `AIProcessManager`. This couples process persistence to VS Code and prevents a standalone server from aggregating processes across multiple workspaces and CLI invocations. By defining a `ProcessStore` interface in `pipeline-core` (which has zero VS Code dependencies), we enable:

1. **Server-side storage** — The upcoming `pipeline serve` HTTP server can implement `ProcessStore` with an in-memory or SQLite backend.
2. **Multi-workspace dashboards** — Each workspace registers itself with `WorkspaceInfo`, and the dashboard can filter/group processes by workspace.
3. **Backward compatibility** — All new fields are optional; existing extension code and tests are unaffected.

## Changes

### Files to Create

#### `packages/pipeline-core/src/process-store.ts`

New module exporting the `ProcessStore` interface, `ProcessFilter` type, and `ProcessChangeCallback` type.

```typescript
import { AIProcess, AIProcessStatus, AIProcessType, ProcessEvent } from './ai/process-types';

/**
 * Workspace identity for multi-workspace process tracking.
 * `id` is a stable hash of the workspace root path.
 */
export interface WorkspaceInfo {
    /** Stable unique identifier — hash of rootPath */
    id: string;
    /** Human-readable name (e.g. workspace folder name) */
    name: string;
    /** Absolute path to workspace root */
    rootPath: string;
    /** Optional UI color for dashboard differentiation */
    color?: string;
}

/**
 * Filter criteria for querying processes.
 * All fields are optional; omitted fields impose no constraint.
 */
export interface ProcessFilter {
    workspaceId?: string;
    status?: AIProcessStatus | AIProcessStatus[];
    type?: AIProcessType;
    since?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Callback type for process change notifications.
 */
export type ProcessChangeCallback = (event: ProcessEvent) => void;

/**
 * Abstract storage interface for AI processes.
 *
 * Implementations may be backed by VS Code Memento (extension),
 * in-memory Map (tests / server), or SQLite (persistent server).
 */
export interface ProcessStore {
    addProcess(process: AIProcess): Promise<void>;
    updateProcess(id: string, updates: Partial<AIProcess>): Promise<void>;
    getProcess(id: string): Promise<AIProcess | undefined>;
    getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]>;
    removeProcess(id: string): Promise<void>;
    /** Remove processes matching filter. Returns count of removed items. */
    clearProcesses(filter?: ProcessFilter): Promise<number>;

    /** Return all known workspaces. */
    getWorkspaces(): Promise<WorkspaceInfo[]>;
    /** Register (or update) a workspace identity. */
    registerWorkspace(workspace: WorkspaceInfo): Promise<void>;

    /** Optional callback invoked on every process mutation. */
    onProcessChange?: ProcessChangeCallback;
}
```

Key design decisions:
- **Import from `./ai/process-types`** (internal path) rather than the barrel `./ai` to avoid circular dependencies — the barrel re-exports `process-types` already.
- **`ProcessFilter.status` accepts a single value or array** for convenience (e.g., filter by `['running', 'queued']`).
- **`clearProcesses` returns `Promise<number>`** so callers know how many items were removed.
- **`onProcessChange` is an optional property**, not a method with add/remove — keeps the interface minimal; implementations can use EventEmitter internally.

### Files to Modify

#### `packages/pipeline-core/src/ai/process-types.ts`

Add optional workspace fields to `GenericProcessMetadata`:

```typescript
// Inside GenericProcessMetadata interface, after the existing `[key: string]: unknown;` line:
/** Workspace ID this process belongs to (hash of workspace root path) */
workspaceId?: string;
/** Human-readable workspace name */
workspaceName?: string;
```

These are typed as optional index-signature-compatible fields. Because `GenericProcessMetadata` already has `[key: string]: unknown`, adding explicit optional `string` properties is type-safe and fully backward compatible — existing objects without these fields remain valid.

No changes to `AIProcess`, `SerializedAIProcess`, `serializeProcess`, or `deserializeProcess` are needed because the workspace fields live in `metadata` (which is already serialized as-is via object spread).

#### `packages/pipeline-core/src/index.ts`

Add a new export section after the existing "AI Service" block:

```typescript
// ============================================================================
// Process Store
// ============================================================================

export {
    WorkspaceInfo,
    ProcessFilter,
    ProcessChangeCallback,
    ProcessStore
} from './process-store';
```

Also re-export `WorkspaceInfo` from `./process-store` (not from `./ai`) to keep workspace concepts co-located with the store interface.

## Implementation Notes

1. **No runtime code** — This commit is pure type definitions and an interface. No implementations yet; those come in later commits (in-memory store, SQLite store, Memento adapter).
2. **`WorkspaceInfo.id` generation** — The hashing utility is NOT defined here. Consumers will use `hashText` (already exported from `pipeline-core/utils`) or a similar function. The type only declares the contract.
3. **`GenericProcessMetadata` index signature** — The existing `[key: string]: unknown` means `workspaceId?: string` and `workspaceName?: string` are already structurally valid. Adding them explicitly provides discoverability, autocomplete, and documentation — no runtime change.
4. **Circular dependency avoidance** — `process-store.ts` imports directly from `./ai/process-types` (the leaf module), not from `./ai/index.ts` or `./index.ts`, preventing any circular import chain.

## Tests

### Type compilation tests

Add a lightweight test file `packages/pipeline-core/test/process-store.test.ts` that:

1. **Imports all new types** — verifies they are re-exported correctly from the package index.
2. **Constructs a `WorkspaceInfo` object** — verifies the shape compiles with required and optional fields.
3. **Constructs a `ProcessFilter` with single and array `status`** — verifies the union type works.
4. **Creates a mock `ProcessStore` implementation** — verifies the interface is implementable (all methods, optional `onProcessChange`).
5. **Assigns `workspaceId` / `workspaceName` on `GenericProcessMetadata`** — verifies the new optional fields compile without breaking the index signature.
6. **Backward compatibility** — creates a `GenericProcessMetadata` object WITHOUT the new fields and verifies it still compiles.

These are compile-time + runtime shape tests (Vitest `describe`/`it` blocks with `expect`), not integration tests.

## Acceptance Criteria

- [ ] All existing pipeline-core tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] All existing extension tests pass (`npm test` from root)
- [ ] `WorkspaceInfo` is importable: `import { WorkspaceInfo } from 'pipeline-core'`
- [ ] `ProcessStore` is importable: `import { ProcessStore } from 'pipeline-core'`
- [ ] `ProcessFilter` is importable: `import { ProcessFilter } from 'pipeline-core'`
- [ ] `ProcessChangeCallback` is importable: `import { ProcessChangeCallback } from 'pipeline-core'`
- [ ] `GenericProcessMetadata` accepts `workspaceId` and `workspaceName` optional fields
- [ ] `GenericProcessMetadata` still accepts objects without workspace fields (backward compat)
- [ ] No new runtime dependencies added to pipeline-core
- [ ] New test file `packages/pipeline-core/test/process-store.test.ts` passes

## Dependencies

- Depends on: None
