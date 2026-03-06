---
status: done
---

# 001: Add Custom Tools Support to Pipeline-Core Types

## Summary

Add a generic `CustomToolDefinition` interface and a `tools?: CustomToolDefinition[]` field to `SendMessageOptions`, `ISessionOptions`, and `IResumeSessionOptions` so callers can pass custom tool definitions (created via the SDK's `defineTool()`) into sessions.

## Motivation

This is a pure types/interfaces commit that unblocks all downstream work (wiring in `copilot-sdk-service.ts`, building the suggestions tool, integrating into chat). Keeping it separate makes the change trivially reviewable and ensures the public API surface is agreed upon before any logic is written.

## Changes

### Files to Create
- None

### Files to Modify

- **`packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`** — Add the `CustomToolDefinition` interface and the `tools` field to `SendMessageOptions`.

  1. **New interface `CustomToolDefinition`** (add after the `ToolEvent` interface, ~line 272):
     ```ts
     /**
      * A custom tool definition to register with the Copilot SDK session.
      *
      * This is an opaque wrapper: callers produce values via the SDK's
      * `defineTool()` helper and pass them here. Pipeline-core never
      * inspects the internals — it just forwards the array to
      * `createSession({ tools })`.
      *
      * Using `unknown` keeps pipeline-core decoupled from the SDK's
      * concrete `Tool` type and avoids pulling Zod into the dependency
      * graph.
      */
     export type CustomToolDefinition = unknown;
     ```
     
     **Why `unknown` instead of a structural interface?**  
     The SDK's `defineTool()` returns an opaque object whose internal shape is not part of the public API contract. Defining our own structural mirror (name, description, parameters, handler) would be fragile — it would break whenever the SDK changes internals. By typing it as `unknown`, we:
     - Avoid a Zod dependency in pipeline-core (the SDK uses Zod schemas for `parameters`).
     - Force callers to go through `defineTool()`, which is the correct construction path.
     - Still get a named type alias (`CustomToolDefinition`) for documentation and grep-ability.

  2. **New `tools` field on `SendMessageOptions`** (add after `keepAlive`, ~line 252):
     ```ts
     /**
      * Custom tool definitions to register with the session.
      * Created via the SDK's `defineTool()` API. Each tool is
      * forwarded as-is to `createSession({ tools })`.
      */
     tools?: CustomToolDefinition[];
     ```

- **`packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`** — Add the `tools` field to the internal `ISessionOptions` and `IResumeSessionOptions` interfaces.

  1. **`ISessionOptions`** (line 124–137) — add after `onPermissionRequest` (line 136):
     ```ts
     /** Custom tool definitions to register with this session */
     tools?: unknown[];
     ```
     Uses `unknown[]` here (not `CustomToolDefinition`) because this is a private interface that mirrors the SDK's `SessionConfig` shape directly; it never leaks to consumers.

  2. **`IResumeSessionOptions`** (line 143–147) — add after `mcpServers` (line 146):
     ```ts
     /** Custom tool definitions (carried over when resuming) */
     tools?: unknown[];
     ```

- **`packages/pipeline-core/src/copilot-sdk-wrapper/index.ts`** — Add `CustomToolDefinition` to the type re-exports (line 9–32 block):
  ```ts
  // Custom tool types
  CustomToolDefinition,
  ```

- **`packages/pipeline-core/src/ai/index.ts`** — Add `CustomToolDefinition` to the re-export block from `../copilot-sdk-wrapper` (~line 17–76):
  ```ts
  CustomToolDefinition,
  ```

### Files to Delete
- None

## Implementation Notes

1. **`CustomToolDefinition = unknown`** — This is intentionally opaque. The SDK's `defineTool()` returns a typed object internally but its shape is SDK-private. Consumers call `defineTool({ name, description, parameters: z.object({...}), handler })` and get back an opaque tool object. We just shuttle it through.

2. **No logic changes in this commit.** The `tools` field on `ISessionOptions` is not yet wired into the `sessionOptions` construction in `sendMessage()` (lines 531–579). That wiring is commit 002.

3. **No Zod dependency.** The `parameters` field in `defineTool()` uses Zod schemas, but since we type `CustomToolDefinition` as `unknown`, pipeline-core doesn't need Zod at all. Only the caller (e.g., the chat module in `packages/coc/`) will depend on Zod.

4. **`SendFollowUpOptions` does NOT need `tools`** — Tools are session-scoped (set at `createSession` time), not message-scoped. Follow-up messages reuse the session's existing tool registrations.

5. **Naming convention**: `CustomToolDefinition` rather than `Tool` to avoid collision with the existing `MCPServerConfigBase.tools` (which is `string[]` of tool names for MCP filtering) and with the SDK's own `Tool` type.

## Tests

- **Type-level compilation test**: Add a small type-check in an existing or new test file (`packages/pipeline-core/test/copilot-sdk-wrapper/types.test.ts`) that verifies `SendMessageOptions` accepts `tools`:
  ```ts
  it('SendMessageOptions accepts tools field', () => {
      const opts: SendMessageOptions = {
          prompt: 'test',
          tools: [{ fake: 'tool-object' }],
      };
      expect(opts.tools).toHaveLength(1);
  });
  ```
- **Build verification**: `npm run build` passes with no errors (types compile cleanly).
- No runtime tests needed — this commit adds no logic.

## Acceptance Criteria

- [ ] `CustomToolDefinition` type alias is exported from `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`
- [ ] `SendMessageOptions.tools` field exists as `CustomToolDefinition[]` (optional)
- [ ] `ISessionOptions.tools` field exists as `unknown[]` (optional, internal)
- [ ] `IResumeSessionOptions.tools` field exists as `unknown[]` (optional, internal)
- [ ] `CustomToolDefinition` is re-exported from `packages/pipeline-core/src/copilot-sdk-wrapper/index.ts`
- [ ] `CustomToolDefinition` is re-exported from `packages/pipeline-core/src/ai/index.ts`
- [ ] `npm run build` succeeds with no type errors
- [ ] No runtime logic is changed

## Dependencies

- Depends on: None

## Assumed Prior State

None (first commit in the follow-up suggestions feature)
