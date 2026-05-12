# CoC Chat — Submit Reference

Submit tasks to a running CoC server (`coc serve`) via REST API.

## Script: `scripts/coc_submit.py`

```bash
python <skill-dir>/scripts/coc_submit.py <command> [args...]
```

### Commands

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

### Common Options

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

### Typical Workflow

```bash
# 1. Submit a chat task
python <skill-dir>/scripts/coc_submit.py chat "Explain the workflow engine" --workspace ws-1a2b3c --mode ask

# 2. Stream the output
python <skill-dir>/scripts/coc_submit.py stream queue_<taskId>

# 3. Send a follow-up
python <skill-dir>/scripts/coc_submit.py follow-up queue_<taskId> "Show me the DAG executor code"

# 4. Check final status
python <skill-dir>/scripts/coc_submit.py status queue_<taskId>
```

## REST API Reference

Default base URL: `http://localhost:4000`. All endpoints under `/api`.

### Enqueue a Task

**`POST /api/queue`**

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

Shorthand: `prompt`, `workingDirectory`, `workspaceId`, `images` can be top-level and auto-merge into `payload`.

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

### Process Status

**`GET /api/processes/:id?workspace=<wsId>`** — full process record.

**`GET /api/processes/summaries?workspace=<wsId>&limit=20`** — lightweight index entries.

### SSE Streaming

**`GET /api/processes/:id/stream?workspace=<wsId>`**

| Event | Data | Description |
|-------|------|-------------|
| `chunk` | `{ content }` | Streaming text |
| `tool-start` | `{ toolName, toolCallId }` | Tool started |
| `tool-complete` | `{ toolCallId, result }` | Tool done |
| `tool-failed` | `{ toolCallId, error }` | Tool failed |
| `token-usage` | `{ tokenUsage }` | Per-turn tokens |
| `status` | `{ status }` | Status change (final status arrives here) |
| `done` | `{ processId }` | Stream ended (status came on the preceding `status` event) |
| `suggestions` | `{ suggestions }` | Follow-up suggestions |
| `heartbeat` | `{}` | Keep-alive |

### Queue Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue?repoId=<wsId>` | List queued tasks |
| `GET` | `/api/queue/stats` | Queue statistics |
| `GET` | `/api/queue/models` | Available AI models |
| `POST` | `/api/queue/:id/cancel` | Cancel a task |
| `POST` | `/api/queue/pause` / `resume` | Pause/resume queue |
| `POST` | `/api/queue/bulk` | Bulk enqueue (max 100) |
