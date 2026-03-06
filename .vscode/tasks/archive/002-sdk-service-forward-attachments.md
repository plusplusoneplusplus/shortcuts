---
status: done
---

# 002: Forward Attachments in SDK Service

## Summary

Update `copilot-sdk-service.ts` so that the `ICopilotSession` interface, `sendWithTimeout()`, `sendWithStreaming()`, and the public `sendMessage()` / `sendFollowUp()` methods all propagate `attachments` from `SendMessageOptions` through to the SDK's `session.sendAndWait()` and `session.send()` calls.

## Motivation

Commit 001 added the `attachments` field to `SendMessageOptions` (the public API type), but the internal plumbing still ignores it. The `ICopilotSession` interface types `sendAndWait` and `send` with `{ prompt: string }`, and the two send helpers hardcode `{ prompt }` when calling the session. This commit closes the gap so attachments actually reach the SDK.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts` — Widen `ICopilotSession` method signatures, thread `attachments` through `sendWithTimeout` / `sendWithStreaming`, and extract `attachments` in `sendMessage()` / `sendFollowUp()`.

### Files to Delete
- (none)

## Implementation Notes

### 1. Import `Attachment` type

Add `Attachment` to the existing import from `'./types'` (line ~27):

```typescript
// Before
import {
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    // ...
} from './types';

// After — add Attachment
import {
    Attachment,
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    // ...
} from './types';
```

### 2. Widen `ICopilotSession` interface (lines 159-172)

Change the `sendAndWait` and `send` method signatures from `{ prompt: string }` to `{ prompt: string; attachments?: Attachment[] }`. This matches the SDK's actual `MessageOptions` type while keeping our internal interface self-contained (no direct dependency on SDK types).

```typescript
// Before
interface ICopilotSession {
    sessionId: string;
    sendAndWait(options: { prompt: string }, timeout?: number): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
    on?(handler: (event: ISessionEvent) => void): (() => void);
    send?(options: { prompt: string }): Promise<void>;
}

// After
interface ICopilotSession {
    sessionId: string;
    sendAndWait(options: { prompt: string; attachments?: Attachment[] }, timeout?: number): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
    on?(handler: (event: ISessionEvent) => void): (() => void);
    send?(options: { prompt: string; attachments?: Attachment[] }): Promise<void>;
}
```

**Design decision**: We use `{ prompt: string; attachments?: Attachment[] }` rather than importing the SDK's `MessageOptions` directly. This keeps the internal interface decoupled from the SDK's type definitions (which also include a `mode` field we don't use here) and is consistent with the existing pattern of this file defining its own slim interface shapes.

### 3. Update `sendWithTimeout()` (lines 1216-1224)

Add an `attachments` parameter and pass it through to `session.sendAndWait()`:

```typescript
// Before
private async sendWithTimeout(
    session: ICopilotSession,
    prompt: string,
    timeoutMs: number
): Promise<{ data?: { content?: string } }> {
    return session.sendAndWait({ prompt }, timeoutMs);
}

