---
status: done
---

# 001: Add Attachments to SDK Wrapper Types

## Summary

Expose the `@github/copilot-sdk`'s `MessageOptions.attachments` field through `pipeline-core`'s `SendMessageOptions` type, so that callers can attach files and directories to SDK messages.

## Motivation

The Copilot SDK already supports `attachments` on `MessageOptions` (an array of `{type: "file"|"directory", path: string, displayName?: string}`), but our wrapper type `SendMessageOptions` in `pipeline-core` does not surface it. This is pure type plumbing — the first commit in a series that will ultimately pass attachments through to the SDK's `session.sendAndWait()` and `session.send()` calls.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`
  - Define a new `Attachment` interface with `type: "file" | "directory"`, `path: string`, and `displayName?: string`.
  - Add an optional `attachments?: Attachment[]` field to `SendMessageOptions` (after the `idleTimeoutMs` field, before the MCP Control Options section, around line 190).
  - Export `Attachment` from this file.

- `packages/pipeline-core/src/copilot-sdk-wrapper/index.ts`
  - Add `Attachment` to the named exports from `'./types'` (in the "Types" export block, around line 18).

- `packages/pipeline-core/src/index.ts`
  - Add `Attachment` to the re-export list under the "AI Service / Copilot SDK Service" section (around line 318, alongside `SendMessageOptions`).

### Files to Delete
- (none)

## Implementation Notes

1. **Type shape**: Define a standalone `Attachment` interface rather than using an inline anonymous type. This matches the codebase pattern where all public types are named interfaces (e.g., `MCPServerConfig`, `PermissionRequest`, `ToolEvent`). The type mirrors the SDK's `MessageOptions.attachments` element type exactly:
   ```typescript
   export interface Attachment {
       /** Attachment type: file or directory */
       type: 'file' | 'directory';
       /** Absolute path to the file or directory */
       path: string;
       /** Optional display name shown to the AI */
       displayName?: string;
   }
   ```

2. **Placement in `SendMessageOptions`**: Add the field in the "basic options" region (after `idleTimeoutMs`, before the "MCP Control Options" comment block at line 192). This groups it with other message-content options rather than with session-configuration options:
   ```typescript
   /**
    * File or directory attachments to include with the message.
    * Maps to the SDK's MessageOptions.attachments.
    */
   attachments?: Attachment[];
   ```

3. **No runtime changes in this commit**: The `copilot-sdk-service.ts` file's `sendWithTimeout()` and `sendWithStreaming()` methods currently pass `{ prompt }` to the SDK's `session.sendAndWait()` / `session.send()`. Wiring `attachments` into those calls is deferred to a later commit — this commit is strictly type plumbing.

4. **ICopilotSession interface**: The internal `ICopilotSession` interface (line ~159-172 in `copilot-sdk-service.ts`) currently types `sendAndWait` and `send` with `{ prompt: string }`. This will need updating in a subsequent commit to accept `attachments`, but is **out of scope** for this commit.

5. **Export chain**: The export path is `types.ts` → `index.ts` (copilot-sdk-wrapper) → `index.ts` (pipeline-core root, via `'./ai'` which re-exports from copilot-sdk-wrapper). Verify the `./ai` barrel includes the re-export — it likely does since `SendMessageOptions` already flows through it.

## Tests

- **Type export test**: Add a test (or extend an existing test) in `packages/pipeline-core/` that imports `Attachment` and `SendMessageOptions` from the package's public API and verifies:
  - `Attachment` is a valid type (compile-time check).
  - An object conforming to `SendMessageOptions` can include an `attachments` array.
  - The `attachments` field is optional (a `SendMessageOptions` without it still compiles).
- **Build verification**: `npm run build` succeeds without errors across the monorepo.

## Acceptance Criteria

- [ ] `Attachment` interface is defined in `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts` with `type`, `path`, and `displayName` fields
- [ ] `SendMessageOptions` has an optional `attachments?: Attachment[]` field
- [ ] `Attachment` is exported from `packages/pipeline-core/src/copilot-sdk-wrapper/index.ts`
- [ ] `Attachment` is re-exported from `packages/pipeline-core/src/index.ts`
- [ ] `npm run build` succeeds without errors
- [ ] Unit tests verify the type is properly exported and usable

## Dependencies
- Depends on: None

## Assumed Prior State
None (first commit)
