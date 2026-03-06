# Fix: Edit with AI — API Route Not Found

## Problem

When a user opens a workflow in the CoC dashboard and clicks **Edit with AI → Refine with AI**, the panel shows:

```
API route not found: /api/workspaces/ws-5i8wyn/pipelines/replicate-commit-change/refine
```

The "Refine with AI" button is non-functional for all workflows.

## Root Cause

URL mismatch between frontend and backend:

| Side | URL pattern |
|------|-------------|
| **Frontend** (`pipelineRefineUrl`) | `/api/workspaces/{ws-id}/pipelines/{name}/refine` |
| **Backend** route regex | `/api/workspaces/{ws-id}/pipelines/refine` (no `{name}`) |

`pipelineRefineUrl()` in `pipeline-api.ts` is built as:
```ts
function pipelineRefineUrl(workspaceId: string, name: string): string {
    return `${pipelineUrl(workspaceId, name)}/refine`;
    //       ^^^^ includes /pipelines/{name} — wrong!
}
```

It should use the base `pipelinesUrl` (plural, no name segment):
```ts
return `${pipelinesUrl(workspaceId)}/refine`;
```

The `/refine` backend handler takes `currentYaml` + `instruction` in the **request body** — the pipeline name is not needed in the URL path.

## Key Files

- **Frontend URL builder:** `packages/coc-server/src/.../pipeline-api.ts` (or `packages/coc/src/server/spa/client/react/repos/pipeline-api.ts`)
- **Backend route handler:** `packages/coc/src/server/pipelines-handler.ts` — regex `POST /api/workspaces/:id/pipelines/refine`

## Approach

1. Fix `pipelineRefineUrl()` to use `pipelinesUrl(workspaceId)` as the base (drop the name segment).
2. If the backend refine handler needs the pipeline name for saving or logging, add it to the POST body — do **not** change the URL.
3. Build and smoke-test the dashboard manually.

## Tasks

1. **Confirm root cause** — locate exact `pipelineRefineUrl` definition and backend route regex ✅
2. **Fix `pipelineRefineUrl`** — change to `pipelinesUrl(workspaceId) + '/refine'` ✅
3. **Check if pipeline name is needed server-side** — if yes, pass via request body ✅ (not needed)
4. **End-to-end test** — `coc serve`, open workflow, Edit with AI, confirm success ✅

## Out of Scope

- Changing the backend URL structure (backend route is correct as-is)
- Adding per-pipeline refine history
