---
status: done
---

# 004: Wire Suggestion Tool into Chat Executor and SSE Stream

## Summary

Register the `suggest_follow_ups` custom tool exclusively on chat-type AI sessions (both initial `executeWithAI` and `executeFollowUp`) and surface the model's suggestions through a new `suggestions` SSE event type so the SPA can render follow-up chips without parsing raw tool calls.

## Motivation

The suggestion tool must only be available to user-triggered chat sessions—not pipelines, code-review, resolve-comments, or other AI flows—because follow-up suggestions are a UX concept scoped to the conversational chat surface. Lower layers (pipeline-core) expose the generic `tools` interface, but the policy decision of *which* tools to register lives in the chat executor. A dedicated SSE event keeps the client simple: it doesn't need to inspect every `tool-complete` event and filter by tool name.

## Changes

### Files to Create

- None.

### Files to Modify

- **`packages/pipeline-core/src/process-store.ts`** — Add `'suggestions'` to the `ProcessOutputEvent.type` union and add a `suggestions?: string[]` field plus `turnIndex?: number` (turnIndex already exists, so just `suggestions` is new).

- **`packages/pipeline-core/src/ai/process-types.ts`** — Add optional `suggestions?: string[]` field to both `ConversationTurn` (line ~134) and `SerializedConversationTurn` (line ~150) interfaces so suggestions survive persistence and replay.

- **`packages/coc/src/server/queue-executor-bridge.ts`** — Three changes:
  1. Import the `suggestFollowUpsTool` (from wherever commit 003 exports it, likely `@plusplusoneplusplus/pipeline-core` or a local `../tools` module).
  2. In `executeWithAI` (~line 608): conditionally add `tools: [suggestFollowUpsTool]` to the `sendMessage` options object when `task.type === 'chat'`.
  3. In `executeFollowUp` (~line 331): add the same `tools: [suggestFollowUpsTool]` to the `sendFollowUp` options.
  4. In both methods' `onToolEvent` callbacks: intercept `tool-complete` events where `event.toolName === 'suggest_follow_ups'`, parse the suggestions from `event.result`, emit a new `suggestions` ProcessOutputEvent, and stash them on the executor so they can be written to the final `ConversationTurn.suggestions`.

- **`packages/coc-server/src/sse-handler.ts`** — In the `onProcessOutput` switch (~line 84-124): add an `else if (event.type === 'suggestions')` branch that calls `sendEvent(res, 'suggestions', { suggestions: event.suggestions, turnIndex: event.turnIndex })`. Also update the JSDoc protocol block (line ~19-28) to document the new event type.

### Files to Delete

- None.

## Implementation Notes

### 1. Gating tools to chat-only (`queue-executor-bridge.ts`)

In `executeWithAI` (~line 608), the `sendMessage` options object is built inline. Add the `tools` key conditionally:

```ts
const isChatTask = task.type === 'chat' || task.type === 'ai-clarification';

const result = await this.aiService.sendMessage({
    prompt,
    model: task.config.model,
    workingDirectory,
    timeoutMs,
    keepAlive: true,
    attachments,
    tools: isChatTask ? [suggestFollowUpsTool] : undefined, // ← NEW
    onPermissionRequest: ...,
    onStreamingChunk: ...,
    onToolEvent: ...,
});
```

Use `task.type === 'chat'` as the primary guard. Include `'ai-clarification'` only if chat tasks are enqueued under that type (the queue-handler accepts `'chat'` as a valid type string, but payload-wise chat tasks satisfy `isAIClarificationPayload` because they have `{ prompt }` and no `data` field). The key invariant: pipeline, code-review, resolve-comments, and task-generation paths never pass through `executeWithAI` with `type === 'chat'`, so the gate is safe.

For `executeFollowUp` (~line 331), `sendFollowUp` already implies a kept-alive chat session. Always include the tool here:

```ts
const result = await this.aiService.sendFollowUp(process.sdkSessionId, message, {
    workingDirectory,
    tools: [suggestFollowUpsTool], // ← NEW (follow-ups are always chat)
    onPermissionRequest: ...,
    attachments,
    onStreamingChunk: ...,
    onToolEvent: ...,
});
```

