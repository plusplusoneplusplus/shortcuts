# Context: Chat Follow-Up Suggestions

## User Story
As a developer chatting with a repository in the CoC dashboard, I want the assistant to suggest 2–3 follow-up questions after each response so I can continue exploring without friction. Only user-triggered chat sessions should use this feature — the lower-level pipeline-core should provide a generic custom tools interface, and only the chat executor opts in.

## Goal
Leverage the Copilot SDK's `defineTool` API to register a `suggest_follow_ups` custom tool on chat sessions, enabling the model to return structured follow-up suggestions that the SPA renders as clickable chips.

## Commit Sequence
1. Add custom tools types to pipeline-core (`CustomToolDefinition`, `tools` on `SendMessageOptions`)
2. Thread custom tools through `CopilotSDKService` to SDK `createSession()`
3. Define `suggest_follow_ups` tool in coc-server (passthrough handler)
4. Wire tool into chat executor only + emit `suggestions` SSE event
5. Render suggestion chips in SPA chat UI (click-to-send, dismiss on typing)
6. Add `chat.followUpSuggestions` configuration in `~/.coc/config.yaml`

## Key Decisions
- Custom tool approach (not prompt engineering) — structured, reliable, uses existing timeline infra
- `CustomToolDefinition = unknown` — opaque type avoids coupling to SDK internals or Zod
- Tool gated to `task.type === 'chat'` only — no other AI flows receive the tool
- Suggestions intercepted in `onToolEvent` and emitted as dedicated SSE event (not raw `tool-complete`)
- Config uses `excludedTools` to disable — no pipeline-core changes needed for gating

## Conventions
- Factory pattern: `createSuggestFollowUpsTool()` returns the opaque tool definition
- Suggestions persisted on `ConversationTurn.suggestions` for reconnecting clients
- Tool call hidden from `ConversationTurnBubble` tool tree to avoid duplicate rendering
