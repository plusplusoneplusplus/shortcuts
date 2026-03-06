---
status: pending
---

# 001: Types — Workspace MCP Preferences + Pipeline Payload Extension

## Summary
Add `enabledMcpServers?: string[] | null` to `WorkspaceInfo` in `pipeline-core/src/process-store.ts` and extend `RunPipelinePayload` (coc-server) and `CLIAIInvokerOptions` (coc) to carry a filtered `mcpServers` map that downstream AI calls can consume.

## Motivation
This is a separate commit because it is a pure type/interface change with no runtime logic. All subsequent commits (persistence, API endpoints, pipeline executor wiring, UI) depend on these type definitions being stable first.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/pipeline-core/src/process-store.ts` — Add `enabledMcpServers?: string[] | null` field to `WorkspaceInfo`. `null` means "all servers disabled"; `undefined` means "use default"; an array means "only these servers are active".
- `packages/coc-server/src/task-types.ts` — Add `mcpServers?: Record<string, import('...').MCPServerConfig>` to `RunPipelinePayload` interface so a filtered server map can be passed when dispatching a pipeline run task.
- `packages/coc/src/ai-invoker.ts` — Add `mcpServers?: Record<string, MCPServerConfig>` to `CLIAIInvokerOptions`. This mirrors the existing `mcpServers` field on `SendMessageOptions` in `pipeline-core/src/copilot-sdk-wrapper/types.ts` and allows callers to pass a pre-filtered map.

### Files to Delete
- (none)

## Implementation Notes

- **`WorkspaceInfo`** lives in `packages/pipeline-core/src/process-store.ts` at line 57. It already has optional fields (`color?`, `remoteUrl?`), so `enabledMcpServers?: string[] | null` follows the same pattern.
- **`RunPipelinePayload`** is defined in `packages/coc-server/src/task-types.ts` (line 94) as a `readonly kind: 'run-pipeline'` discriminated union member. Import `MCPServerConfig` from `@plusplusoneplusplus/pipeline-core` (already a dependency of coc-server).
- **`CLIAIInvokerOptions`** is in `packages/coc/src/ai-invoker.ts` (line 32). The type `MCPServerConfig` is already available via `pipeline-core`; import it from the same path used by other coc imports.
- `SendMessageOptions` in `pipeline-core/src/copilot-sdk-wrapper/types.ts` already has `mcpServers?: Record<string, MCPServerConfig>` — the new fields in `CLIAIInvokerOptions` and `RunPipelinePayload` are intentionally shaped to match it so they can be forwarded without transformation.
- **PATCH `/api/workspaces/:id`** in `packages/coc-server/src/api-handler.ts` currently accepts `name`, `color`, `rootPath`, `remoteUrl`. In a later commit the handler will need to accept `enabledMcpServers`; this commit only adds the type.
- `null` vs `undefined` semantics for `enabledMcpServers` must be documented in a JSDoc comment on the field to avoid ambiguity for future implementors.

## Tests

- Add a unit test in `packages/pipeline-core/` asserting that a `WorkspaceInfo` object with `enabledMcpServers: ['github']` satisfies the TypeScript type (compile-time test via `tsc --noEmit`).
- Add a unit test in `packages/coc-server/` asserting that a `RunPipelinePayload` with `mcpServers` set satisfies the type and passes the existing `isRunPipelinePayload` guard.
- Add a unit test in `packages/coc/` asserting that a `CLIAIInvokerOptions` with `mcpServers` set is accepted without TypeScript errors.
- All existing tests must continue to pass (`npm run test`).

## Acceptance Criteria
- [ ] `WorkspaceInfo` in `packages/pipeline-core/src/process-store.ts` has `enabledMcpServers?: string[] | null` with a JSDoc comment explaining `null`/`undefined`/array semantics.
- [ ] `RunPipelinePayload` in `packages/coc-server/src/task-types.ts` has `mcpServers?: Record<string, MCPServerConfig>`.
- [ ] `CLIAIInvokerOptions` in `packages/coc/src/ai-invoker.ts` has `mcpServers?: Record<string, MCPServerConfig>`.
- [ ] `MCPServerConfig` is imported (not re-declared) from `pipeline-core` in both coc-server and coc.
- [ ] `npm run build` succeeds with no new TypeScript errors.
- [ ] No existing runtime behaviour is changed (type-only additions).

## Dependencies
- Depends on: None

## Assumed Prior State
None
