---
status: done
---

# 002: Add `refinePipeline()` to the Pipeline API Client

## Summary
Add a typed `refinePipeline()` function and `RefineResult` interface to
`packages/coc/src/server/spa/client/react/repos/pipeline-api.ts` so the SPA
can call the `POST /api/workspaces/:id/pipelines/:name/refine` endpoint
introduced in commit 1.  
Also fix the pre-existing type mismatch in `GenerateResult`: the server
returns `validationError?: string` (singular), but the client interface
currently declares `errors?: string[]` (array).

## Motivation
Commit 1 created the server-side refine endpoint, but nothing in the client
can call it yet. Without this typed wrapper the "Edit with AI" UI (commits 3–4)
would have to inline raw `fetch` calls and would lack type safety.  
The `GenerateResult`/`validationError` mismatch is a latent bug: the generate
endpoint also returns `validationError?: string` from the server, so the
`errors?: string[]` field is never populated in practice. Fixing it here keeps
the two result types consistent and avoids confusion when the UI layer is built.

## Changes

### Files to Create
_None._

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/pipeline-api.ts`

1. **Fix `GenerateResult`** — replace `errors?: string[]` with
   `validationError?: string` to match the actual server response shape:

   ```ts
   // Before
   export interface GenerateResult {
       yaml: string;
       valid: boolean;
       errors?: string[];
       suggestedName?: string;
   }

   // After
   export interface GenerateResult {
       yaml: string;
       valid: boolean;
       validationError?: string;
       suggestedName?: string;
   }
   ```

2. **Add `RefineResult` interface** immediately after `GenerateResult`:

   ```ts
   export interface RefineResult {
       yaml: string;
       valid: boolean;
       validationError?: string;
       suggestedName?: string;
   }
   ```

3. **Add `pipelineRefineUrl` private helper** (alongside the existing URL
   helpers at the top of the file):

   ```ts
   function pipelineRefineUrl(workspaceId: string, name: string): string {
       return `${pipelineUrl(workspaceId, name)}/refine`;
   }
   ```

4. **Add `refinePipeline()` export** after `generatePipeline`:

   ```ts
   export async function refinePipeline(
       workspaceId: string,
       pipelineName: string,
       instruction: string,
       currentYaml: string,
       model?: string,
       signal?: AbortSignal
   ): Promise<RefineResult> {
       const body: Record<string, string> = { instruction, currentYaml };
       if (model !== undefined) {
           body.model = model;
       }
       const res = await fetch(pipelineRefineUrl(workspaceId, pipelineName), {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(body),
           signal,
       });
       if (!res.ok) {
           const errBody = await res.json().catch(() => ({}));
           throw new Error(errBody.error || `API error: ${res.status} ${res.statusText}`);
       }
       return res.json();
   }
   ```

   Note the URL is `pipelineRefineUrl(workspaceId, pipelineName)` which
   expands to `.../workspaces/:id/pipelines/:name/refine` — the pipeline name
   is a path segment, not a query parameter.

### Files to Delete
_None._

## Implementation Notes

- `RefineResult` is intentionally a separate interface from `GenerateResult`
  even though the shapes are identical today. They represent different server
  contracts and may diverge (e.g. the refine endpoint may gain a `diff` field).
- The `pipelineRefineUrl` helper follows the same pattern as `pipelineContentUrl`
  — it is private (not exported) and composed from `pipelineUrl`.
- The variable shadowing issue in `generatePipeline` (outer `body` parameter
  name reused as `const body` in the error path) already exists in the file;
  do not change it in this commit to keep the diff minimal.
- The `signal?: AbortSignal` parameter is included for consistency with
  `generatePipeline` so callers can cancel in-flight refine requests.

## Tests

No new test file is required for this commit; the API client is a thin `fetch`
wrapper. Existing Vitest tests for the pipelines handler (server side) cover
the endpoint contract. If a `pipeline-api.test.ts` exists, add a test that:

- Mocks `fetch` to return `{ yaml: '...', valid: true, suggestedName: 'foo' }`.
- Calls `refinePipeline('ws1', 'my-pipeline', 'add logging step', '...')`.
- Asserts the request was made to
  `.../workspaces/ws1/pipelines/my-pipeline/refine` with method `POST` and
  body `{ instruction: 'add logging step', currentYaml: '...' }`.
- Asserts the resolved value matches the mock response.

Also verify that any existing test referencing `GenerateResult.errors` is
updated to use `validationError`.

## Acceptance Criteria

- [ ] `GenerateResult` no longer has an `errors?: string[]` field; it has
      `validationError?: string` instead.
- [ ] `RefineResult` interface is exported from `pipeline-api.ts` with fields
      `yaml: string`, `valid: boolean`, `validationError?: string`,
      `suggestedName?: string`.
- [ ] `refinePipeline(workspaceId, pipelineName, instruction, currentYaml,
      model?, signal?)` is exported and returns `Promise<RefineResult>`.
- [ ] The fetch URL resolves to
      `<apiBase>/workspaces/<workspaceId>/pipelines/<pipelineName>/refine`.
- [ ] TypeScript compilation (`npm run build`) passes with no new errors.
- [ ] No existing callers of `generatePipeline` reference the now-removed
      `errors` field (verify with `grep -r '\.errors' src/` scoped to
      pipeline-related files).

## Dependencies

- **Commit 1** must be applied: the `POST /api/workspaces/:id/pipelines/:name/refine`
  endpoint must exist in `packages/coc/src/server/pipelines-handler.ts` before
  this client wrapper is meaningful.

## Assumed Prior State

- `pipeline-api.ts` exports `generatePipeline`, `createPipeline`,
  `deletePipeline`, `savePipelineContent`, `fetchPipelines`,
  `fetchPipelineContent`, `runPipeline`, and the `GenerateResult` interface,
  with the `errors?: string[]` mismatch present.
- URL helpers `pipelinesUrl`, `pipelineUrl`, `pipelineContentUrl` are defined
  as unexported functions at the top of the file.
- No `refinePipeline` function or `RefineResult` type exists yet.
