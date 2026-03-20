---
name: summarize-chats
description: Summarize one or more CoC conversation process records (JSON files under ~/.coc/repos/<workspaceId>/processes/). Produces a concise summary of key topics, decisions, action items, and unresolved questions, plus 3 follow-up suggestions. Use when the user asks to summarize, recap, or review past conversations or chat logs.
---

# Summarize Chats

Reads CoC process JSON files and produces structured conversation summaries.

## Instructions

### 1. Locate Process Files

If the user supplies explicit file paths, use them directly.

Otherwise, resolve them:
- List workspaces: `Get-Content "~/.coc/workspaces.json"`
- List processes for a workspace: read `~/.coc/repos/<workspaceId>/processes/index.json`
- Each entry has `id`, `title`, `status`, `startTime`, `promptPreview`
- Full process file: `~/.coc/repos/<workspaceId>/processes/<id>.json`

### 2. Read Each Process File

For each file:
```powershell
$data = Get-Content "<path>" | ConvertFrom-Json
$p = $data.process
# Fields: title, status, type, startTime, endTime, conversationTurns
```

Each turn in `conversationTurns` has:
- `role`: `"user"` or `"assistant"`
- `content`: string (the message text)

### 3. Produce the Summary

For each conversation, extract and output:
- **Title & metadata** (title, status, timestamp)
- **Key topics** discussed
- **Decisions made**
- **Action items** (code changes, tasks assigned, commands run)
- **Unresolved questions** (anything left open or unanswered)

When summarizing multiple conversations, add a **Cross-Cutting Themes** section at the end that identifies patterns across all conversations.

### 4. Suggest Follow-Ups

After the summary, suggest exactly **3 follow-up actions** as short imperative phrases (not questions). Examples:
- "Show the full diff for the memory fix"
- "List all tests affected by the storage migration"
- "Implement the branch AI context menu"

## Output Format

```
## <Conversation Title>
**Status:** <status> | **Date:** <startTime>

- **Topics:** ...
- **Decisions:** ...
- **Action items:** ...
- **Unresolved:** ...

---

## Cross-Cutting Themes  ← only when summarizing multiple conversations
...

---
**Suggested follow-ups:**
1. <action phrase>
2. <action phrase>
3. <action phrase>
```
