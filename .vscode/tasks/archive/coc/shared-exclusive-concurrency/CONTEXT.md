# Context: Shared/Exclusive Queue Concurrency

## User Story
The CoC queue executor runs all tasks serially (maxConcurrency: 1). The user wants read-only tasks like `task-generation` and `ai-clarification` to run in parallel since they don't conflict with each other or with write tasks. Write tasks like `follow-prompt` should still serialize against each other to prevent file conflicts.

## Goal
Add a reader-writer style dual-limiter to the queue executor: shared tasks run concurrently (up to N), exclusive tasks serialize against each other, and the two categories never block each other.

## Commit Sequence
0. Add dedicated `chat` task type (prerequisite — separates chat from ai-clarification)
1. Dual-limiter queue executor in pipeline-core
2. Wire shared/exclusive policy in coc-server and coc CLI
3. Wire shared/exclusive policy in VS Code extension

## Key Decisions
- Shared tasks never wait for exclusive tasks and vice versa — only exclusive↔exclusive serializes
- Classification is a policy callback (`isExclusive`) injected by consumers, keeping pipeline-core generic
- Default behavior (no callback) = all exclusive = current serial behavior (backward compat)
- Shared types: `chat`, `task-generation`, `ai-clarification`, `code-review`
- Exclusive types: `follow-prompt`, `resolve-comments`, `run-pipeline`, `custom`

## Conventions
- `QueuedTask.concurrencyMode` field added but optional, defaults to `'exclusive'`
- `isExclusive` callback takes precedence over `concurrencyMode` field when provided
- Existing `maxConcurrency` option preserved as backward-compat alias for `exclusiveConcurrency`
