---
status: pending
---

# 001: ADO Foundation — Connection Factory & Shared Types

## Summary
Adds `azure-devops-node-api` as a runtime dependency to `packages/pipeline-core` and creates the `packages/pipeline-core/src/ado/` module with shared types, a PAT-based connection factory that reads credentials from environment variables, and public index exports wired into the top-level `src/index.ts`.

## Motivation
All subsequent ADO commits depend on a stable, typed entry point into the Azure DevOps Node API. Isolating dependency installation and the env-var auth layer in a single commit keeps every later commit reviewable on its own merits and makes it easy to swap or extend the auth strategy without touching ADO feature code.

## Changes

### Files to Create

- `packages/pipeline-core/src/ado/types.ts` — Shared ADO domain types:
  - `AdoConnectionConfig` — holds `orgUrl: string` and `token: string` (populated from env vars by the factory; kept separate so callers can override in tests)
  - `AdoConnectionResult` — discriminated union `{ connected: true; connection: WebApi } | { connected: false; error: string }` (mirrors the `SDKAvailabilityResult` pattern from `copilot-sdk-service.ts`)
  - `AdoClientOptions` — optional overrides for `orgUrl` and `token` (lets callers skip env-var lookup; useful for tests)

- `packages/pipeline-core/src/ado/ado-connection-factory.ts` — PAT-based connection factory:
  - Module-level singleton `let _instance: AdoConnectionFactory | null = null`
  - `AdoConnectionFactory` class with a private constructor (matches `CopilotSDKService` singleton shape)
  - `static getInstance(): AdoConnectionFactory` — creates instance on first call
  - `static resetInstance(): void` — nulls the singleton (for tests; mirrors `CopilotSDKService.resetInstance()`)
  - `async connect(options?: AdoClientOptions): Promise<AdoConnectionResult>` — reads `AZURE_DEVOPS_TOKEN` and `AZURE_DEVOPS_ORG_URL` from `process.env`, merges with any caller-supplied `options`, constructs a `azdev.WebApi` via `azdev.getPersonalAccessTokenHandler(token)`, returns `AdoConnectionResult`
  - Logs via `getLogger()` / `LogCategory` (same pattern as git and copilot-sdk modules)
  - Does **not** cache the connection — each `connect()` call creates a fresh `WebApi` (connection objects are cheap; caching would complicate testing)

- `packages/pipeline-core/src/ado/index.ts` — Public barrel for the `ado/` module:
  ```ts
  export { AdoConnectionConfig, AdoConnectionResult, AdoClientOptions } from './types';
  export { AdoConnectionFactory, getAdoConnectionFactory, resetAdoConnectionFactory } from './ado-connection-factory';
  ```
  `getAdoConnectionFactory()` and `resetAdoConnectionFactory()` are thin module-level wrappers around the static methods (mirrors `getCopilotSDKService` / `resetCopilotSDKService` free-function pattern).

### Files to Modify

- `packages/pipeline-core/package.json` — Add `"azure-devops-node-api": "^14.x"` to `dependencies`. Run `npm install` in `packages/pipeline-core/` to update `package-lock.json`. No changes to `devDependencies` or scripts needed.

- `packages/pipeline-core/src/index.ts` — Append a new section at the bottom (after `// Skills`):
  ```ts
  // ============================================================================
  // ADO (Azure DevOps)
  // ============================================================================

  export {
      AdoConnectionConfig,
      AdoConnectionResult,
      AdoClientOptions,
      AdoConnectionFactory,
      getAdoConnectionFactory,
      resetAdoConnectionFactory,
  } from './ado';
  ```

### Files to Delete
None.

## Implementation Notes

**Singleton wrappers** — Follow the exact free-function accessor pattern visible in the AI section of `src/index.ts`:
```ts
// ado-connection-factory.ts (bottom of file)
export function getAdoConnectionFactory(): AdoConnectionFactory {
    return AdoConnectionFactory.getInstance();
}
export function resetAdoConnectionFactory(): void {
    AdoConnectionFactory.resetInstance();
}
```

