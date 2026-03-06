---
status: pending
---

# 003: Backend — Apply Per-Repo MCP Filter on Pipeline Execution

## Summary

When a pipeline run is triggered for a workspace, read the workspace's `enabledMcpServers` list, filter the global MCP config down to only those named servers, and pass the filtered map as `mcpServers` + `loadDefaultMcpConfig: false` into `createCLIAIInvoker` (and ultimately `SendMessageOptions`) so that only workspace-approved MCP servers are active during pipeline execution.

## Motivation

Commits 001 and 002 introduced the data model and persistence layer for per-repo MCP filtering (`WorkspaceInfo.enabledMcpServers`, `GET/PUT /api/workspaces/:id/mcp-config` endpoints). Without this commit the stored filter has no effect — every pipeline run still loads the full global `~/.copilot/mcp-config.json`. This commit closes that gap by wiring the filter into the pipeline execution path.

## Changes

### Files to Create

None.

### Files to Modify

1. **`packages/coc-server/src/task-types.ts`** — `RunPipelinePayload` interface (line 94–101)
   - Add `mcpServers?: Record<string, MCPServerConfig>` field (already present per commit 001; verify it's there; if not, add it after `workspaceId?`).
   - Import `MCPServerConfig` from `@plusplusoneplusplus/pipeline-core` if not already imported.

2. **`packages/coc/src/server/pipelines-handler.ts`** — run-pipeline route handler (lines 670–732)
   - After resolving the workspace (`ws`) at line 678, read `ws.enabledMcpServers`.
   - If `enabledMcpServers` is a non-null array, call `loadDefaultMcpConfig()` from `@plusplusoneplusplus/pipeline-core`, filter its `mcpServers` result to the keys in `enabledMcpServers`, and store as `filteredMcpServers`.
   - Inject `mcpServers: filteredMcpServers` into the `RunPipelinePayload` at lines 709–716. Leave `mcpServers` undefined when `enabledMcpServers === null` (opt-out, global config loads normally).
   - Add required imports: `loadDefaultMcpConfig` from `@plusplusoneplusplus/pipeline-core`.

   Exact injection point — replace lines 709–716:
   ```ts
   // Resolve MCP filter
   let resolvedMcpServers: Record<string, MCPServerConfig> | undefined;
   if (Array.isArray(ws.enabledMcpServers)) {
       const defaultMcp = loadDefaultMcpConfig();
       const allServers = defaultMcp.mcpServers;
       resolvedMcpServers = Object.fromEntries(
           ws.enabledMcpServers
               .filter(key => key in allServers)
               .map(key => [key, allServers[key]])
       );
   }

   const payload: RunPipelinePayload = {
       kind: 'run-pipeline',
       pipelinePath: resolvedDir,
       workingDirectory: ws.rootPath,
       model: body?.model,
       params: body?.params,
       workspaceId: id,
       mcpServers: resolvedMcpServers,          // undefined when null (global config)
   };
   ```

3. **`packages/coc/src/ai-invoker.ts`** — `CLIAIInvokerOptions` (lines 32–47) and `createCLIAIInvoker` (lines 86–128)
   - `CLIAIInvokerOptions` already has `loadMcpConfig?: boolean` (line 42); per commit 001 it should also have `mcpServers?: Record<string, MCPServerConfig>`. If not present, add it.
   - In `createCLIAIInvoker` at the `SendMessageOptions` block (lines 100–109), add the two new fields:
     ```ts
     const sendOptions: SendMessageOptions = {
         prompt,
         model,
         workingDirectory: options.workingDirectory,
         timeoutMs,
         onPermissionRequest: permissionHandler,
         loadDefaultMcpConfig: options.mcpServers !== undefined
             ? false                              // explicit server list → skip global load
             : options.loadMcpConfig !== false,   // existing behaviour preserved
         mcpServers: options.mcpServers,
         onStreamingChunk: options.onChunk,
         tools: options.tools,
     };
     ```
   - Import `MCPServerConfig` from `@plusplusoneplusplus/pipeline-core` if not already imported.

4. **`packages/coc/src/server/queue-executor-bridge.ts`** — `executeRunPipeline` (lines 936–975)
   - At the `createCLIAIInvoker` call (lines 971–975), forward `payload.mcpServers`:
     ```ts
     const aiInvoker = createCLIAIInvoker({
         model: payload.model || config.job?.model || config.map?.model,
         approvePermissions: this.approvePermissions,
         workingDirectory: payload.workingDirectory,
         mcpServers: payload.mcpServers,          // <-- add this
     });
     ```
   - No additional imports needed (`RunPipelinePayload` is already imported from `@plusplusoneplusplus/coc-server` at line 20).

5. **`packages/pipeline-core/src/process-store.ts`** — `WorkspaceInfo` interface (lines 57–68)
   - Per commit 001 this should already have `enabledMcpServers?: string[] | null`. Verify; add if missing.

### Files to Delete

None.

## Implementation Notes

### Null vs. undefined semantics

| `enabledMcpServers` value | Meaning | Behaviour in this commit |
|---|---|---|
| `null` | User has not configured a filter (opt-out) | `resolvedMcpServers = undefined` → `loadDefaultMcpConfig: true` (global config loads as normal) |
| `[]` | Explicitly disabled all MCP servers | `resolvedMcpServers = {}` → `loadDefaultMcpConfig: false` (no servers active) |
| `["serverA"]` | Only `serverA` allowed | `resolvedMcpServers = { serverA: ... }` → `loadDefaultMcpConfig: false` |

This is consistent with `mergeMcpConfigs()` in `mcp-config-loader.ts` (line 188–191): an empty explicit map `{}` disables all servers.

### `loadDefaultMcpConfig: false` rationale

`CopilotSDKService.sendMessage` (pipeline-core) already calls `mergeMcpConfigs(defaultConfig, options.mcpServers)` when `loadDefaultMcpConfig` is true. By setting `loadDefaultMcpConfig: false` and passing the pre-filtered map as `mcpServers`, we short-circuit the merge and guarantee only the workspace-approved servers are used — no leakage from the global file.

### `loadDefaultMcpConfig()` called server-side (handler, not executor)

Filtering happens at enqueue time in `pipelines-handler.ts` rather than in `queue-executor-bridge.ts`. This is intentional: the handler already has the `WorkspaceInfo` object, and keeping it there avoids adding store lookups to the executor. The serialised `mcpServers` map travels in `RunPipelinePayload` through the queue.

### No deep-wiki / other callers affected

Only the `run-pipeline` execution path is changed. Other `createCLIAIInvoker` call sites (e.g., `coc run` CLI command) do not receive `mcpServers` in their options, so `loadDefaultMcpConfig` defaults back to `options.loadMcpConfig !== false` (true) — existing behaviour is preserved.

## Tests

1. **`packages/coc/test/server/pipelines-handler.test.ts`** (new or existing)
   - When `ws.enabledMcpServers === null` → `payload.mcpServers` is `undefined`.
   - When `ws.enabledMcpServers === []` → `payload.mcpServers` is `{}`.
   - When `ws.enabledMcpServers === ['serverA']` and global config has `{serverA:{...}, serverB:{...}}` → `payload.mcpServers` is `{serverA:{...}}` only.
   - When `ws.enabledMcpServers === ['serverX']` and `serverX` is absent from global config → `payload.mcpServers` is `{}`.

2. **`packages/coc/test/server/queue-executor-bridge.test.ts`** (new or existing)
   - When `payload.mcpServers` is defined, `createCLIAIInvoker` is called with matching `mcpServers`.
   - When `payload.mcpServers` is `undefined`, `createCLIAIInvoker` is called without `mcpServers`.

3. **`packages/coc/test/ai-invoker.test.ts`** (new or existing)
   - When `options.mcpServers` is defined, `SendMessageOptions.loadDefaultMcpConfig` is `false` and `mcpServers` equals the provided map.
   - When `options.mcpServers` is `undefined`, `loadDefaultMcpConfig` falls back to `options.loadMcpConfig !== false`.

## Acceptance Criteria

- [ ] A workspace with `enabledMcpServers: null` produces a pipeline run using the full global MCP config (no change to current behaviour).
- [ ] A workspace with `enabledMcpServers: ['serverA']` produces a pipeline run where only `serverA` is available to the AI session.
- [ ] A workspace with `enabledMcpServers: []` produces a pipeline run with no MCP servers active.
- [ ] `coc run` CLI command is unaffected (still loads global MCP config by default).
- [ ] TypeScript compilation succeeds (`npm run build`).
- [ ] All existing tests pass (`npm run test`).

## Dependencies

- Commit 001: `WorkspaceInfo.enabledMcpServers`, `RunPipelinePayload.mcpServers`, `CLIAIInvokerOptions.mcpServers` must exist.
- Commit 002: `GET /api/workspaces/:id/mcp-config` and workspace store persistence must exist so `enabledMcpServers` is populated at runtime.

## Assumed Prior State

- `packages/coc-server/src/task-types.ts` — `RunPipelinePayload` has `mcpServers?: Record<string, MCPServerConfig>` (added by commit 001).
- `packages/pipeline-core/src/process-store.ts` — `WorkspaceInfo` has `enabledMcpServers?: string[] | null` (added by commit 001).
- `packages/coc/src/ai-invoker.ts` — `CLIAIInvokerOptions` has `mcpServers?: Record<string, MCPServerConfig>` (added by commit 001).
- `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` — `SendMessageOptions.mcpServers` and `loadDefaultMcpConfig` already exist (lines 297 and ~290 respectively).
- `packages/pipeline-core/src/copilot-sdk-wrapper/mcp-config-loader.ts` — `loadDefaultMcpConfig()` (line 100) returns `{ mcpServers: Record<string, MCPServerConfig>, ... }`.
