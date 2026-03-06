# Context: CoC Chat Tab UX Improvements

## User Story
The CoC dashboard's chat tab shows conversation history sorted by creation time, but when a follow-up message is queued on an older conversation, it doesn't move to the top. Additionally, as the chat list grows, there's no way to tell which conversations have unread responses. The user wants recently-active conversations to surface and unread indicators to help quickly find new responses.

## Goal
Add last-activity sorting and unread message indicators to the CoC dashboard chat sidebar, so users can quickly find and resume active conversations.

## Commit Sequence
1. Server-side `lastActivityAt` enrichment and re-sort
2. Client-side `lastActivityAt` type, mapping, and display
3. `useChatReadState` localStorage hook
4. Unread indicators UI and integration

## Key Decisions
- `lastActivityAt` is derived from the last conversation turn's timestamp in `enrichChatTasks` — no schema changes, works retroactively
- Enrichment is moved before sorting so the sort can use the enriched `lastActivityAt`
- Unread state uses client-side localStorage (key: `coc:chatReadState`) — sufficient for single-browser use
- First visit = all sessions appear read (no false unread flood)
- Unread style: blue dot (●) + bold title, matching Slack/Discord pattern

## Conventions
- Hooks follow the `usePinnedChats` pattern (useState + useRef + useEffect)
- Server timestamps are numeric epoch ms; client converts to ISO strings in `toSessionItem()`
- Sidebar props are optional for backward compatibility
- Tests: Vitest for packages/coc/ (not Mocha)
