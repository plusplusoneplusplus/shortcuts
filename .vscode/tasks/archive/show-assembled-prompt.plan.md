# Plan: Display Assembled Prompt Sent to Copilot SDK

## Problem

When a user types `/skill-name` in the chat input, the slash command is:
1. Parsed and **stripped** from the displayed user message bubble
2. Transformed into skill directives by `applySkillContent()` in `queue-executor-bridge.ts`

The assembled prompt (with skill content prepended) is never shown to the user. This makes it hard to understand what was actually sent to Copilot, and the original `/skill-name` tokens disappear from the chat history entirely.

## Proposed Approach

Two complementary changes:

1. **Show skill badges on user message bubbles** — Add `skillNames` to `ClientConversationTurn` so the UI can display which skills were invoked alongside each user message.
2. **Show the assembled prompt in a collapsible "Prompt sent to Copilot" section** — After `applySkillContent()` builds the full prompt, emit it back and store it in the turn so users can expand and read it.

Start with (1) as the minimal valuable change; (2) is optional/additive.

## Data Flow

```
User types: "summarize this /my-skill"
    ↓ parseSlashCommands()           [slash-command-parser.ts]
    → skills: ["my-skill"], prompt: "summarize this"
    ↓ POST /api/queue                [RepoChatTab.tsx]
    → { prompt, skillNames: ["my-skill"] }
    ↓ applySkillContent()            [queue-executor-bridge.ts]
    → "Use my-skill skill when available\n\nsummarize this"
    ↓ CopilotSDKService.sendMessage()
```

Currently the user message bubble only stores/shows `"summarize this"`.

## Tasks

### T1 — Extend `ClientConversationTurn` with `skillNames`

**File:** `packages/coc/src/server/spa/client/react/types/dashboard.ts`

Add optional field:
```ts
skillNames?: string[];   // skills invoked via /slash in this turn
```

### T2 — Pass `skillNames` into the user turn when enqueuing

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

When building the optimistic user turn (around line 558), populate `skillNames` from `parsedSkills`.

### T3 — Render skill badges in `ConversationTurnBubble`

**File:** `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

For user role turns with `skillNames`, render small badge chips (e.g., `/my-skill`) above or below the message content. Style consistently with existing tool-call badges.

### T4 (optional) — Store & display full assembled prompt

**File:** `packages/coc/src/server/spa/client/react/types/dashboard.ts`

Add optional field:
```ts
assembledPrompt?: string;  // full prompt after skill content prepended
```

**Files:** `packages/coc/src/server/queue-executor-bridge.ts`, server-side turn storage, `ConversationTurnBubble.tsx`

After `applySkillContent()`, store the assembled prompt in the turn and emit it to the client. Render as a collapsible `<details>` block labeled "Prompt sent to Copilot".

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/slash-command-parser.ts` | Strips `/skill` tokens, returns `skillNames` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Builds optimistic user turn, enqueues task |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Renders chat bubbles |
| `packages/coc/src/server/spa/client/react/types/dashboard.ts` | `ClientConversationTurn` type |
| `packages/coc/src/server/queue-executor-bridge.ts` | `applySkillContent()`, `executeWithAI()` |
| `packages/coc-server/src/task-types.ts` | `ChatPayload` (has `skillNames`) |

## Acceptance Criteria

- [ ] User message bubble shows `/skill-name` badge(s) when a slash skill was used
- [ ] Badge renders even on historical turns loaded from the server
- [ ] (Optional) Collapsible section shows full assembled prompt including skill directives
- [ ] No regression in chat behavior when no slash commands are used
