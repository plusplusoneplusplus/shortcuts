---
status: pending
---

# 002: ADO Work Items Service

## Summary

Create `packages/pipeline-core/src/ado/workitems-service.ts`, a class-based utility service that wraps `IWorkItemTrackingApi` from `azure-devops-node-api`. The service exposes ergonomic async methods for the most common work-item operations: fetching by ID or in bulk, creating and patching work items, running WIQL queries, and reading/writing comments. Export the new class and its supporting types through the existing `packages/pipeline-core/src/ado/index.ts`.

## Motivation

Pipeline-core consumers (CoC pipelines, the coc-server wiki layer, deep-wiki probes) need a reusable, tested abstraction over the Azure DevOps Work Item Tracking REST API. Wrapping `IWorkItemTrackingApi` in a typed service:

- Hides the verbose `JsonPatchDocument` construction behind named parameters.
- Provides a consistent error-handling surface (re-throws as `AdoConnectionError` or a new `AdoWorkItemError`).
- Makes unit testing trivial — callers inject `WebApi`; tests inject a mock.

## Changes

### Files to Create

#### `packages/pipeline-core/src/ado/workitems-service.ts`

Full class implementation. Skeleton:

```typescript
import * as VSSInterfaces from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {
  WorkItem,
  WorkItemExpand,
  WorkItemQueryResult,
  Comment,
  CommentList,
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { WebApi } from 'azure-devops-node-api';

export type PatchOp = 'add' | 'replace' | 'remove';

export interface FieldPatch {
  op: PatchOp;
  path: string;   // e.g. '/fields/System.Title'
  value?: unknown;
}

export class AdoWorkItemsService {
  constructor(private readonly connection: WebApi) {}

  // --- fetch ---
  async getWorkItem(
    id: number,
    project?: string,
    fields?: string[],
    expand?: WorkItemExpand,
  ): Promise<WorkItem>

  async getWorkItems(
    ids: number[],
    project?: string,
    fields?: string[],
    expand?: WorkItemExpand,
  ): Promise<WorkItem[]>

  // --- mutate ---
  async createWorkItem(
    project: string,
    type: string,             // e.g. 'Task', 'Bug', 'User Story'
    fields: Record<string, unknown>,  // { 'System.Title': '...', ... }
  ): Promise<WorkItem>

  async updateWorkItem(
    id: number,
    fields: Record<string, unknown>,  // fields to patch (op = 'add')
    project?: string,
  ): Promise<WorkItem>

  // --- query ---
  async queryByWiql(
    query: string,            // full WIQL string
    project?: string,
    top?: number,
  ): Promise<WorkItemQueryResult>

  // --- comments ---
  async getComments(project: string, workItemId: number): Promise<CommentList>
  async addComment(project: string, workItemId: number, text: string): Promise<Comment>
}
```

**Internal helpers:**

- `private async getClient(): Promise<IWorkItemTrackingApi>` — calls `this.connection.getWorkItemTrackingApi()`, wraps errors as `AdoWorkItemError`.
- `private static toDocument(fields: Record<string, unknown>): VSSInterfaces.JsonPatchDocument` — maps `{ 'System.Title': 'foo' }` → `[{ op: 'add', path: '/fields/System.Title', value: 'foo' }]`.

**Error handling:** Catch any exception thrown by the underlying API client and re-throw as `AdoWorkItemError extends Error` (new class in the same file, also exported):

```typescript
export class AdoWorkItemError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AdoWorkItemError';
  }
}
```

#### `packages/pipeline-core/src/ado/workitems-service.test.ts`

Vitest unit tests (see **Tests** section).

### Files to Modify

#### `packages/pipeline-core/src/ado/index.ts`

Add re-export line:

```typescript
export * from './workitems-service';
```

No other changes.

## Implementation Notes

### `toDocument` helper

`JsonPatchDocument` is typed as `VSSInterfaces.JsonPatchOperation[]`. Build it from a plain `Record<string, unknown>`:

```typescript
private static toDocument(
  fields: Record<string, unknown>,
  op: PatchOp = 'add',
): VSSInterfaces.JsonPatchDocument {
  return Object.entries(fields).map(([key, value]) => ({
    op,
    path: `/fields/${key}`,
    value,
  })) as VSSInterfaces.JsonPatchDocument;
}
```

For `updateWorkItem`, always use `op: 'add'` — ADO treats `add` on an existing field as an upsert.

### `createWorkItem` example patch

```typescript
const document = AdoWorkItemsService.toDocument({
  'System.Title': 'Fix login bug',
  'System.Description': '<p>Repro steps...</p>',
  'Microsoft.VSTS.Common.Priority': 1,
});
const wi = await client.createWorkItem({}, document, project, type);
```

`createWorkItem` first argument is `customHeaders` — always pass `{}`.

### `updateWorkItem` example patch

```typescript
const document = AdoWorkItemsService.toDocument({
  'System.State': 'Active',
  'System.AssignedTo': 'user@example.com',
});
const wi = await client.updateWorkItem({}, document, id, project);
```

### WIQL query

```typescript
const result = await client.queryByWiql(
  { query: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] = "Active"' },
  project ? { project } : undefined,
  undefined,
  top,
);
```

`teamContext` must be `{ project }` (partial `TeamContext`), not just a string.

### `getWorkItems` chunking (optional enhancement, can be done in a follow-up)

