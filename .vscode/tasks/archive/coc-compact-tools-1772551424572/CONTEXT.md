# Context: Compact Tool Call Display in CoC Chat

## User Story
The CoC chat conversation renders each tool call as its own full-height row. When an agent
fires many consecutive `view`, `glob`, `grep`, `edit`, or `powershell` calls, the chat becomes
a wall of identical rows that is hard to skim. The user wants a display setting with a
"compact level" where consecutive tools of the same kind are grouped into a single collapsed
row (e.g. "4 read operations (glob×1, view×3)"), making the conversation much more
space-efficient.

## Goal
Add a `toolCompactness` display setting (0=Full, 1=Compact, 2=Minimal) to the CoC SPA
that collapses consecutive same-category tool calls into a single expandable summary row,
reducing vertical noise without losing any detail.

## Tool Categories
| Category | Tools |
|----------|-------|
| `read`   | `view`, `glob`, `grep` |
| `write`  | `edit`, `create` |
| `shell`  | `powershell`, `shell` |

All other tools (`task`, `skill`, `report_intent`, etc.) are non-groupable and always break
an active group. A run of exactly 1 groupable tool is never collapsed.

## Commit Sequence
1. Add tool grouping types, classification, and algorithm
2. Add `toolCompactness` display setting (server config + client hook)
3. Add compactness level toggle to display settings UI
4. Add `ToolCallGroupView` component
5. Wire compact grouping into `ConversationTurnBubble`

## Key Decisions
- Grouping is a **rendering-layer transformation only** — no data model changes
- Groups form only within the **same category** and the **same parent** (no cross-task-boundary grouping)
- A run of **exactly 1** tool is never collapsed regardless of compactness level
- **`task` tools are never grouped** even when consecutive — they always render individually
- Commit 5 is the sole activation point; commits 1–4 add code that is not yet invoked
- Streaming processes force groups to stay **expanded** until the stream ends
- `ToolCallGroupView` reuses the existing `renderToolTree` function reference from
  `ConversationTurnBubble` to avoid duplicating child-render logic

## Conventions
- New pure-logic file: `processes/toolGroupUtils.ts` (no React deps)
- New component: `processes/ToolCallGroupView.tsx`
- CSS classes mirror `tool-call-card` / `tool-call-header` naming from `ToolCallView.tsx`
- Tests in `test/spa/processes/` following existing Vitest + jsdom pattern
- `DisplaySettings` extended in `useDisplaySettings.ts`; server field added to `config/schema.ts`,
  `config.ts`, and `server/admin-handler.ts` in `packages/coc-server`
