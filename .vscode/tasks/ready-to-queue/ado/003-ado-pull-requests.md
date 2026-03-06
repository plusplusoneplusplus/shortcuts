---
status: pending
---

# 003: ADO Pull Requests Service

## Summary

Create `packages/pipeline-core/src/ado/pull-requests-service.ts` — a class-based service wrapping `IGitApi` from `azure-devops-node-api` that exposes high-level async methods for listing, creating, updating, and reviewing Azure DevOps pull requests. Export from the existing `packages/pipeline-core/src/ado/index.ts`.

## Motivation

Commits 001 and 002 established the ADO connection infrastructure (`createAdoConnection`, `getAdoConfig`) and a work-items service pattern. Pull requests are the other core ADO resource that downstream pipeline steps and CLI commands will need to query and manipulate. Providing a dedicated, well-typed service keeps `IGitApi` complexity out of call sites and makes the behaviour easily testable via a mocked `IGitApi`.

## Changes

### Files to Create

#### `packages/pipeline-core/src/ado/pull-requests-service.ts`

Full class definition with the following public surface:

```ts
import { WebApi } from 'azure-devops-node-api';
import { IGitApi } from 'azure-devops-node-api/GitApi';
import {
  GitPullRequest,
  GitPullRequestSearchCriteria,
  GitPullRequestCommentThread,
  PullRequestStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { IdentityRef, IdentityRefWithVote } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';

export { GitPullRequest, GitPullRequestSearchCriteria, GitPullRequestCommentThread, PullRequestStatus };
export { IdentityRef, IdentityRefWithVote };

export class PullRequestsService {
  private gitApi: IGitApi | null = null;

  constructor(private readonly connection: WebApi) {}

  // --- lifecycle ---
  private async getGitApi(): Promise<IGitApi>;

  // --- query ---
  async listPullRequests(
    repositoryId: string,
    searchCriteria: GitPullRequestSearchCriteria,
    project?: string,
    top?: number,
    skip?: number,
  ): Promise<GitPullRequest[]>;

  async getPullRequestById(
    pullRequestId: number,
    project?: string,
  ): Promise<GitPullRequest>;

  // --- mutations ---
  async createPullRequest(
    repositoryId: string,
    pr: Pick<GitPullRequest, 'title' | 'description' | 'sourceRefName' | 'targetRefName'> & { reviewers?: IdentityRef[] },
    project?: string,
  ): Promise<GitPullRequest>;

  async updatePullRequest(
    repositoryId: string,
    pullRequestId: number,
    update: Partial<Pick<GitPullRequest, 'title' | 'description' | 'status' | 'autoCompleteSetBy' | 'completionOptions' | 'mergeStrategy'>>,
    project?: string,
  ): Promise<GitPullRequest>;

  // --- review threads ---
  async createThread(
    repositoryId: string,
    pullRequestId: number,
    thread: GitPullRequestCommentThread,
    project?: string,
  ): Promise<GitPullRequestCommentThread>;

  async getThreads(
    repositoryId: string,
    pullRequestId: number,
    project?: string,
  ): Promise<GitPullRequestCommentThread[]>;

  // --- reviewers ---
  async addReviewers(
    repositoryId: string,
    pullRequestId: number,
    reviewers: IdentityRef[],
    project?: string,
  ): Promise<IdentityRefWithVote[]>;

  async getReviewers(
    repositoryId: string,
    pullRequestId: number,
    project?: string,
  ): Promise<IdentityRefWithVote[]>;
}
```

**`getGitApi()` implementation details:**
- Lazily initialises `this.gitApi` via `await this.connection.getGitApi()`.
- Caches the result so subsequent calls reuse the same `IGitApi` instance.
- Throws `AdoConnectionError` (imported from `./types`) if `getGitApi()` rejects.

**`listPullRequests()` implementation details:**
- Delegates to `gitApi.getPullRequests(repositoryId, searchCriteria, project, undefined, skip, top)`.
- `project` defaults to `undefined` (ADO resolves by repo ID alone when omitted).
- Returns an empty array if the API returns `null` or `undefined`.

**`getPullRequestById()` implementation details:**
- Delegates to `gitApi.getPullRequestById(pullRequestId, project)`.
- Throws a typed `Error` (`AdoPullRequestNotFoundError`) when the result is nullish.

**`createPullRequest()` implementation details:**
- Assembles a `GitPullRequest` payload from the caller-supplied partial shape.
- Delegates to `gitApi.createPullRequest(payload, repositoryId, project)`.

