# Follow-Up Prompts Not Rendering as Clickable Buttons

## Problem

In the wiki ask UI (`WikiAsk.tsx`), AI responses that include follow-up suggestions appear as plain markdown bullet points instead of clickable `SuggestionChips` buttons (as seen in the screenshot with the red box).

## Root Cause

The `suggest_follow_ups` tool is architecturally wired up for the queue/chat pipeline but was **never plumbed into the wiki ask pipeline**. As a result:

1. The AI has no tool to call, so it falls back to writing suggestions as markdown bullet text.
2. No `suggestions` SSE event is ever emitted by the backend.
3. `WikiAsk.tsx` has no handler for `suggestions` SSE events and never renders `<SuggestionChips>`.

This is a three-layer gap — all three layers must be fixed together.

## Contrast: How the Chat Pipeline Does It Correctly

- `RepoChatTab.tsx` / `NewChatDialog.tsx` pass `suggest_follow_ups` as a tool to the AI.
- `queue-executor-bridge.ts` intercepts `tool-complete` and emits `{ type: 'suggestions', suggestions: [...] }` SSE.
- The UI listens for `suggestions` SSE events and renders `<SuggestionChips>`.

## Files Involved

| File | Role |
|---|---|
| `packages/coc-server/src/suggest-follow-ups-tool.ts` | Tool definition (already correct, just not used) |
| `packages/coc-server/src/wiki/dw-ask-handler.ts` | Wiki ask handler — missing tool wiring + SSE emit |
| `packages/coc-server/src/wiki/ask-handler.ts` | General ask handler — same gap |
| `packages/coc-server/src/wiki/conversation-session-manager.ts` | `AskAIFunction` type + `send()` — missing `tools`/`onToolEvent` |
| `packages/coc/src/server/spa/client/react/wiki/WikiAsk.tsx` | UI — missing `suggestions` SSE handler + `<SuggestionChips>` |
| `packages/coc/src/server/spa/client/react/shared/SuggestionChips.tsx` | Button component (already correct) |

## Tasks

### 1. Extend `AskAIFunction` type with `tools` / `onToolEvent`
**File:** `conversation-session-manager.ts` (and `dw-ask-handler.ts`, `ask-handler.ts`)

The `AskAIFunction` type currently only has `onStreamingChunk`. Add:
```ts
tools?: ToolDefinition[];
onToolEvent?: (event: { toolName: string; result: unknown }) => void;
```

### 2. Register `suggest_follow_ups` tool in the wiki ask pipeline
**File:** `conversation-session-manager.ts`, `ask-handler.ts`, `dw-ask-handler.ts`

Import `createSuggestFollowUpsTool` and pass it into the AI call alongside existing tools (if any). Wire `onToolEvent` to relay `tool-complete` events.

### 3. Add system prompt instruction
**File:** `buildAskPrompt` in both handlers

Add an instruction like:
> After answering, call `suggest_follow_ups` with 2–3 brief follow-up actions the user might want. Do **not** write follow-up suggestions as plain text.

### 4. Emit `suggestions` SSE event from the wiki ask backend
**File:** `dw-ask-handler.ts` (or the SSE streaming layer)

In the `onToolEvent` callback, when `toolName === 'suggest_follow_ups'`, emit:
```json
{ "type": "suggestions", "suggestions": ["..."] }
```
to the SSE stream (same pattern as `queue-executor-bridge.ts` lines 572–584).

### 5. Add `SuggestionChips` rendering to `WikiAsk.tsx`
**File:** `packages/coc/src/server/spa/client/react/wiki/WikiAsk.tsx`

- Import `SuggestionChips` from `../shared`.
- Add `const [suggestions, setSuggestions] = useState<string[]>([])`.
- In the SSE event handler, add a case for `data.type === 'suggestions'` → `setSuggestions(data.suggestions)`.
- Render `<SuggestionChips>` below the last assistant message when `suggestions.length > 0 && !isStreaming`, with `onSelect` submitting the selected text as the next user message.
- Reset `suggestions` to `[]` when a new user message is sent.

## Approach

Fix all five layers top-down (backend types → tool registration → prompt → SSE emit → UI render). The changes are additive and do not break existing behavior.
