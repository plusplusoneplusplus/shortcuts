# Streaming Callback for Copilot SDK

## Problem

`sendWithStreaming()` accumulates all `assistant.message_delta` chunks internally and only returns the final string. Callers (e.g., deep-wiki's ask-handler) cannot receive chunks in real-time, forcing them to simulate streaming by artificially chunking the final response. This prevents timely display of generated content in web UIs.

## Proposed Approach

Add an optional `onStreamingChunk` callback to `SendMessageOptions` so callers can process each delta chunk as it arrives from the SDK session. This enables true real-time streaming to web UIs via SSE or WebSocket.

## Scope

### In Scope
- Add `onStreamingChunk` callback to `SendMessageOptions`
- Wire it into `sendWithStreaming()` to emit chunks as they arrive
- Auto-enable streaming mode when `onStreamingChunk` is provided
- Update deep-wiki's `ask-handler.ts` to use native streaming instead of simulated chunking

### Out of Scope
- Session pool streaming (pool sessions don't support per-request options)
- UI/frontend changes (SSE/WebSocket infrastructure already exists in deep-wiki)
- Changing the return type of `sendMessage()` (still returns final string)

## Tasks

### 1. Add `onStreamingChunk` to `SendMessageOptions`
**File:** `packages/pipeline-core/src/ai/copilot-sdk-service.ts`
- [x] Add optional callback: `onStreamingChunk?: (chunk: string) => void`
- [x] Document that providing this callback auto-enables streaming mode
- [x] Export any needed types from barrel file

### 2. Wire callback into `sendWithStreaming()`
**File:** `packages/pipeline-core/src/ai/copilot-sdk-service.ts`
- [x] Pass `onStreamingChunk` into `sendWithStreaming()` method
- [x] Invoke callback on each `assistant.message_delta` event (line ~1123)
- [x] Ensure callback errors don't break the streaming flow (wrap in try-catch)

### 3. Auto-enable streaming when callback is provided
**File:** `packages/pipeline-core/src/ai/copilot-sdk-service.ts`
- [x] In `sendMessageDirect()`, treat `onStreamingChunk` presence as `streaming: true`
- [x] Update the condition at line ~761 to include `options.onStreamingChunk`

### 4. Update deep-wiki ask-handler to use native streaming
**File:** `packages/deep-wiki/src/server/ask-handler.ts`
- [x] Replace simulated chunking (`chunkText()`) with `onStreamingChunk` callback
- [x] Send SSE `chunk` events directly from the callback
- [x] Remove or simplify the artificial chunking logic

### 5. Add tests
- [x] Unit test: verify `onStreamingChunk` is called for each delta event
- [x] Unit test: verify streaming auto-enables when callback is provided
- [x] Unit test: verify callback errors don't break the response
- [x] Update deep-wiki ask-handler tests if behavior changes

## Usage Example

```typescript
// Web UI handler using SSE
const result = await service.sendMessage({
    prompt: 'Analyze this code',
    onStreamingChunk: (chunk) => {
        // Send each chunk to the client immediately
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    },
});
// result still contains the full final response
```

## Notes

- `onStreamingChunk` only works with direct sessions (`usePool: false`), since pool sessions don't support streaming
- The final return value of `sendMessage()` remains unchanged (full response string)
- If the SDK session doesn't support `session.on`/`session.send`, falls back to non-streaming and callback is never invoked