// After
private async sendWithTimeout(
    session: ICopilotSession,
    prompt: string,
    timeoutMs: number,
    attachments?: Attachment[]
): Promise<{ data?: { content?: string } }> {
    return session.sendAndWait({ prompt, attachments }, timeoutMs);
}
```

**Note**: When `attachments` is `undefined`, the SDK's `MessageOptions` type makes it optional, so passing `{ prompt, attachments: undefined }` is equivalent to `{ prompt }` — no conditional logic needed.

### 4. Update `sendWithStreaming()` (lines 1248-1256)

Add an `attachments` parameter and thread it to the `session.send!()` call at line ~1612:

```typescript
// Before (signature)
private async sendWithStreaming(
    session: ICopilotSession,
    prompt: string,
    timeoutMs: number,
    onStreamingChunk?: (chunk: string) => void,
    toolCallsMap?: Map<string, ToolCall>,
    onToolEvent?: (event: ToolEvent) => void,
    idleTimeoutMs?: number
): Promise<StreamingResult> {

// After (signature)
private async sendWithStreaming(
    session: ICopilotSession,
    prompt: string,
    timeoutMs: number,
    onStreamingChunk?: (chunk: string) => void,
    toolCallsMap?: Map<string, ToolCall>,
    onToolEvent?: (event: ToolEvent) => void,
    idleTimeoutMs?: number,
    attachments?: Attachment[]
): Promise<StreamingResult> {
```

And the `session.send!()` call (line ~1612):

```typescript
// Before
session.send!({ prompt }).catch(error => {

// After
session.send!({ prompt, attachments }).catch(error => {
```

**Placement rationale**: `attachments` is added as the last parameter to avoid breaking the positional call sites. Both `sendMessage()` and `sendFollowUp()` will pass it as the final argument.

### 5. Thread attachments through `sendMessage()` (lines 602-611)

Extract `attachments` from `options` and pass to both send helpers:

```typescript
// Before (lines 602-612)
if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
    const idleTimeoutMs = options.idleTimeoutMs ?? CopilotSDKService.DEFAULT_IDLE_TIMEOUT_MS;
    const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs);
    // ...
} else {
    const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);
    // ...
}

// After
if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
    const idleTimeoutMs = options.idleTimeoutMs ?? CopilotSDKService.DEFAULT_IDLE_TIMEOUT_MS;
    const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs, options.attachments);
    // ...
} else {
    const result = await this.sendWithTimeout(session, options.prompt, timeoutMs, options.attachments);
    // ...
}
```

### 6. Thread attachments through `sendFollowUp()` (lines 797-808)

The `sendFollowUp()` method also calls `sendWithStreaming` and `sendWithTimeout`. Add `attachments` support to `SendFollowUpOptions` and thread it through:

First, add to `SendFollowUpOptions` (line ~90):

```typescript
// Add to SendFollowUpOptions interface
/** File or directory attachments to include with the follow-up message */
attachments?: Attachment[];
```

Then update the call sites in `sendFollowUp()`:

```typescript
// Before (line ~799-800)
const streamingResult = await this.sendWithStreaming(
    session, prompt, timeoutMs, options?.onStreamingChunk, undefined, options?.onToolEvent, idleTimeoutMs,
);
// ...
const sendResult = await this.sendWithTimeout(session, prompt, timeoutMs);

// After
const streamingResult = await this.sendWithStreaming(
    session, prompt, timeoutMs, options?.onStreamingChunk, undefined, options?.onToolEvent, idleTimeoutMs, options?.attachments,
);
// ...
const sendResult = await this.sendWithTimeout(session, prompt, timeoutMs, options?.attachments);
```

## Tests

Add tests in `packages/pipeline-core/test/ai/copilot-sdk-service.test.ts` (or a new sibling file `copilot-sdk-service-attachments.test.ts`) using the existing mock helpers:

1. **`sendMessage` forwards attachments to `session.sendAndWait` (non-streaming path)**
   - Use `createMockSDKModule()` with a custom mock session whose `sendAndWait` is a `vi.fn()`.
   - Call `service.sendMessage({ prompt: '...', attachments: [{ type: 'file', path: '/tmp/foo.ts' }] })`.
   - Assert `session.sendAndWait` was called with `{ prompt: '...', attachments: [{ type: 'file', path: '/tmp/foo.ts' }] }`.

2. **`sendMessage` forwards attachments to `session.send` (streaming path)**
   - Use `createStreamingMockSDKModule()`.
   - Call `service.sendMessage({ prompt: '...', streaming: true, attachments: [{ type: 'directory', path: '/tmp/src', displayName: 'source' }] })`.
   - Dispatch `session.idle` event to complete.
   - Assert `session.send` was called with `{ prompt: '...', attachments: [{ type: 'directory', path: '/tmp/src', displayName: 'source' }] }`.

3. **`sendMessage` works without attachments (backward compatibility)**
   - Call `service.sendMessage({ prompt: '...' })` without attachments.
   - Assert `session.sendAndWait` was called with `{ prompt: '...', attachments: undefined }` (or just `{ prompt: '...' }` — both are acceptable).

4. **`sendFollowUp` forwards attachments (streaming path)**
   - Create a kept-alive session, then call `sendFollowUp` with attachments.
   - Assert `session.send` was called with the attachments included.

## Acceptance Criteria

- [ ] `ICopilotSession.sendAndWait` and `send` accept `{ prompt: string; attachments?: Attachment[] }`
- [ ] `sendWithTimeout()` has an `attachments` parameter and passes it to `session.sendAndWait()`
- [ ] `sendWithStreaming()` has an `attachments` parameter and passes it to `session.send!()`
- [ ] `sendMessage()` extracts `options.attachments` and forwards to both send helpers
- [ ] `SendFollowUpOptions` has an optional `attachments` field
- [ ] `sendFollowUp()` forwards `options?.attachments` to both send helpers
- [ ] All existing tests continue to pass (`npm run test` in pipeline-core)
- [ ] New tests verify attachments are forwarded in both streaming and non-streaming paths
- [ ] `npm run build` succeeds without errors

## Dependencies
- Depends on: 001

## Assumed Prior State
`SendMessageOptions` in `types.ts` already has the `attachments?: Attachment[]` field and `Attachment` is exported (from commit 001).