Note: `SendFollowUpOptions` will need a `tools` field added if commit 002 only threaded tools through `SendMessageOptions`. If so, add `tools?: CustomTool[]` to the `SendFollowUpOptions` interface and thread it through `sendFollowUp()` in `copilot-sdk-service.ts` (mirror how it's done for `sendMessage`).

### 2. Intercepting the tool call in `onToolEvent`

Inside both `onToolEvent` callbacks (in `executeWithAI` ~line 632 and `executeFollowUp` ~line 349), add an early intercept before the generic tool-event handling:

```ts
onToolEvent: (event: ToolEvent) => {
    // Intercept suggestion tool completions — emit as dedicated SSE event
    if (event.type === 'tool-complete' && event.toolName === 'suggest_follow_ups') {
        try {
            const parsed = JSON.parse(event.result || '[]');
            const suggestions: string[] = Array.isArray(parsed) ? parsed : [];
            this.pendingSuggestions.set(processId, suggestions);
            this.store.emitProcessEvent(processId, {
                type: 'suggestions',
                suggestions,
                turnIndex: currentTurnIndex,
            });
        } catch {
            // Malformed suggestions — ignore silently
        }
        return; // Don't emit as a regular tool-complete event
    }

    // ... existing tool event handling ...
}
```

Use a `Map<string, string[]>` field (`pendingSuggestions`) on the executor class to buffer suggestions until the assistant turn is finalized. When building the final `ConversationTurn` (in `executeWithAI` ~line 208 and `executeFollowUp` ~line 407):

```ts
const assistantTurn: ConversationTurn = {
    role: 'assistant',
    content: responseText,
    timestamp: new Date(),
    turnIndex: ...,
    toolCalls: ...,
    timeline: finalTimeline,
    suggestions: this.pendingSuggestions.get(processId), // ← NEW
};
this.pendingSuggestions.delete(processId);
```

### 3. `ProcessOutputEvent` type extension (`process-store.ts`)

Add `'suggestions'` to the type union:

```ts
export interface ProcessOutputEvent {
    type: 'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed'
        | 'permission-request' | 'suggestions';  // ← NEW
    // ... existing fields ...
    /** Follow-up message suggestions (for 'suggestions' events). */
    suggestions?: string[];
}
```

### 4. `ConversationTurn` extension (`process-types.ts`)

```ts
export interface ConversationTurn {
    // ... existing fields ...
    /** Suggested follow-up messages the user can send (assistant turns only). */
    suggestions?: string[];
}

export interface SerializedConversationTurn {
    // ... existing fields ...
    suggestions?: string[];
}
```

### 5. SSE event emission (`sse-handler.ts`)

In the `onProcessOutput` callback (~line 84), add a new branch:

```ts
} else if (event.type === 'suggestions') {
    sendEvent(res, 'suggestions', {
        suggestions: event.suggestions,
        turnIndex: event.turnIndex,
    });
}
```

Update the JSDoc protocol comment at the top to include:
```
 *   event: suggestions        → { suggestions: string[], turnIndex: number }
```

### 6. Conversation replay includes suggestions

The `replayConversationTurns` function sends a `conversation-snapshot` event with the full turns array. Since `suggestions` is now on `ConversationTurn`, reconnecting clients automatically receive previously emitted suggestions without any code change to the replay logic.

### 7. SSE event wire format

```
event: suggestions
data: {"suggestions":["What test coverage does this have?","Can you refactor the error handling?","Show me the related types"],"turnIndex":1}
```

## Tests

### Unit tests for queue-executor-bridge

- **`suggest_follow_ups tool is included for chat tasks`**: Create a task with `type: 'chat'`, mock `aiService.sendMessage`, verify the `tools` option contains `suggestFollowUpsTool`.
- **`suggest_follow_ups tool is NOT included for non-chat tasks`**: Create tasks with `type: 'follow-prompt'`, `'run-pipeline'`, `'resolve-comments'`; verify `tools` is `undefined`.
- **`suggest_follow_ups tool is included for follow-up messages`**: Mock `aiService.sendFollowUp`, verify `tools` option is present.
- **`onToolEvent intercepts suggest_follow_ups and emits suggestions event`**: Trigger an `onToolEvent` with `toolName: 'suggest_follow_ups'` and `type: 'tool-complete'`; verify `store.emitProcessEvent` is called with `type: 'suggestions'` and the parsed array.
- **`suggestions are stored on the final ConversationTurn`**: After task completion, verify the assistant turn in `store.updateProcess` includes `suggestions: [...]`.
- **`malformed suggestion result does not crash`**: Send `event.result = 'not json'` → verify no error thrown, no suggestions emitted.

### Unit tests for SSE handler

- **`suggestions event is forwarded to SSE stream`**: Emit a `suggestions` ProcessOutputEvent → verify `res.write` is called with `event: suggestions\ndata: ...`.

### Unit tests for types

- **`ConversationTurn accepts suggestions field`**: TypeScript compile-time check (existing test infrastructure).

## Acceptance Criteria

- [ ] `suggestFollowUpsTool` is passed in `tools` option ONLY when `task.type === 'chat'` (initial message)
- [ ] `suggestFollowUpsTool` is passed in `tools` option for ALL `executeFollowUp` calls
- [ ] Non-chat task types (`follow-prompt`, `run-pipeline`, `code-review`, `resolve-comments`, `custom`, `task-generation`) do NOT receive the tool
- [ ] When the model calls `suggest_follow_ups`, the result is parsed and emitted as a `suggestions` ProcessOutputEvent
- [ ] The `suggestions` event is NOT emitted as a regular `tool-complete` SSE event (it is intercepted)
- [ ] SSE clients receive `event: suggestions` with `{ suggestions: string[], turnIndex: number }` payload
- [ ] Suggestions are persisted on `ConversationTurn.suggestions` for reconnecting clients
- [ ] Malformed tool results (non-JSON, non-array) are silently ignored
- [ ] All existing tests continue to pass
- [ ] New unit tests cover the gating logic, interception, SSE emission, and persistence

## Dependencies

- Depends on: 003 (`suggestFollowUpsTool` definition and export)
- Depends on: 002 (`tools` threaded through `CopilotSDKService.sendMessage`)
- Depends on: 001 (`CustomTool` type on `SendMessageOptions.tools`)

## Assumed Prior State

- `suggestFollowUpsTool` is defined and exported from pipeline-core (or a shared tools module). It has a `name: 'suggest_follow_ups'`, a JSON schema expecting `{ suggestions: string[] }`, and a passthrough handler that returns the input as-is.
- `SendMessageOptions.tools` accepts `CustomTool[]` and is threaded through `CopilotSDKService.sendMessage()` to the underlying SDK session.
- `SendFollowUpOptions` may or may not yet have `tools` — if not, this commit must also add it and thread it through `sendFollowUp()`.