ADO limits bulk `getWorkItems` to 200 IDs per request. The initial implementation MAY throw if `ids.length > 200`. Document this limit with a JSDoc comment and a thrown `AdoWorkItemError` with a clear message; chunked batching can be a follow-up.

### Imports

Use named imports from sub-paths to avoid pulling in the entire package:

```typescript
import { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import {
  WorkItem,
  WorkItemExpand,
  WorkItemQueryResult,
  Comment,
  CommentList,
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import * as VSSInterfaces from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { WebApi } from 'azure-devops-node-api';
```

## Tests

File: `packages/pipeline-core/src/ado/workitems-service.test.ts`

Use Vitest. Mock `WebApi` so `getWorkItemTrackingApi()` returns a stub implementing `IWorkItemTrackingApi`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoWorkItemsService, AdoWorkItemError } from './workitems-service';
import { WebApi } from 'azure-devops-node-api';

const mockClient = {
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  queryByWiql: vi.fn(),
  getComments: vi.fn(),
  addComment: vi.fn(),
};

const mockConnection = {
  getWorkItemTrackingApi: vi.fn().mockResolvedValue(mockClient),
} as unknown as WebApi;

let service: AdoWorkItemsService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new AdoWorkItemsService(mockConnection);
});
```

### Test cases to cover

| Test | Description |
|------|-------------|
| `getWorkItem` — success | Stub returns `{ id: 42, fields: {...} }`; assert service returns it unchanged |
| `getWorkItem` — client throws | Stub throws `new Error('not found')`; assert service throws `AdoWorkItemError` with `cause` set |
| `getWorkItems` — success | Stub returns array of 3 items; assert length and IDs |
| `getWorkItems` — over 200 IDs | Pass 201 IDs; assert `AdoWorkItemError` thrown before API is called |
| `createWorkItem` — document shape | Capture `document` argument via `mockClient.createWorkItem.mock.calls[0][1]`; assert `op:'add'`, correct `path` and `value` entries |
| `createWorkItem` — success | Stub returns new `WorkItem`; assert round-trip |
| `updateWorkItem` — document shape | Verify patch document constructed correctly from `fields` record |
| `updateWorkItem` — success | Stub returns updated `WorkItem` |
| `queryByWiql` — teamContext | Assert `teamContext` is `{ project }` when project provided; `undefined` when omitted |
| `queryByWiql` — success | Stub returns `WorkItemQueryResult`; assert returned as-is |
| `getComments` — success | Stub returns `CommentList`; assert returned |
| `addComment` — success | Stub returns `Comment`; assert `request` arg is `{ text }` |
| `getClient` error | `getWorkItemTrackingApi` rejects; assert `AdoWorkItemError` with descriptive message |

## Acceptance Criteria

- [ ] `AdoWorkItemsService` class is exported from `packages/pipeline-core/src/ado/index.ts`.
- [ ] `AdoWorkItemError` class is exported from `packages/pipeline-core/src/ado/index.ts`.
- [ ] `FieldPatch` interface is exported.
- [ ] `getWorkItem(id, project?, fields?, expand?)` fetches a single work item via `IWorkItemTrackingApi.getWorkItem`.
- [ ] `getWorkItems(ids, project?, fields?, expand?)` fetches multiple items; throws `AdoWorkItemError` if `ids.length > 200`.
- [ ] `createWorkItem(project, type, fields)` builds a `JsonPatchDocument` using `op:'add'` and calls `IWorkItemTrackingApi.createWorkItem({}, document, project, type)`.
- [ ] `updateWorkItem(id, fields, project?)` builds a `JsonPatchDocument` using `op:'add'` and calls `IWorkItemTrackingApi.updateWorkItem({}, document, id, project)`.
- [ ] `queryByWiql(query, project?, top?)` calls `IWorkItemTrackingApi.queryByWiql({ query }, teamContext, undefined, top)` where `teamContext` is `{ project }` if `project` is provided, else `undefined`.
- [ ] `getComments(project, workItemId)` delegates to `IWorkItemTrackingApi.getComments`.
- [ ] `addComment(project, workItemId, text)` calls `IWorkItemTrackingApi.addComment({ text }, project, workItemId)`.
- [ ] All errors from the underlying API client are caught and re-thrown as `AdoWorkItemError` with the original error as `cause`.
- [ ] All test cases listed above pass (`npm run test:run` in `packages/pipeline-core`).
- [ ] `npm run build` passes with no new TypeScript errors.
- [ ] No VS Code or CoC CLI wiring; this commit is library-only.

## Dependencies

- **Commit 001 (already applied):** `packages/pipeline-core/src/ado/types.ts`, `connection.ts`, `index.ts` must exist.
- **npm package:** `azure-devops-node-api` must be present in `packages/pipeline-core/package.json` (added in commit 001).

## Assumed Prior State

- `packages/pipeline-core/src/ado/index.ts` exists and currently re-exports from `./types` and `./connection`.
- `packages/pipeline-core/src/ado/types.ts` exports `AdoConfig` and `AdoConnectionError`.
- `packages/pipeline-core/src/ado/connection.ts` exports `createAdoConnection(config?: AdoConfig): WebApi` and `getAdoConfig(): AdoConfig`.
- `azure-devops-node-api` is resolvable from `packages/pipeline-core/`.
- Vitest is already configured in `packages/pipeline-core/` (existing test files follow `describe/it/expect` pattern).
