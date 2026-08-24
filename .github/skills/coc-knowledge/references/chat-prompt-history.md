# Chat Prompt History (Up/Down Arrow Navigation)

Terminal-style recall of recently sent prompts in CoC chat inputs. **Up** walks backward through history, **Down** walks forward toward the draft. Wired into `NewChatArea`, `FollowUpInputArea`, and `EnqueueDialog`; all three share one workspace-scoped history and one client cache, so a prompt typed in the queue dialog is reachable from a follow-up input.

Inline ghost-text suggestion in the same inputs is a separate feature — see [prompt-autocomplete.md](prompt-autocomplete.md). Tab still accepts a ghost suggestion and Escape still dismisses one; neither collides with history mode.

## Navigation behavior

- **First Up** saves the current text (including empty) as the draft, then loads the most recent prompt. Each further Up steps one entry back; at the oldest entry an extra Up is a quiet no-op.
- **Down** steps forward; stepping past the most recent entry restores the draft and exits history mode. Down while still on the draft is a no-op — it starts no fetch and does not move the caret.
- **Typing or pasting** after a recall exits history mode immediately; the edited text becomes the new draft and the next Up restarts the walk from there.

### Key interception rules

On a **non-empty** input, history only claims arrows at the edges: Up is consumed only with the caret at the start, Down only with the caret at the end. Anywhere else the key falls through to the editor so multi-line drafts stay navigable. On an **empty** input both keys trigger history immediately.

While the slash-command (`/skill`) or model picker (`/model`) menu is open, Up/Down navigate that menu instead.

History never triggers on an arrow pressed with **Ctrl**, **Cmd**, **Alt**, or **Shift**. Composers may claim specific modified arrows ahead of history: Shift+Up/Down for effort selection in new-chat and follow-up inputs, and provider cycling in new-chat inputs (Ctrl+Up/Down on Windows/Linux, Cmd+Up/Down on macOS). Other modified arrows fall through to the editor.

## What the history contains

A prompt is anything the user typed and sent, collected from two sources: the initial prompt of each task, and user follow-up turns inside existing tasks. Assistant replies are never included. Empty/whitespace-only messages are skipped, and identical text appears once (most recent occurrence wins). Ordered most-recent first, up to **50** unique entries per workspace.

Scope and privacy: history is workspace-scoped, so a prompt sent in repo A never appears in repo B. Archived processes and individually deleted/archived conversation turns are excluded and disappear on the next refresh. The endpoint reads the local CoC SQLite database directly — no AI inference, no remote call, no telemetry.

## Performance

The list is fetched lazily on the first arrow press and cached **60 s** in the browser, shared across all three inputs, so repeated Up presses and switching between inputs on the same workspace cost nothing. The first press swallows the keystroke and kicks off the fetch in the background; the next press picks up the results. The backing SQL is a single `UNION ALL` over indexed columns on `processes` and `conversation_turns`, capped to a small fetch budget.

## REST API

```
GET /api/prompt-history?workspaceId=<id>&limit=<n>
```

`workspaceId` is required — missing or empty returns `{ items: [] }`. `limit` defaults to `50`, clamped to `[1, 200]`. Response is `{ "items": ["most recent", …, "oldest"] }`.

The handler is fail-safe: a thrown exception, a missing store method, or a non-array response all collapse to `{ "items": [] }`, so a history hiccup cannot break typing.

## Configuration

The feature is on by default and has no preferences. The 60 s cache TTL and 50-item fetch limit are constants in `useChatPromptHistory.ts`.

## Sources

- `packages/forge/src/process-store.ts` — `getRecentUserPrompts` interface
- `packages/forge/src/sqlite-process-store.ts` — `UNION ALL` of initial prompts and user follow-up turns; archive filter and dedup
- `packages/coc/src/server/processes/prompt-history-handler.ts` — `GET /api/prompt-history`
- `packages/coc-client/src/domains/prompt-history.ts` — typed client
- `.../spa/client/react/hooks/useChatPromptHistory.ts` — lazy fetch, 60 s cache, draft preservation, edit-exits-history, edge-cursor gating
- `.../spa/client/react/queue/EnqueueDialog.tsx`, `.../features/chat/NewChatArea.tsx`, `.../features/chat/FollowUpInputArea.tsx`
