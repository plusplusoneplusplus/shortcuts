# CoC Chat — Reference

Unified CLI for querying and submitting CoC conversation process records via REST API.

**Prerequisite:** A running CoC server (`coc serve`) is required for all commands.

## Script: `scripts/coc_chat.py`

```bash
python <skill-dir>/scripts/coc_chat.py <command> [args...]
```

## Query Commands

| Command | Description |
|---------|-------------|
| `workspaces` | List all registered workspaces |
| `resolve-workspace <name-or-path>` | Find workspace by name, path substring, or ID |
| `list <workspaceId> [options]` | List processes from a workspace |
| `list-all [options]` | List processes across all workspaces |
| `show <workspaceId> <processId>` | Show full process metadata + conversation preview |
| `conversation <workspaceId> <processId>` | Print full conversation turns (no truncation) |
| `search <keyword> [--workspace <id>]` | Search titles/previews |
| `search-content <keyword> [--workspace <id>]` | Search inside conversation content (heavier) |
| `tools <workspaceId> <processId>` | Summarize tool usage in a process |
| `tokens <workspaceId> <processId>` | Show per-turn token usage breakdown |
| `stats [workspaceId]` | Aggregate counts by status, type, and workspace |
| `find-process <processId>` | Cross-workspace lookup by process ID |
| `history [options]` | Show completed/failed task history |
| `token-usage [--days N]` | Show aggregated per-day per-model token usage |
| `output <processId>` | Show raw markdown output file |

## Submit Commands

| Command | Description |
|---------|-------------|
| `chat <prompt> [options]` | Submit a chat task (ask/plan/autopilot) |
| `follow-up <processId> <message>` | Send a follow-up message to an existing conversation |
| `run-workflow <workflowPath> [key=val...]` | Run a YAML workflow |
| `run-script <script>` | Run a shell script |
| `status <processId>` | Check process status and result |
| `stream <processId>` | Stream SSE output in real time (Ctrl+C to stop) |
| `models` | List available AI models |
| `queue` | Show current queue |

## Common Options

| Flag | Description |
|------|-------------|
| `--base-url <url>` | Server URL (default: `http://localhost:4000`, or `COC_SERVER_URL` env) |
| `--workspace <id>` | Workspace ID (e.g. `ws-1a2b3c`) |
| `--workdir <path>` | Working directory for the AI session |
| `--model <model>` | AI model override |
| `--mode <mode>` | Chat mode: `ask`, `plan`, `autopilot` (default: `autopilot`) |
| `--timeout <seconds>` | Execution timeout |
| `--priority <p>` | Task priority: `high`, `normal`, `low` |
| `--json` | Output raw JSON response |

### Filter Options (for `list` / `list-all`)

`--status <s>`, `--type <t>`, `--since <iso>`, `--limit <n>` (default 20), `--title <keyword>`.

### Environment

`COC_SERVER_URL` overrides the default server URL (`http://localhost:4000`).

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

For raw markdown output (if available):
```bash
python <skill-dir>/scripts/coc_chat.py output <processId>
```

### 4. Search Across Conversations

`search` checks titles/previews (fast, index-only). `search-content` scans full conversation bodies (slower — fetches each process).

```bash
python <skill-dir>/scripts/coc_chat.py search "keyword"
python <skill-dir>/scripts/coc_chat.py search-content "keyword" --workspace <workspaceId>
```

### 5. Analyze Tool and Token Usage

```bash
python <skill-dir>/scripts/coc_chat.py tools <workspaceId> <processId>
python <skill-dir>/scripts/coc_chat.py tokens <workspaceId> <processId>
python <skill-dir>/scripts/coc_chat.py token-usage --days 7
```

### 6. Submit Tasks

```bash
# Submit a chat task
python <skill-dir>/scripts/coc_chat.py chat "Explain the workflow engine" --workspace ws-1a2b3c --mode ask

# Stream the output
python <skill-dir>/scripts/coc_chat.py stream queue_<taskId>

# Send a follow-up
python <skill-dir>/scripts/coc_chat.py follow-up queue_<taskId> "Show me the DAG executor code"

# Check final status
python <skill-dir>/scripts/coc_chat.py status queue_<taskId>

# Run a workflow
python <skill-dir>/scripts/coc_chat.py run-workflow /path/to/workflow --workdir /path/to/repo key=value
```

### 7. View History and Queue

```bash
python <skill-dir>/scripts/coc_chat.py history --workspace <wsId>
python <skill-dir>/scripts/coc_chat.py history --type chat
python <skill-dir>/scripts/coc_chat.py queue
```

## Common Tasks

### Summarize a Conversation

1. Run `show` for overview, then `conversation` for full turns.
2. Extract: title & metadata, key topics, decisions, action items, unresolved questions.
3. For multiple conversations, add a **Cross-Cutting Themes** section.
4. Suggest exactly **3 follow-up actions** as short imperative phrases.

### Find Related Chats

Use `find-process` for cross-workspace lookup. Use `--type` to group pipeline executions with their item processes.

### Output Format

```
## <Title or "Untitled">
**Status:** <status> | **Type:** <type> | **Date:** <startTime> | **Turns:** <count>

<content or summary>
```

Separate multiple conversations with `---` dividers.

## REST API Reference

Default base URL: `http://localhost:4000`. All endpoints under `/api`.

### Enqueue a Task

**`POST /api/queue`** (alias: `POST /api/queue/tasks`)

