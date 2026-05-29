# Ralph

Ralph is a CoC server feature for iterative AI execution with a small
file-backed session journal. The session store lives in
`packages/coc/src/server/ralph/ralph-session-store.ts`.

## Session Journal

Each Ralph session owns a journal directory under the repo data directory:

```text
~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/
  session.json    # metadata, written via temp file + rename
  progress.md     # append-only Markdown journal, AI-writable
```

`session.json` is a `RalphSessionRecord` from
`packages/coc/src/server/ralph/types.ts`. It includes `sessionId`,
`workspaceId`, `originalGoal`, `maxIterations`, `currentIteration`, `phase`
(`executing`, `complete`, or `failed`), `startedAt`, and an `iterations[]`
array. Each iteration records at least `iteration`, `signal`, `startedAt`, and
optionally `processId` and `completedAt`.

`progress.md` starts with a small header from `initSession(...)`. Every
iteration appends a Markdown block:

```text
## Iteration <N> - <SIGNAL> - <ISO_TIMESTAMP>
<body>
```

`SIGNAL` is one of `RALPH_NEXT`, `RALPH_COMPLETE`, or `NONE`. The writer uses
an em dash in generated headings; the parser also accepts a plain hyphen
separator.

## Writer Protocol

The Ralph executor is the only writer. It must:

1. Call `RalphSessionStore.initSession(workspaceId, sessionId, ...)` once when
   the session starts. The call is idempotent.
2. After each iteration, call `appendProgressSection(...)` with the iteration
   number, exit signal, timestamp, and AI-produced summary body.
3. After each iteration, call `updateSessionRecord(...)` to bump
   `currentIteration`, append to `iterations[]`, and update `phase` for
   terminal signals.

Readers, including REST handlers and the SPA `useRalphSessionView` hook, treat
`session.json` and `progress.md` as source of truth and never mutate them. A
missing journal is surfaced as `null` or empty state. A partially written
`session.json` is tolerated as `null`; the next mutator pass rewrites it.

## Size Cap

`appendProgressSection(...)` enforces a defensive 10 MB hard cap on
`progress.md`. If the file exceeds the cap, the store keeps only the last
approximately 500 KB of content and prepends a `# Ralph Session (truncated)`
banner with the original byte size.

The cap is intentionally lossy. There is no compaction pass or historical
archive, so runaway sessions remain bounded at the cost of older journal
content.

## Per-Iteration User Prompt

Each iteration's user prompt is built by `buildRalphIterationPrompt(...)` in
`packages/coc/src/server/ralph/iteration-prompt.ts`. The prompt begins with a
plain-language execution directive, then includes a short `<work_intent>` block
with generic coding, testing, validation, and commit vocabulary, then a
`<spec_contract>` block that tells the agent how to read goal.md plus optional
`ac-NN-*.spec.md` slices, how to honor `[decision]` / `[assumption]` / `[open]`
tags, and that a slice is done only when its Definition of Done is satisfied
with evidence recorded in `progress.md`. The `originalGoal` is embedded last in
a `<goal>` block.

The work-intent and spec-contract blocks are required because the host Copilot
CLI's embedding-based skill retriever queries against the most recent user
message: a static placeholder would surface no skills, long goals can dilute
implementation-related retrieval signal, and without the spec contract the
agent re-derives the autonomy rules every iteration. The prompt must not name
repository-specific implementation skills, set `context.skills`, or begin with
`<available_skills>`, `<additional_tool_instructions>`, or `<skill-context`,
since the retriever skips messages with those prefixes when locating the user
query.

See `docs/spec-slices.md` for the full slice template, decision-tagging
convention, and ready-for-Ralph checklist that the bundled `grill-me` skill
produces.

## Promote Ask-Mode Chat to Ralph

A completed ask-mode chat can be promoted to a Ralph session in place via
`POST /api/processes/:id/promote-to-ralph`
(`packages/coc/src/server/routes/ralph-promote-routes.ts`).

The endpoint:

1. Attaches a `grilling`-phase Ralph context to the existing process.
2. Enqueues a synthesis follow-up turn with `mode=ask`,
   `context.skills=['grill-me']`, `context.ralph.phase='grilling'`, carrying
   the prompt produced by `buildRalphSynthesisPrompt`
   (`packages/coc/src/server/ralph/synthesis-prompt.ts`).

The SPA shows a **"Promote to Ralph"** pill in the follow-up area for eligible
chats and calls this endpoint via `coc-client`'s `processes.promoteToRalph`
helper.

## Resume Routes

Session resume endpoints share infrastructure in
`packages/coc/src/server/routes/ralph-route-utils.ts`.
`/continue` and `/new-loop` both use it for in-flight Ralph task scans,
`additionalIterations` validation/default resolution, resume hard caps, and
best-effort recovery of `workingDirectory` / `folderPath` from the latest
iteration process. Final-check gap-fix loops use the same additional-iteration
resolver so per-repo `maxRalphIterations` fallback stays consistent.

## Scheduled Ralph Runs

Prompt schedules with `mode='ralph'` seed a repo-scoped Ralph session before
enqueueing the first iteration. The queued task carries `context.scheduleId`,
`context.scheduleRunId`, and `context.ralph.sessionId`; continuation, final-check,
and gap-fix tasks preserve the schedule context so the originating schedule run
can stay active for the whole Ralph session.

The queue bridge exposes an internal `ralphSessionComplete` callback in addition
to broadcasting the dashboard WebSocket event. `ScheduleExecutor` uses that
callback to finalize scheduled Ralph runs only when the session reaches a
terminal reason. Queue failures or terminal final-check failure reasons mark the
schedule run failed; clean, capped, or normal terminal reasons complete it.

## Final Check Automation

`orchestrateFinalCheck(...)` in
`packages/coc/src/server/ralph/orchestrate-final-check.ts` appends the
final-check result to `progress.md`, reads the session once, and persists a
`RalphFinalCheckRecord` with shared base fields (`loopIndex`,
`sourceIteration`, `taskId`, `processId`, `startedAt`, `completedAt`) plus
outcome-specific metadata.

Terminal paths broadcast `ralph-session-complete`: clean checks use
`reason='signal'`, cap-reached checks use `reason='cap'`, parse failures use
`reason='final-check-failed'`, final-check setup failures use
`reason='final-check-enqueue-failed'` or `reason='final-check-session-missing'`,
gap-loop creation failures use `reason='final-check-gap-loop-start-failed'`,
and gap-loop enqueue failures use `reason='final-check-gap-enqueue-failed'`. A
successful gap-fix enqueue does not broadcast completion because the next loop
continues the session.