**`updatePullRequest()` implementation details:**
- Accepts only the safe-to-patch subset of `GitPullRequest` fields (avoids overwriting server-managed fields).
- Delegates to `gitApi.updatePullRequest(update, repositoryId, pullRequestId, project)`.

**Error type to export from this file:**

```ts
export class AdoPullRequestNotFoundError extends Error {
  constructor(pullRequestId: number) {
    super(`ADO pull request #${pullRequestId} not found`);
    this.name = 'AdoPullRequestNotFoundError';
  }
}
```

#### Test file: `packages/pipeline-core/src/ado/pull-requests-service.test.ts`

See **Tests** section below.

### Files to Modify

#### `packages/pipeline-core/src/ado/index.ts`

Add re-exports for everything public from `pull-requests-service.ts`:

```ts
export {
  PullRequestsService,
  AdoPullRequestNotFoundError,
  // re-exported azure-devops-node-api types
  GitPullRequest,
  GitPullRequestSearchCriteria,
  GitPullRequestCommentThread,
  PullRequestStatus,
  IdentityRef,
  IdentityRefWithVote,
} from './pull-requests-service';
```

No other files need modification. No CLI wiring in this commit.

## Implementation Notes

- **Pattern consistency with `WorkItemsService`:** Follow the same constructor signature (`constructor(private readonly connection: WebApi)`) and lazy `getApi()` initialisation pattern established in commit 002.
- **Lazy `IGitApi` init:** `connection.getGitApi()` is async; cache the resolved instance to avoid repeated round-trips. Use a private `gitApi: IGitApi | null = null` field and a private `getGitApi()` helper.
- **`PullRequestStatus` enum values:** When callers want to filter by status they should use the numeric enum from `GitInterfaces`: `PullRequestStatus.Active = 1`, `PullRequestStatus.Abandoned = 2`, `PullRequestStatus.Completed = 3`. Re-export the enum so callers don't need to import from `azure-devops-node-api` directly.
- **`sourceRefName` / `targetRefName` format:** Must be full ref paths (`refs/heads/<branch>`). Document this in JSDoc on `createPullRequest`.
- **`project` parameter:** Always optional; when `undefined` the ADO REST API resolves context from the repository. This matches how `workitems-service.ts` handles the project parameter.
- **Null-safety:** `azure-devops-node-api` methods can return `undefined` in some configurations. Guard with `?? []` for list responses and throw `AdoPullRequestNotFoundError` for single-entity lookups.
- **No top-level `await`:** The file is a plain class module; no module-level side effects.
- **Imports:** Import interface types from `azure-devops-node-api/interfaces/GitInterfaces` and `azure-devops-node-api/interfaces/common/VSSInterfaces` (same pattern used internally by `azure-devops-node-api` itself).

## Tests

File: `packages/pipeline-core/src/ado/pull-requests-service.test.ts`

Use Vitest. Mock `IGitApi` as a plain object with `vi.fn()` stubs. Construct `PullRequestsService` with a mock `WebApi` whose `getGitApi()` resolves to the stub.

### Test cases

| # | Description | Key assertion |
|---|-------------|---------------|
| 1 | `listPullRequests` — happy path | delegates to `gitApi.getPullRequests` with correct args; returns array |
| 2 | `listPullRequests` — API returns `undefined` | returns `[]` |
| 3 | `listPullRequests` — respects `top` and `skip` | passes `top`/`skip` positionally to `getPullRequests` |
| 4 | `getPullRequestById` — happy path | returns `GitPullRequest` from `gitApi.getPullRequestById` |
| 5 | `getPullRequestById` — API returns `undefined` | throws `AdoPullRequestNotFoundError` |
| 6 | `createPullRequest` — happy path | assembles payload; delegates to `gitApi.createPullRequest`; returns result |
| 7 | `updatePullRequest` — happy path | delegates to `gitApi.updatePullRequest` with correct `pullRequestId` |
| 8 | `createThread` — happy path | delegates to `gitApi.createThread`; returns created thread |
| 9 | `getThreads` — happy path | delegates to `gitApi.getThreads`; returns array |
| 10 | `addReviewers` — happy path | delegates to `gitApi.createPullRequestReviewers`; returns `IdentityRefWithVote[]` |
| 11 | `getReviewers` — happy path | delegates to `gitApi.getPullRequestReviewers`; returns array |
| 12 | `getGitApi()` lazy caching | `connection.getGitApi` called exactly once across two method calls |
| 13 | `getGitApi()` failure | wraps rejection with `AdoConnectionError` |

### Example test skeleton

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PullRequestsService, AdoPullRequestNotFoundError } from './pull-requests-service';
import { WebApi } from 'azure-devops-node-api';

function makeMockGitApi(overrides: Record<string, unknown> = {}) {
  return {
    getPullRequests: vi.fn().mockResolvedValue([]),
    getPullRequestById: vi.fn().mockResolvedValue({ pullRequestId: 1 }),
    createPullRequest: vi.fn().mockResolvedValue({ pullRequestId: 2 }),
    updatePullRequest: vi.fn().mockResolvedValue({ pullRequestId: 1 }),
    createThread: vi.fn().mockResolvedValue({ id: 10 }),
    getThreads: vi.fn().mockResolvedValue([]),
    createPullRequestReviewers: vi.fn().mockResolvedValue([]),
    getPullRequestReviewers: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockConnection(gitApi: unknown) {
  return { getGitApi: vi.fn().mockResolvedValue(gitApi) } as unknown as WebApi;
}

describe('PullRequestsService', () => {
  let gitApi: ReturnType<typeof makeMockGitApi>;
  let service: PullRequestsService;

  beforeEach(() => {
    gitApi = makeMockGitApi();
    service = new PullRequestsService(makeMockConnection(gitApi));
  });

  it('listPullRequests returns empty array when API returns undefined', async () => {
    gitApi.getPullRequests.mockResolvedValue(undefined);
    const result = await service.listPullRequests('repo-id', {});
    expect(result).toEqual([]);
  });

  it('getPullRequestById throws AdoPullRequestNotFoundError when not found', async () => {
    gitApi.getPullRequestById.mockResolvedValue(undefined);
    await expect(service.getPullRequestById(99)).rejects.toThrow(AdoPullRequestNotFoundError);
  });

  // ... remaining cases
});
```