**`azure-devops-node-api` import style** — The library is CommonJS. Import as:
```ts
import * as azdev from 'azure-devops-node-api';
```
`azdev.getPersonalAccessTokenHandler(token)` returns an `IRequestHandler`; pass it to `new azdev.WebApi(orgUrl, authHandler)`.

**Env var names** — Exactly `AZURE_DEVOPS_TOKEN` and `AZURE_DEVOPS_ORG_URL`. No fallbacks (e.g. `ADO_TOKEN`). If either is missing, `connect()` returns `{ connected: false, error: 'AZURE_DEVOPS_TOKEN is not set' }` (or the URL variant) rather than throwing, consistent with how `CopilotSDKService.isAvailable()` handles missing SDK paths.

**`AdoConnectionResult` discriminated union** — The `connected` discriminant enables callers to narrow the type without casting:
```ts
const result = await factory.connect();
if (!result.connected) { logger.warn(..., result.error); return; }
const wit = await result.connection.getWorkItemTrackingApi();
```

**No CLI wiring** — `packages/coc/` is intentionally not touched in this commit. The `ado/` module is internal infrastructure only.

**TypeScript types** — `azure-devops-node-api` ships its own `.d.ts` files; no `@types/` package is needed.

## Tests

Place tests in `packages/pipeline-core/src/ado/__tests__/ado-connection-factory.test.ts` (Vitest, matching the pattern used by other `__tests__/` folders in pipeline-core):

- **Missing `AZURE_DEVOPS_TOKEN`** — delete env var, call `factory.connect()`, assert `result.connected === false` and `result.error` contains `'AZURE_DEVOPS_TOKEN'`.
- **Missing `AZURE_DEVOPS_ORG_URL`** — set token but delete URL env var, assert analogous error.
- **Successful connect (mocked)** — `vi.mock('azure-devops-node-api', ...)` to stub `WebApi` constructor and `getPersonalAccessTokenHandler`. Set both env vars, call `connect()`, assert `result.connected === true` and `result.connection` is the stub instance.
- **Caller-supplied options override env vars** — pass `{ orgUrl: 'https://custom', token: 'custom-pat' }`, assert `WebApi` is constructed with those values even when env vars differ.
- **`resetAdoConnectionFactory` isolates tests** — call `resetAdoConnectionFactory()` in `afterEach`; verify `getAdoConnectionFactory()` returns a fresh instance each time.

## Acceptance Criteria

- [ ] `azure-devops-node-api` appears in `packages/pipeline-core/package.json` `dependencies` and in `node_modules` after `npm install`
- [ ] `packages/pipeline-core/src/ado/types.ts` exports `AdoConnectionConfig`, `AdoConnectionResult`, `AdoClientOptions`
- [ ] `packages/pipeline-core/src/ado/ado-connection-factory.ts` exports `AdoConnectionFactory`, `getAdoConnectionFactory`, `resetAdoConnectionFactory`
- [ ] `packages/pipeline-core/src/ado/index.ts` re-exports all three symbols from `types.ts` and all three from `ado-connection-factory.ts`
- [ ] `packages/pipeline-core/src/index.ts` has an `// ADO (Azure DevOps)` section that re-exports all six symbols
- [ ] `connect()` returns `{ connected: false, error: ... }` (not throws) when env vars are absent
- [ ] `connect()` calls `azdev.getPersonalAccessTokenHandler` with the resolved token and passes the result to `new azdev.WebApi`
- [ ] All new Vitest tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] `npm run build` succeeds with no new TypeScript errors
- [ ] No `packages/coc/` files are modified

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit. The only prerequisite is that `packages/pipeline-core/` exists as a buildable TypeScript package with `getLogger` / `LogCategory` exported from `./logger`, which is already true at HEAD.
