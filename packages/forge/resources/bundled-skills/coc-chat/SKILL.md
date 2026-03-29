---
name: coc-chat
description: Access, search, analyze, and submit CoC conversation process records. Read from disk (list, search, summarize chats) or submit tasks to a running CoC server via REST API (chat, run-workflow, run-script, follow-up, stream). Use when the user asks to find, read, search, summarize, analyze, submit, or send tasks to CoC.
---

# CoC Chat

Two capabilities: **query** (read past conversations from disk) and **submit** (send tasks to a running CoC server).

## Query — Read Past Conversations

Use `scripts/coc_chat.py` to list, search, read, and analyze process records stored under `~/.coc/`.

```bash
python <skill-dir>/scripts/coc_chat.py <command> [args...]
```

Read [references/query.md](references/query.md) for the full command reference, on-disk layout, data structures, and common task recipes.

## Submit — Send Tasks via REST API

Use `scripts/coc_submit.py` to submit chat tasks, workflows, or scripts to a running `coc serve` instance.

```bash
python <skill-dir>/scripts/coc_submit.py <command> [args...]
```

Read [references/submit.md](references/submit.md) for the full command reference, REST API schemas, SSE streaming protocol, and examples.

## Quick Reference

| Goal | Script | Command |
|------|--------|---------|
| List workspaces | `coc_chat.py` | `workspaces` |
| List recent chats | `coc_chat.py` | `list <wsId> --limit 10` |
| Read a conversation | `coc_chat.py` | `show <wsId> <pid>` or `conversation <wsId> <pid>` |
| Search chats | `coc_chat.py` | `search <keyword>` or `search-content <keyword>` |
| Submit a chat | `coc_submit.py` | `chat <prompt> --workspace <wsId>` |
| Stream output | `coc_submit.py` | `stream <processId>` |
| Send follow-up | `coc_submit.py` | `follow-up <processId> <message>` |
| Run a workflow | `coc_submit.py` | `run-workflow <path> --workdir <dir>` |

`<skill-dir>` is the directory containing this SKILL.md file.
