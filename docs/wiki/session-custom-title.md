# Custom Session Titles

Rename any CoC session to something memorable. Custom titles persist across
page refreshes, repo switches, and server restarts, and appear everywhere the
session is shown.

## Renaming a Session

There are two ways to set a custom title:

1. **Double-click the session title** in the chat header.
2. **Right-click a session in the sidebar** and choose **Rename**.

A rename dialog appears with the current title pre-filled. Type a new title
(up to 80 characters) and press **Enter** to save, or **Escape** to cancel.

To clear a custom title and restore the auto-generated one, open the rename
dialog and submit an empty value.

## Sidebar Preview

Each session in the sidebar shows two lines:

- **Title** — the custom title if set, otherwise the AI-generated title.
- **Preview** — the most recent **user** message in the conversation
  (truncated to 120 characters, with code blocks, links, and images
  stripped). Earlier user messages and assistant replies are ignored so
  the preview reflects what you most recently asked.

## How It Works

### Storage

Custom titles live in the per-repo SQLite process store
(`~/.coc/repos/<workspaceId>/processes.db`) on the `processes` table:

| Column                 | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `custom_title`         | User-set title (`NULL` means "use the auto title").    |
| `title`                | AI-generated title (unchanged by renames).             |
| `last_message_preview` | Cached preview of the latest user turn.                |

The preview cache is updated incrementally in `appendConversationTurn`: only
turns with `role === 'user'` overwrite `last_message_preview`, so an assistant
reply never clobbers the user-facing preview. Schema version **17** adds a
one-time backfill (`migrateV16toV17`) that populates the column for sessions
that existed before the cache was introduced.

### Server API

| Endpoint                                          | Behaviour                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/processes/:id` with `{ customTitle }` | Trims to 80 chars, persists to SQLite, and pushes both `displayName` and `customTitle` onto the in-memory queue task so live snapshots stay consistent.  |
| `GET /api/workspaces/:id/history`                 | Returns `customTitle` and `lastMessagePreview` on each item. The handler uses `exclude: ['conversation']` so it no longer fetches every turn (was N+1).  |
| `GET /api/queue` (and friends)                    | `serializeTask` / `serializeTaskSummary` now emit `customTitle`, `lastMessagePreview`, and `title` alongside `displayName`.                              |

### Client

`ChatDetail.tsx` seeds every `setTask` call with `title`, `customTitle`, and
`lastMessagePreview`, and prefers `customTitle` when computing `displayName`.
This means the chat header shows the right title on the **first frame** after
a refresh or repo switch — no flash of the AI title and no wait for the
WebSocket `PROCESS_UPDATED` event.

The rename dialog disables browser autofill and password-manager prompts
(`autoComplete="off"`, `data-form-type="other"`, `data-1p-ignore`, etc.) so
Chrome no longer offers to "Save identity card?" when you rename a session.

### Persistence Across Restarts

On server start, the queue rebuilds in-memory tasks from the SQLite store via
`processToQueuedTask`, which copies `customTitle` into both `displayName` and
the new `customTitle` field. Combined with the serializer changes above, the
custom title survives a full process restart with no extra cache.
