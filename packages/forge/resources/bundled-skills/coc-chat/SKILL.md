---
name: coc-chat
description: Access, search, analyze, and submit CoC conversation process records via REST API to a running CoC server (chat, run-workflow, run-script, follow-up, stream, search, list, stats). Use when the user asks to find, read, search, summarize, analyze, submit, or send tasks to CoC.
metadata:
  version: "0.0.1"
---

# CoC Chat

Unified CLI for querying and submitting CoC conversation process records. All commands communicate with a running `coc serve` instance via REST API.

```bash
python <skill-dir>/scripts/coc_chat.py <command> [args...]
```

Read [references/reference.md](references/reference.md) for the full command reference, REST API schemas, SSE streaming protocol, and examples.

## Quick Reference

| Goal | Command |
|------|---------|
| List workspaces | `workspaces` |
| List recent chats | `list <wsId> --limit 10` |
| Read a conversation | `show <wsId> <pid>` or `conversation <wsId> <pid>` |
| Search chats | `search <keyword>` or `search-content <keyword>` |
| Aggregate stats | `stats [wsId]` |
| Token usage report | `token-usage --days 7` |
| Task history | `history --workspace <wsId>` |
| Submit a chat | `chat <prompt> --workspace <wsId>` |
| Stream output | `stream <processId>` |
| Send follow-up | `follow-up <processId> <message>` |
| Run a workflow | `run-workflow <path> --workdir <dir>` |
| Check status | `status <processId>` |

### Common Options

| Flag | Description |
|------|-------------|
| `--base-url <url>` | Server URL (default: `http://localhost:4000`, or `COC_SERVER_URL` env) |
| `--workspace <id>` | Workspace ID (e.g. `ws-1a2b3c`) |
| `--json` | Output raw JSON response |
| `--limit <n>` | Max results (default 20) |

`<skill-dir>` is the directory containing this SKILL.md file.
