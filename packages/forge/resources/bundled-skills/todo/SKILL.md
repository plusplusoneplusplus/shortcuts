---
name: todo
description: Track a task as a To-do item and start it in a tracked conversation. Use when the user runs /todo <task> or asks to track and start a task.
metadata:
  version: "0.0.1"
---

# Todo

`/todo <task>` authorizes you to track the task and start it, within the scope the
user asked for. A bare `/todo` means ask what the task is. Listing or tracking alone
never authorizes execution.

## Requirements

Use `sentinel_todos` and `send_to_conversation`. If either tool is missing, report
the limitation and stop. Do not work around it by writing files or calling the API.

## Track

1. List items first. Reuse a matching normal item instead of creating a duplicate.
2. Never execute, copy, or convert a manual item. If the match is manual or
   Deferred, ask the user what to do. Do not reopen a Done item unless the user
   clearly asks for more work.
3. Create a normal item when none matches. Set `completionCondition` to the final
   outcome, not a phase. Pass a stable `idempotencyKey` and the correct
   `targetRepo`.
4. When updating, keep existing notes, references, and the latest user verdicts.
   On a revision conflict, list the item again and reapply your change.
5. If the item already has queued or running work for this task, do not launch
   again. Report that work instead.

## Launch

Call `send_to_conversation` with the item's `todoItemId` and no `processId`. Give a
short `title` and self-contained `content` that states the task and its scope.

- Mode: `ask` for analysis, `autopilot` for authorized changes, `ralph` only when
  the user asks for it.
- Provider: `auto` unless the user picks one.
- Workspace: the current workspace or group unless the user picks another.

Respect explicit scope and authorization. Do not infer publishing, deploying, or
schedules from the task.

## Failures

- Tracking fails: do not launch. Report the error.
- Launch fails: keep the item open and record the gap in it.
- Launch result unknown: check the item and its conversations before any retry.

## Report

Return the generated link unchanged and the actual status (queued or running).
Never mark the item Done because a launch started.