## Acceptance Criteria

- [ ] `PullRequestsService` class is exported from `packages/pipeline-core/src/ado/index.ts`
- [ ] `AdoPullRequestNotFoundError` is exported from `packages/pipeline-core/src/ado/index.ts`
- [ ] `GitPullRequest`, `GitPullRequestSearchCriteria`, `GitPullRequestCommentThread`, `PullRequestStatus`, `IdentityRef`, `IdentityRefWithVote` are re-exported from `packages/pipeline-core/src/ado/index.ts`
- [ ] All 8 public methods (`listPullRequests`, `getPullRequestById`, `createPullRequest`, `updatePullRequest`, `createThread`, `getThreads`, `addReviewers`, `getReviewers`) are implemented and delegate to the correct `IGitApi` method
- [ ] `IGitApi` instance is cached after first call; `connection.getGitApi()` is never called more than once per service instance
- [ ] `listPullRequests` returns `[]` when ADO API returns `null`/`undefined`
- [ ] `getPullRequestById` throws `AdoPullRequestNotFoundError` when ADO API returns `null`/`undefined`
- [ ] `getGitApi()` failure wraps the error as `AdoConnectionError`
- [ ] All 13 test cases pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] No new TypeScript errors (`npm run build` passes)
- [ ] No CLI wiring introduced in this commit

## Dependencies

- **Commit 001** — `packages/pipeline-core/src/ado/types.ts` (`AdoConfig`, `AdoConnectionError`) and `packages/pipeline-core/src/ado/connection.ts` must already exist
- **Commit 002** — `packages/pipeline-core/src/ado/workitems-service.ts` must already exist (establishes the class/constructor pattern this commit follows)
- **Commit 001** — `packages/pipeline-core/src/ado/index.ts` must already exist (this commit appends to it)
- `azure-devops-node-api` must already be listed as a dependency in `packages/pipeline-core/package.json` (added in commit 001)

## Assumed Prior State

When this commit is applied the following already exist and must not be modified beyond adding exports:

| Path | Exported symbols |
|------|-----------------|
| `packages/pipeline-core/src/ado/types.ts` | `AdoConfig`, `AdoConnectionError` |
| `packages/pipeline-core/src/ado/connection.ts` | `createAdoConnection(config?: AdoConfig): WebApi`, `getAdoConfig(): AdoConfig` |
| `packages/pipeline-core/src/ado/workitems-service.ts` | `WorkItemsService`, `AdoWorkItem`, `AdoWorkItemQueryResult`, `WorkItemFieldPatch` |
| `packages/pipeline-core/src/ado/index.ts` | re-exports of all the above |
| `packages/pipeline-core/package.json` | `azure-devops-node-api` in `dependencies` |
