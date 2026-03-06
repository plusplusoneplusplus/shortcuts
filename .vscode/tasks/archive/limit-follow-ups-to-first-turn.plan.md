# Plan: Limit `suggest_follow_ups` Tool to First Turn Only

## Problem

Currently, the `suggest_follow_ups` tool is attached to **every** AI response in a chat session — both the initial message and all follow-up turns. The desired behavior is to only call the tool on the **very first AI response** (turn 0), not on subsequent turns.

## Current Behavior (in `queue-executor-bridge.ts`)

There are **two attachment points**:

### 1. Initial chat task (line ~811)
```ts
const tools = (isChatTask && this.followUpSuggestions.enabled)
    ? [createSuggestFollowUpsTool()]
    : undefined;
return this.executeWithAI(task, prompt + countSuffix, tools ? { tools } : undefined);
```
This runs for the **first** user message. ✅ Should **keep** the tool here.

### 2. Follow-up messages (line ~510)
```ts
const suggestTools = this.followUpSuggestions.enabled ? [createSuggestFollowUpsTool()] : [];
// passed via aiService.sendFollowUp(..., { tools: suggestTools })
```
This runs for **every follow-up turn**. ❌ Should **remove** the tool here.

## Proposed Approach

At the follow-up attachment point (~line 510), check the current turn index. If it's greater than 0 (i.e., not the first turn), do not include `createSuggestFollowUpsTool()`.

The turn index can be determined from `cleanTurns.length` (the number of completed turns before the current one). Turn 0 means no prior turns exist.

```ts
// Before (line ~510):
const suggestTools = this.followUpSuggestions.enabled ? [createSuggestFollowUpsTool()] : [];

// After:
const isFirstTurn = cleanTurns.length === 0;
const suggestTools = (this.followUpSuggestions.enabled && isFirstTurn)
    ? [createSuggestFollowUpsTool()]
    : [];
```

> **Note:** `cleanTurns` is already computed earlier in the same function and represents the conversation history before the current turn. When empty, this is the first AI response.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `isFirstTurn` guard at the follow-up tool attachment point (~line 510) |

## Tests to Update

- `packages/coc/src/server/queue-executor-bridge.test.ts`
  - Add test: follow-up turns do **not** receive `suggest_follow_ups` tool
  - Verify existing tests at lines ~6310, 6330, 6350 still pass (non-chat tasks get no tools)
  - Verify first-turn chat still receives the tool (existing behavior)

## Acceptance Criteria

1. First user message in a chat → AI response includes follow-up suggestions (tool called)
2. Second+ user messages in a chat → AI response does **not** include follow-up suggestions (tool not attached)
3. No regression for non-chat task types (`ai-clarification`, `follow-prompt`, `custom`)
4. `followUpSuggestions.enabled = false` continues to suppress the tool on all turns

## Notes

- This is a **server-side** change only. The UI (`ConversationTurnBubble.tsx`) already filters out `suggest_follow_ups` tool calls from display — no UI changes needed.
- The `suggest_follow_ups` tool on the **initial chat task** path (line ~811) is separate code and is unaffected.
- Minimal change: only one line needs to be guarded.