```json
{
  "type": "chat | run-workflow | run-script",
  "priority": "normal",
  "payload": { ... },
  "config": { "model": "gpt-4", "timeoutMs": 1800000, "reasoningEffort": "high" },
  "displayName": "optional name"
}
```

Response: **201** `{ task: { id, status, processId, type, ... } }`

### Chat Payload

```json
{
  "kind": "chat",
  "mode": "autopilot",
  "prompt": "Your prompt here",
  "workspaceId": "ws-1a2b3c",
  "workingDirectory": "/path/to/repo",
  "context": { "files": [...], "blocks": [...], "skills": [...] },
  "beforeScript": "npm test",
  "afterScript": "npm run lint",
  "images": ["data:image/png;base64,..."]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `kind` | yes | Must be `"chat"` |
| `mode` | no | `ask` (read-only), `plan` (read-only + plan files), `autopilot` (full access). Default: `autopilot` |
| `prompt` | yes | The user message |
| `workspaceId` | no | Resolved to `workingDirectory` via registered workspaces |
| `workingDirectory` | no | Explicit working directory (takes precedence over `workspaceId`) |
| `context.files` | no | File paths to include as context |
| `context.blocks` | no | Inline text blocks to inject |
| `context.skills` | no | Skill names to activate |
| `processId` | no | Existing process ID for follow-ups |
| `beforeScript` | no | Shell command to run before AI task |
| `afterScript` | no | Shell command to run after AI task |
| `images` | no | Base64 data-URL images |

### Run-Workflow Payload

```json
{ "kind": "run-workflow", "workflowPath": "/path/to/dir", "workingDirectory": "/path/to/repo", "model": "gpt-4", "params": { "key": "value" } }
```

### Run-Script Payload

```json
{ "kind": "run-script", "script": "npm test -- --coverage", "workingDirectory": "/path/to/repo" }
```

### Follow-Up Message

**`POST /api/processes/:id/message?workspace=<wsId>`**

```json
{ "content": "Follow-up text", "mode": "autopilot", "deliveryMode": "enqueue" }
```

Response: **202** `{ processId, turnIndex }`. Returns **410** if session expired.

### Process Retrieval

**`GET /api/processes/:id?workspace=<wsId>`** — full process record.

Response: `{ process: {...}, children: [...], total: N }`

**`GET /api/processes/summaries?workspace=<wsId>&limit=20`** — lightweight summaries.

Response: `{ summaries: [...], total: N, limit: N, offset: N }`

Supported query params: `workspace`, `status` (comma-separated), `type`, `since` (ISO date), `limit`, `offset`, `exclude` (`conversation`, `toolCalls`).

### SSE Streaming

**`GET /api/processes/:id/stream?workspace=<wsId>`**

| Event | Data | Description |
|-------|------|-------------|
| `chunk` | `{ content }` | Streaming text |
| `tool-start` | `{ toolName, toolCallId }` | Tool started |
| `tool-complete` | `{ toolCallId, result }` | Tool done |
| `tool-failed` | `{ toolCallId, error }` | Tool failed |
| `token-usage` | `{ tokenUsage }` | Per-turn tokens |
| `status` | `{ status }` | Status change |
| `done` | `{ status, duration }` | Completed |
| `suggestions` | `{ suggestions }` | Follow-up suggestions |
| `heartbeat` | `{}` | Keep-alive |

### Queue Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue?repoId=<wsId>` | List queued tasks |
| `GET` | `/api/queue/stats` | Queue statistics |
| `GET` | `/api/queue/models` | Available AI models |
| `GET` | `/api/queue/history?repoId=<wsId>&type=<t>` | Completed/failed task history |
| `POST` | `/api/queue/:id/cancel` | Cancel a task |
| `POST` | `/api/queue/pause` / `resume` | Pause/resume queue |
| `POST` | `/api/queue/bulk` | Bulk enqueue (max 100) |

### Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats` | Process counts by status and workspace |
| `GET` | `/api/stats/token-usage?days=N` | Aggregated per-day per-model token usage |

### Process Output

**`GET /api/processes/:id/output?workspace=<wsId>`** — raw markdown conversation output file.

Response: `{ content: "...", format: "markdown" }`

## Data Structures

### Process Summary (from summaries endpoint)

```json
{
  "id": "clarification-1-1711234567890",
  "status": "completed",
  "type": "clarification",
  "startTime": "2026-03-23T10:15:00.000Z",
  "endTime": "2026-03-23T10:17:30.000Z",
  "promptPreview": "Explain how...",
  "title": "Workflow Engine Architecture",
  "workspaceId": "ws-1a2b3c",
  "workspaceName": "my-project",
  "workingDirectory": "/path/to/repo"
}
```

### Full Process (from process endpoint)

```json
{
  "id": "...", "type": "clarification", "status": "completed",
  "title": "...", "fullPrompt": "...",
  "startTime": "...", "endTime": "...", "result": "...",
  "conversationTurns": [
    {
      "role": "user|assistant", "content": "...", "timestamp": "...",
      "turnIndex": 0, "toolCalls": [...], "tokenUsage": { "inputTokens": 0, "outputTokens": 0 },
      "suggestions": [...], "images": [...]
    }
  ],
  "metadata": { "type": "...", "workspaceId": "..." },
  "backend": "copilot-sdk", "sdkSessionId": "...",
  "workingDirectory": "...", "tokenLimit": 200000, "currentTokens": 45000
}
```

### Status Values

`queued` | `running` | `cancelling` | `completed` | `failed` | `cancelled`

### Process Types

`clarification` | `pipeline-execution` | `pipeline-item` | `code-review` | `discovery` | ...
