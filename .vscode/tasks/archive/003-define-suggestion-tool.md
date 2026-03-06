---
status: done
---

# 003: Define suggest_follow_ups Custom Tool

## Summary

Create a factory function that builds a `suggest_follow_ups` custom tool definition for the Copilot SDK. The model calls this tool at the end of each turn with 2–3 suggested follow-up questions; the handler is a passthrough that returns the suggestions as structured JSON.

## Motivation

This is a self-contained, testable unit with a clear boundary: one file exporting a tool definition factory plus its TypeScript types. Separating it from the wiring commit (004) keeps the diff reviewable and lets us test the tool's schema validation and handler logic in isolation.

## Changes

### Files to Create

- `packages/coc-server/src/suggest-follow-ups-tool.ts` — Factory function and types for the custom tool.

### Files to Modify

- `packages/coc-server/src/index.ts` — Re-export the factory and types so consumers (`queue-executor-bridge.ts`) can import from `@plusplusoneplusplus/coc-server`.

### Files to Delete

- (none)

## Implementation Notes

### Tool Name
`suggest_follow_ups`

### Tool Description (given to the model)
```
After completing your response, call this tool to suggest 2-3 brief follow-up questions the user might want to ask next. Each suggestion should be a concise, actionable question directly related to the conversation context.
```

### Parameter Schema (JSON Schema)
```json
{
  "type": "object",
  "properties": {
    "suggestions": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 2,
      "maxItems": 3,
      "description": "2-3 short follow-up questions the user might ask next"
    }
  },
  "required": ["suggestions"]
}
```

### Handler Behaviour
The handler is a **passthrough** — the model generates the suggestions as tool-call arguments, and the handler simply returns them as-is. This is the key design insight: the suggestions live in the tool-call arguments, not in a model response. The handler signature:

```typescript
handler: async (args: { suggestions: string[] }) => {
    return { suggestions: args.suggestions };
}
```

The return value is serialised by the SDK and appears as the tool-call's `result` field in the `ToolCall` object (visible in `ConversationTurn.toolCalls` / timeline).

### Factory Function Signature
```typescript
export interface FollowUpSuggestion {
    suggestions: string[];
}

/**
 * Create a suggest_follow_ups custom tool definition for the Copilot SDK.
 * Pass the returned object in the `tools` array of SendMessageOptions / ISessionOptions.
 */
export function createSuggestFollowUpsTool(): CustomTool;
```

Where `CustomTool` is the type expected by `SendMessageOptions.tools` (defined in pipeline-core commit 001). The factory wraps the SDK's `defineTool` call:

```typescript
import { defineTool } from '@github/copilot-sdk';
```

### System Prompt Instruction
No separate system prompt injection in this commit. The tool description itself is sufficient for the model to know when to call it. A future commit (004) will wire the tool into `executeWithAI` / `executeFollowUp` in `queue-executor-bridge.ts`, and can optionally prepend a short system instruction if the model doesn't call it reliably.

### How It Will Be Used (next commit, 004)
```typescript
import { createSuggestFollowUpsTool } from '@plusplusoneplusplus/coc-server';

// In executeWithAI / executeFollowUp:
const result = await this.aiService.sendMessage({
    prompt,
    tools: [createSuggestFollowUpsTool()],
    keepAlive: true,
    // ...
});
```

The SDK will register the tool with the session. The model calls it at the end of its response turn. The handler returns the suggestions, which appear as a completed tool call in the `ToolCall[]` / timeline. A later commit (005+) will extract these from the timeline and surface them in the SPA chat UI.

## Tests

- **Unit: `packages/coc-server/test/suggest-follow-ups-tool.test.ts`**
  - `createSuggestFollowUpsTool()` returns an object with `name: 'suggest_follow_ups'`.
  - The returned object has `description`, `parameters`, and `handler` properties.
  - `parameters` matches the expected JSON schema (object with `suggestions` array, required, minItems 2, maxItems 3).
  - Handler with valid input `{ suggestions: ['Q1', 'Q2'] }` returns `{ suggestions: ['Q1', 'Q2'] }`.
  - Handler with 3 suggestions returns all 3.
  - Handler is a passthrough — output equals input (deep equality).
  - Exported `FollowUpSuggestion` type is importable (compile-time check via test import).

## Acceptance Criteria

- [ ] `createSuggestFollowUpsTool()` exported from `packages/coc-server/src/index.ts`
- [ ] `FollowUpSuggestion` type exported from `packages/coc-server/src/index.ts`
- [ ] Tool name is exactly `suggest_follow_ups`
- [ ] Tool parameter schema requires `suggestions` array with 2–3 string items
- [ ] Handler returns input args unchanged (passthrough)
- [ ] All new tests pass (`npm run test` in `packages/coc-server/`)
- [ ] Existing tests in `packages/coc-server/` still pass
- [ ] `npm run build` succeeds for the monorepo

## Dependencies

- Depends on: 001 (`CustomTool` type in `SendMessageOptions.tools`), 002 (`tools` threaded through `CopilotSDKService.createSession()` and `sendFollowUp()`)

## Assumed Prior State

`SendMessageOptions.tools` and `ISessionOptions.tools` accept `CustomTool[]`. `CopilotSDKService` passes `tools` to the SDK's `createSession()` and includes them in streaming / follow-up paths. The `CustomTool` type wraps whatever `defineTool()` returns from `@github/copilot-sdk`.
