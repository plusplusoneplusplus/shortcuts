# CoC Chat — Query Reference

Read, search, and analyze CoC conversation process records via the CoC server REST API.

## Script: `scripts/coc_chat.py`

```bash
python <skill-dir>/scripts/coc_chat.py <command> [args...]
```

### Commands

| Command | Description |
|---------|-------------|
| `workspaces` | List all registered workspaces with chat counts |
| `resolve-workspace <name-or-path>` | Find workspace by name, path substring, or ID |
| `list <workspaceId> [options]` | List processes from a workspace index |
| `list-all [options]` | List processes across all workspaces |
| `show <workspaceId> <processId>` | Show full process metadata + conversation preview |
| `conversation <workspaceId> <processId>` | Print full conversation turns (no truncation) |
| `search <keyword> [--workspace <id>]` | Search titles/previews across indices (index-only) |
| `search-content <keyword> [filters]` | Full-text FTS5 search across conversation turns (server-side) |
| `tools <workspaceId> <processId>` | Summarize tool usage in a process |
| `tokens <workspaceId> <processId>` | Show per-turn token usage breakdown |
| `stats [workspaceId]` | Aggregate counts by status and type |
| `find-process <processId>` | Cross-workspace lookup by process ID |

### Filter Options (for `list` / `list-all`)

`--status <s>`, `--type <t>`, `--since <iso>`, `--limit <n>` (default 20), `--title <keyword>`.

### Environment

`COC_SERVER_URL` overrides the default `http://localhost:4000` server address.

## Instructions

### 1. Identify the Target Workspace

```bash
python <skill-dir>/scripts/coc_chat.py workspaces
python <skill-dir>/scripts/coc_chat.py resolve-workspace "my-project"
```

If the user says "this repo" or "current project", run `resolve-workspace` with the current working directory path.

### 2. Browse and Filter Processes

```bash
python <skill-dir>/scripts/coc_chat.py list <workspaceId>
python <skill-dir>/scripts/coc_chat.py list <workspaceId> --status completed --limit 10
python <skill-dir>/scripts/coc_chat.py list <workspaceId> --title "workflow" --since 2026-03-01
python <skill-dir>/scripts/coc_chat.py list-all --type clarification --limit 5
```

### 3. Read a Full Process or Conversation

`show` gives metadata + truncated conversation. `conversation` gives full untruncated turns.

```bash
python <skill-dir>/scripts/coc_chat.py show <workspaceId> <processId>
python <skill-dir>/scripts/coc_chat.py conversation <workspaceId> <processId>
```

For very large conversations, use the `conversation` command for full untruncated output.

### 4. Search Across Conversations

`search` filters summaries by title/promptPreview client-side (fast, index-only). `search-content` uses the server's FTS5 full-text index over conversation turn content — single round trip, returns snippets with the matched text.

```bash
python <skill-dir>/scripts/coc_chat.py search "keyword"
python <skill-dir>/scripts/coc_chat.py search-content "keyword" --workspace <workspaceId>
python <skill-dir>/scripts/coc_chat.py search-content "DAG executor" --status completed --limit 50
```

### 5. Analyze Tool and Token Usage

```bash
python <skill-dir>/scripts/coc_chat.py tools <workspaceId> <processId>
python <skill-dir>/scripts/coc_chat.py tokens <workspaceId> <processId>
```

## Common Tasks

### Summarize a Conversation

1. Run `show` for overview, then `conversation` for full turns.
2. Extract: title & metadata, key topics, decisions, action items, unresolved questions.
3. For multiple conversations, add a **Cross-Cutting Themes** section.
4. Suggest exactly **3 follow-up actions** as short imperative phrases.

### Find Related Chats

Use `parentProcessId` from the index for parent/child relationships. Use `--type` to group pipeline executions with their item processes.

### Output Format

```
## <Title or "Untitled">
**Status:** <status> | **Type:** <type> | **Date:** <startTime> | **Turns:** <count>

<content or summary>
```

Separate multiple conversations with `---` dividers.

## Storage

Process records are stored in SQLite (`~/.coc/processes.db`) and accessed via the REST API. The `workspaceId` is a stable hash of the workspace root path, prefixed `ws-`.

## Data Structures

### Process Summary Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Process identifier |
| `workspaceId` | string | Workspace hash |
| `status` | string | `queued\|running\|cancelling\|completed\|failed\|cancelled` |
| `type` | string | `clarification\|pipeline-execution\|pipeline-item\|code-review\|...` |
| `startTime` | ISO string | Start timestamp |
| `endTime` | ISO string | End timestamp |
| `promptPreview` | string | Truncated prompt |
| `title` | string | Process title |
| `parentProcessId` | string? | Parent process link |

### Conversation Turn Fields

| Field | Type | Description |
|-------|------|-------------|
| `role` | `"user" \| "assistant"` | Speaker |
| `content` | string | Message text |
| `timestamp` | ISO string | When the turn was created |
| `turnIndex` | number | Zero-based position |
| `toolCalls` | array | Tool invocations (name, args, result, status) |
| `timeline` | array | Chronological events (content chunks + tool lifecycle) |
| `suggestions` | string[] | Follow-up suggestions (assistant turns only) |
| `tokenUsage` | object | `{ inputTokens, outputTokens }` per-turn counts |
| `images` | string[] | Base64 data-URL strings for user-attached images |
| `historical` | boolean | True for turns from a prior session during cold resume |
