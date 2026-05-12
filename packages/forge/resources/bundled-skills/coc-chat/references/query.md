# CoC Chat — Query Reference

Read, search, and analyze CoC conversation process records stored on disk.

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

`COC_DATA_DIR` overrides the default `~/.coc/` data directory.

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

For very large conversations, read the raw JSON directly:
`~/.coc/repos/<workspaceId>/processes/<sanitizedId>.json`

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

### 6. Access Pruned (Archived) Processes

Older processes beyond the 500-process cap are moved to `pruned/YYYY-MM/`:

```bash
ls ~/.coc/repos/<workspaceId>/processes/pruned/
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

## On-Disk Layout

```
~/.coc/
├── workspaces.json                          # Array of WorkspaceInfo objects
├── repos/
│   ├── <workspaceId>/
│   │   └── processes/
│   │       ├── index.json                   # Array of ProcessIndexEntry (lightweight)
│   │       ├── <sanitizedId>.json           # Full StoredProcessEntry per process
│   │       └── pruned/YYYY-MM/              # Archived processes
│   └── _default/processes/                  # Used when workspaceId is empty
```

- **workspaceId** — stable hash of workspace root path, prefixed `ws-` (e.g. `ws-1a2b3c`).
- **sanitizedId** — process `id` with non-alphanumeric chars (except `-`/`_`) replaced by `_`.

## Data Structures

### workspaces.json

```json
[{ "id": "ws-1a2b3c", "name": "my-project", "rootPath": "/path/to/repo", "remoteUrl": "https://..." }]
```

### index.json (per workspace)

Lightweight entries (no conversation bodies):

```json
[{
  "id": "clarification-1-1711234567890", "workspaceId": "ws-1a2b3c",
  "status": "completed", "type": "clarification",
  "startTime": "2026-03-23T10:15:00.000Z", "endTime": "2026-03-23T10:17:30.000Z",
  "promptPreview": "Explain how...", "title": "Workflow Engine Architecture",
  "duration": 150000, "parentProcessId": null
}]
```

Fields: `id`, `workspaceId`, `status` (`queued|running|cancelling|completed|failed|cancelled`), `type` (`clarification|pipeline-execution|pipeline-item|code-review|discovery|...`), `startTime`, `endTime`, `promptPreview`, `title`, `parentProcessId`.

### Individual Process File (`<sanitizedId>.json`)

```json
{
  "workspaceId": "ws-1a2b3c",
  "process": {
    "id": "...", "type": "clarification", "status": "completed",
    "title": "...", "fullPrompt": "...",
    "startTime": "...", "endTime": "...", "result": "...",
    "conversationTurns": [ { "role": "user|assistant", "content": "...", "timestamp": "...", "turnIndex": 0, "toolCalls": [...], "timeline": [...], "tokenUsage": {...} } ],
    "metadata": { "type": "...", "workspaceId": "..." },
    "backend": "copilot-sdk", "sdkSessionId": "...",
    "workingDirectory": "...", "tokenLimit": 200000, "currentTokens": 45000
  }
}
```

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
