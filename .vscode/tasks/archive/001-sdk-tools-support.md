---
status: done
---

# 001: Add `tools` support to pipeline-core SDK wrapper

## Summary

Thread the `@github/copilot-sdk` `SessionConfig.tools` field (`Tool<any>[]`) through the pipeline-core SDK wrapper so consumers can register custom tool handlers on AI sessions without importing the SDK directly.

## Motivation

The SDK's `SessionConfig` (line 271 of `types.d.ts`) already supports `tools?: Tool<any>[]` and `ResumeSessionConfig` (line 319) picks it via `Pick<SessionConfig, "tools" | ...>`. However, the pipeline-core wrapper's `ISessionOptions` (line 124–137 of `copilot-sdk-service.ts`), `IResumeSessionOptions` (line 143–147), and `SendMessageOptions` (line 189–252 of `types.ts`) don't expose this field. This commit is isolated as commit 1/3 because the SDK plumbing must exist before consumers (the SPA resolve-comment feature) can use it.

## Changes

### Files to Create
- `packages/pipeline-core/test/ai/copilot-sdk-service-tools.test.ts` — New test file for tools passthrough (follows naming pattern of existing `copilot-sdk-service-attachments.test.ts` and `copilot-sdk-service-keep-alive.test.ts`).

### Files to Modify

- **`packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`** — Add `tools?: Tool<any>[]` to `SendMessageOptions` (after line 251, alongside the existing MCP/permission fields). Add re-exports of the SDK's tool-definition types (`Tool`, `ToolHandler`, `ToolInvocation`, `ToolResult`, `ToolResultObject`, `ToolResultType`, `ZodSchema`, `defineTool`) so downstream consumers import from `pipeline-core` instead of `@github/copilot-sdk`.

- **`packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`** — (a) Add `tools?: any[]` to the internal `ISessionOptions` interface (line 124–137) and `IResumeSessionOptions` interface (line 143–147). Use `any[]` since the internal interfaces are SDK-agnostic mirrors that get forwarded verbatim to `client.createSession()`. (b) In `sendMessage()`, thread `options.tools` into `sessionOptions.tools` (around line 531–537, alongside the existing `model` and `streaming` assignments). (c) In `SendFollowUpOptions`, add `tools?: any[]` (around line 91–110). (d) In `resumeKeptAliveSession()`, thread `options.tools` into `resumeOptions.tools` (around line 759–765).

- **`packages/pipeline-core/src/copilot-sdk-wrapper/index.ts`** — Add the new SDK tool types to the re-export block (lines 9–32): `Tool`, `ToolHandler`, `ToolInvocation`, `ToolResult`, `ToolResultObject`, `ToolResultType`, `ZodSchema`, `defineTool`.

### Files to Delete
- None

## Implementation Notes

1. **Internal interfaces use `any[]` for tools:** The `ISessionOptions` and `IResumeSessionOptions` interfaces (lines 124–147) are internal SDK-agnostic mirrors — they don't import SDK types. The actual `Tool<any>[]` typing lives on the public `SendMessageOptions` in `types.ts`. This matches how `mcpServers` is typed as `Record<string, MCPServerConfig>` on `SendMessageOptions` but passed through untyped internally.

2. **Threading pattern to follow:** The existing pattern for forwarding options in `sendMessage()` (lines 530–579) is conditional assignment:
   ```ts
   if (options.model) { sessionOptions.model = options.model; }
   if (options.streaming) { sessionOptions.streaming = options.streaming; }
   ```
   Tools should follow the same pattern:
   ```ts
   if (options.tools) { sessionOptions.tools = options.tools; }
   ```
   Place this right after the `streaming` assignment (line 537) and before the MCP control block (line 539).

3. **Resume session pattern:** In `resumeKeptAliveSession()` (lines 759–765), the resume options are built conditionally. Add tools threading after the `onPermissionRequest` check (line 761):
   ```ts
   if (options?.tools) { resumeOptions.tools = options.tools; }
   ```

4. **SDK type re-exports:** The SDK defines these types starting at line 65 of `node_modules/@github/copilot-sdk/dist/types.d.ts`:
   - `ToolResultType` = `"success" | "failure" | "rejected" | "denied"` (line 65)
   - `ToolResultObject` with `textResultForLlm`, `binaryResultsForLlm?`, `resultType`, `error?` (line 72–79)
   - `ToolResult` = `string | ToolResultObject` (line 80)
   - `ToolInvocation` with `sessionId`, `toolCallId`, `toolName`, `arguments` (line 81–86)
   - `ToolHandler<TArgs>` = `(args, invocation) => Promise<unknown> | unknown` (line 87)
   - `ZodSchema<T>` with `_output: T`, `toJSONSchema()` (line 92–95)
   - `Tool<TArgs>` with `name`, `description?`, `parameters?`, `handler` (line 102–107)
   - `defineTool<T>(name, config)` factory function (line 112–116)

   Import them via `import type { Tool, ... } from '@github/copilot-sdk'` in `types.ts`. Use `export type` for interfaces/type aliases and `export { defineTool }` for the function (requires a re-export, not `import type`). Since `defineTool` is a runtime function, use a dynamic re-export pattern or document that consumers should import it directly from the SDK.

5. **`defineTool` re-export strategy:** Since `@github/copilot-sdk` is an ESM module loaded dynamically (see the `import()` call in `copilot-sdk-service.ts`), re-exporting the runtime `defineTool` function statically may not be feasible. Instead, re-export only the type-level symbols (`Tool`, `ToolHandler`, `ToolInvocation`, `ToolResult`, `ToolResultObject`, `ToolResultType`, `ZodSchema`) from `types.ts`. Document that `defineTool` should be imported from `@github/copilot-sdk` directly, or consumers can construct `Tool` objects manually since `defineTool` is just a convenience wrapper.

6. **Test mock pattern:** Existing tests in `copilot-sdk-service.test.ts` use `createMockSDKModule()` from `test/helpers/mock-sdk.ts` which returns a `MockCopilotClient` with a `createSession` spy. The new test should verify that `createSession` is called with `{ tools: [...] }` when `SendMessageOptions.tools` is provided. Follow the same `service as any` + `sdkModule` injection pattern (lines 52–54 of the existing test file).

## Tests

- **`tools` passthrough in `sendMessage`:** Verify that when `SendMessageOptions.tools` is set, `client.createSession()` receives `sessionOptions.tools` matching the provided array.
- **`tools` passthrough in `sendFollowUp` / resume:** Verify that when `SendFollowUpOptions.tools` is set and a session is resumed, `client.resumeSession()` receives `resumeOptions.tools`.
- **Omitted tools field:** Verify that when `tools` is not provided, `sessionOptions` does not include a `tools` key (preserving default SDK behavior).

## Acceptance Criteria

- [ ] `SendMessageOptions.tools` accepts `Tool<any>[]`
- [ ] `SendFollowUpOptions.tools` accepts tools for resumed sessions
- [ ] `tools` is threaded to `client.createSession(sessionOptions)` in `sendMessage()`
- [ ] `tools` is threaded to `client.resumeSession(id, resumeOptions)` in `resumeKeptAliveSession()`
- [ ] SDK tool types (`Tool`, `ToolHandler`, `ToolInvocation`, `ToolResult`, `ToolResultObject`, `ToolResultType`, `ZodSchema`) are re-exported from `pipeline-core/src/copilot-sdk-wrapper/index.ts`
- [ ] Existing tests still pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] New test file covers tools passthrough for both `sendMessage` and `sendFollowUp` paths

## Dependencies

- Depends on: None

## Assumed Prior State

None (first commit)
