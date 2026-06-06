# Chat Prompt History (Up/Down Arrow Navigation)

CoC's chat inputs let you walk back through prompts you've sent recently —
just like the **Up** / **Down** keys in a bash or PowerShell terminal. Press
**Up** to load your previous prompt; press **Up** again to go further back;
press **Down** to step forward toward whatever you were typing.

## Table of Contents

- [Where it works](#where-it-works)
- [Quick reference](#quick-reference)
- [How it behaves](#how-it-behaves)
  - [On an empty input](#on-an-empty-input)
  - [Stepping further back and forward](#stepping-further-back-and-forward)
  - [Editing a recalled prompt](#editing-a-recalled-prompt)
  - [Multi-line drafts](#multi-line-drafts)
  - [Slash commands and the model picker](#slash-commands-and-the-model-picker)
  - [Modifier keys](#modifier-keys)
- [What ends up in your history](#what-ends-up-in-your-history)
- [Privacy and scope](#privacy-and-scope)
- [Performance](#performance)
- [REST API](#rest-api)
- [Configuration](#configuration)
- [Sources](#sources)

---

## Where it works

History navigation is wired into every chat input on the dashboard:

| Input | Where you'll find it |
|-------|---------------------|
| **NewChatArea** | The empty-state chat box at the bottom of the **Activity** tab when no task is selected. |
| **FollowUpInputArea** | The bottom follow-up input when you're chatting inside an existing task. |
| **EnqueueDialog** | The prompt field in the **Enqueue AI Task** modal. |

The same workspace history feeds all three, so a prompt you typed in the
queue dialog yesterday is reachable from a follow-up input today.

## Quick reference

| Key | What it does |
|-----|--------------|
| **Up** | Walk backward through your recent prompts. The first press also saves whatever you'd typed as a "draft" to come back to. |
| **Down** | Walk forward toward your draft. Stepping past the most recent entry restores the draft and exits history mode. |
| **Tab** | Still accepts an inline ghost-text suggestion if one is showing — it does not collide with history. |
| **Esc** | Dismisses an inline ghost-text suggestion (does not exit history mode). |
| **Type / paste** | Editing the recalled text exits history mode; the edited text becomes your new draft. |

## How it behaves

### On an empty input

- **Up** loads your most recent prompt. The empty input you started with is
  remembered as the "draft", so a later **Down** can bring it back.
- **Down** is a no-op while you're on the draft — it never starts a fetch
  and never moves the caret unexpectedly.

### Stepping further back and forward

- Repeated **Up** presses walk one step further into the past each time.
  At the oldest entry, an extra **Up** is a quiet no-op (no error, the
  text just stays put).
- **Down** walks forward toward the draft. When you step past the most
  recent entry, your draft is restored and history mode exits.

### Editing a recalled prompt

If you start typing or pasting after recalling an old prompt, history mode
exits immediately. Your edited text becomes the new draft, and the next
**Up** restarts a fresh walk from there. You won't lose your edits to a
stray arrow press.

### Multi-line drafts

History only intercepts arrow keys at the edges of a non-empty input:

- **Up** is consumed only when the caret is at the start of the input.
- **Down** is consumed only when the caret is at the end of the input.

Anywhere else, the arrow key falls through to the editor, so multi-line
drafts can still be navigated with the keyboard the way you'd expect.

For an **empty** input, both keys always trigger history immediately.

### Slash commands and the model picker

If the slash-command (`/skill`) menu or the model picker (`/model`) is
open, **Up** / **Down** navigate that menu — they don't touch the prompt
history. Once the menu is dismissed, the arrows resume their history role.

### Modifier keys

History is **not** triggered when an arrow key is pressed with **Ctrl**,
**Cmd**, **Alt**, or **Shift**. Chat composers may handle selected modified
arrow shortcuts before history runs — for example focused new-chat/follow-up
inputs use **Shift+Up/Down** for effort selection, and focused new-chat inputs
use platform provider cycling (**Ctrl+Up/Down** on Windows/Linux,
**Cmd+Up/Down** on macOS). Other modified arrows fall through to the editor.

## What ends up in your history

A "prompt" is anything you yourself typed and sent. CoC collects them
from two places:

1. **Initial prompts** — the first message of every task you've kicked off.
2. **Follow-up turns** — every additional message you've sent inside an
   existing task.

Assistant replies are never part of your history. Empty or whitespace-only
messages are skipped. Identical text only appears once (the most recent
occurrence wins).

History is shown most-recent first. Up to **50** unique entries are
loaded per workspace.

## Privacy and scope

- History is **workspace-scoped**: a prompt you sent in repo A never
  shows up in repo B's input.
- Archived processes are excluded, and so are any individually
  deleted/archived conversation turns. Once you archive or delete
  something, it disappears from history on the next refresh.
- Nothing leaves your machine. The history endpoint reads straight from
  the local CoC SQLite database — there is no AI inference, no remote
  call, and no telemetry attached to the lookup.

## Performance

- The history list for a workspace is fetched **lazily** on the first
  arrow press, then cached for **60 seconds** in the browser. So pressing
  Up many times in a row is essentially free.
- The first press swallows the keystroke (your caret doesn't jump) and
  kicks off the fetch in the background. The very next press picks up
  the results.
- The cache is shared across all three input components, so switching
  between, say, the Enqueue dialog and the follow-up input on the same
  workspace doesn't trigger a refetch.
- The underlying SQL is a single `UNION ALL` over indexed columns on
  `processes` and `conversation_turns`, capped to a small fetch budget,
  so it's quick even for workspaces with thousands of prompts.

## REST API

Powered by a single endpoint that the SPA hook calls under the hood:

```
GET /api/prompt-history?workspaceId=<id>&limit=<n>
```

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `workspaceId` | yes | — | Missing or empty returns `{ items: [] }`. |
| `limit` | no | `50` | Clamped to `[1, 200]`. |

Response:

```json
{ "items": ["most recent prompt", "older prompt", "oldest prompt"] }
```

The handler is fully fail-safe: any thrown exception, a missing store
method, or a non-array response all collapse to `{ "items": [] }`.
A hiccup in history navigation will never break typing.

## Configuration

The feature is on by default. There are no preferences to flip — if
you don't press Up or Down, nothing changes. If you want to disable the
**inline ghost-text autocomplete** that lives alongside history, see the
separate [Prompt Autocomplete](./prompt-autocomplete.md) doc.

The 60-second client cache TTL and the 50-item fetch limit are baked
into the client hook. If you need different numbers, edit
`packages/coc/src/server/spa/client/react/hooks/useChatPromptHistory.ts`.

## Sources

- `packages/forge/src/process-store.ts` — `getRecentUserPrompts` interface
- `packages/forge/src/sqlite-process-store.ts` — `UNION ALL` of initial
  prompts and user follow-up turns; archive filter and dedup
- `packages/coc/src/server/processes/prompt-history-handler.ts` —
  `GET /api/prompt-history` REST handler
- `packages/coc-client/src/domains/prompt-history.ts` — typed client
- `packages/coc/src/server/spa/client/react/hooks/useChatPromptHistory.ts`
  — SPA hook: lazy fetch, 60 s cache, draft preservation, edit-exits-history,
  edge-cursor gating
- `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx`
- `packages/coc/src/server/spa/client/react/features/chat/NewChatArea.tsx`
- `packages/coc/src/server/spa/client/react/features/chat/FollowUpInputArea.tsx`
