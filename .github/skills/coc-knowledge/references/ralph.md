# Ralph

Ralph is a CoC server feature for iterative AI execution with a small
file-backed session journal. The session store lives in
`packages/coc/src/server/ralph/ralph-session-store.ts`.
Portable Ralph contracts and pure helpers live in
`@plusplusoneplusplus/coc-workflow/ralph`, including session/final-check record
types, signal parsing, progress-section parsing/formatting, iteration prompt
building, final-check prompt building, final-check result parsing,
final-check progress-section formatting, and pure iteration/final-check
action-decision intents. The CoC server owns all side effects: queue tasks,
process metadata, WebSocket events, repo-scoped path resolution, and filesystem
persistence.

## Session Journal

Each Ralph session owns a journal directory under the repo data directory:

```text
~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/
  session.json    # metadata, written via temp file + rename
  progress.md     # append-only Markdown journal, AI-writable
  context.md      # agent-owned living context map, created by the agent
```

`session.json` is a `RalphSessionRecord` from
`@plusplusoneplusplus/coc-workflow/ralph` (re-exported by
`packages/coc/src/server/ralph/types.ts` for CoC compatibility). It includes `sessionId`,
`workspaceId`, `originalGoal`, `maxIterations`, `currentIteration`, `phase`
(`executing`, `complete`, or `failed`), `startedAt`, and an `iterations[]`
array. Each iteration records at least `iteration`, `signal`, `startedAt`, and
optionally `processId` and `completedAt`. Non-worktree sessions also carry an
optional `baselineSha` — the checkout's HEAD captured at session creation
(`captureRalphBaselineSha` in `packages/coc/src/server/ralph/capture-baseline-sha.ts`,
best-effort: absent when no directory is known or git fails) so later
automation can compute the session's `baselineSha..HEAD` commit range.
`initSession` only applies it on first creation, so continue/resume/new-loop
never overwrite it; worktree sessions record `worktree.baseSha` instead. All
five creation paths capture it: ralph-launch, ralph-start, promote-to-ralph,
work-item Ralph runs (reusing `headBefore` when supplied), and Ralph schedules
(only when `schedule.params.workingDirectory` is set).

`progress.md` starts with a small header from `initSession(...)`. Every
iteration appends a Markdown block:

```text
## Iteration <N> - <SIGNAL> - <ISO_TIMESTAMP>
Files: <comma-separated list of files created/modified>
Decisions: <one-line rationale for the key choices made>
Remaining: <what still has to happen, or "none">
Findings: <what was newly learned this iteration>
```

`SIGNAL` is one of `RALPH_NEXT`, `RALPH_COMPLETE`, or `NONE`. Response parsing
recognizes standalone signal tokens and valid adjacent signal-token runs such as
`RALPH_COMPLETERALPH_COMPLETE`, while rejecting arbitrary suffixes such as
`RALPH_NEXTEND`. The writer uses an em dash in generated headings; the parser
also accepts a plain hyphen separator. The progress-section parser only
recognizes iteration headings and stores the section body opaquely, so labels
such as `Files:`, `Decisions:`, `Remaining:`, and `Findings:` do not affect
signal extraction.

`context.md` is a sibling file owned by the Ralph agent. The store resolves its
path with `getContextPath(...)` and reads it with `readContext(...)` for
diagnostics and tests; a missing file reads as an empty string. The server does
not create, derive, parse, compact, or rewrite `context.md`. Ralph iteration
prompts surface the path so the agent reads it before `progress.md` and rewrites
it at the end of each iteration as a concise, current codebase map.

## Writer Protocol

The Ralph executor is the only writer. It must:

1. Call `RalphSessionStore.initSession(workspaceId, sessionId, ...)` once when
   the session starts. The call is idempotent.
2. After each iteration, call `appendProgressSection(...)` with the iteration
   number, exit signal, timestamp, and AI-produced summary body.
3. After each iteration, call `updateSessionRecord(...)` to bump
   `currentIteration`, append to `iterations[]`, and update `phase` for
   terminal signals.

After every successful `session.json` write (`initSession` and
`updateSessionRecord`), the store notifies a module-level, dataDir-keyed
session-change listener (`registerRalphSessionChangeListener`). The server
registers one listener at startup that projects the record into the generic
task-group registry (`syncRalphSessionToTaskGroup`): groupId = sessionId,
type `ralph`, children = iterations (role `iteration`) and final checks (role
`final-check`). Iteration and final-check queue tasks also carry the generic
`payload.context.taskGroup` tag alongside `context.ralph`.
`listSessionIds(workspaceId)` enumerates persisted session directories (used
by the registry backfill). Listener errors are swallowed — registry sync never
breaks session persistence.

Readers, including REST handlers and the SPA `useRalphSessionView` hook, treat
`session.json` and `progress.md` as source of truth and never mutate them. The
session read route also returns raw text for every direct file in the session
folder as `files: { name, content }[]`, sorted alphabetically by filename, plus
optional transient `resumeDefaults` recovered from the latest iteration process
for stuck-session Resume controls, plus `hasInFlightTask` (computed via
`findInFlightRalphTask`) telling the SPA whether a queued/running Ralph task
still backs the session. A missing journal is surfaced as `null` or
empty state. A partially written `session.json` is tolerated as `null`; the next
mutator pass rewrites it.

## Size Cap

`appendProgressSection(...)` enforces a defensive 10 MB hard cap on
`progress.md`. If the file exceeds the cap, the store keeps only the last
approximately 500 KB of content and prepends a `# Ralph Session (truncated)`
banner with the original byte size.

The cap is intentionally lossy. There is no compaction pass or historical
archive, so runaway sessions remain bounded at the cost of older journal
content.

## Per-Iteration User Prompt

Each iteration's user prompt is built by `buildRalphIterationPrompt(...)` from
`@plusplusoneplusplus/coc-workflow/ralph` (with a CoC compatibility re-export in
`packages/coc/src/server/ralph/iteration-prompt.ts`). The prompt begins with the
`ultra-ralph` execution-section skill pointer, then surfaces durable session
state by path only: `Progress journal: <progress.md>`, optional
`Context map: <context.md>` with read-first/rewrite-at-end instructions, and the
iteration counter. The `originalGoal` is embedded last in a `<goal>` block.

The prompt never injects `progress.md` or `context.md` content. The agent reads
those files from the surfaced paths. The prompt must not name repository-specific
implementation skills, set `context.skills`, or begin with `<available_skills>`,
`<additional_tool_instructions>`, or `<skill-context`, since the retriever skips
messages with those prefixes when locating the user query.

See `docs/spec-slices.md` for the full slice template, decision-tagging
convention, and ready-for-Ralph checklist that the bundled `grill-me` skill
produces.

## Manual Verification Only Guard

`RALPH_NEXT` means concrete autonomous implementation or validation work remains.
When a below-cap iteration emits `RALPH_NEXT` but its `Remaining:` progress is
explicitly manual-verification-only, final-check-only, blocked on unavailable
credentials, or otherwise user-only, the portable Ralph decision helper classifies
it as `manualVerificationOnly`. The CoC adapter records the iteration as
complete with `terminalReason='MANUAL_VERIFICATION_ONLY'`, does not enqueue
another implementation iteration, and enters the same final-check enqueue path as
`RALPH_COMPLETE`. The dashboard labels this durable session state as
"Manual verification needed"; it is not resumable via Continue loop.

The bundled `ultra-ralph` execution instructions require agents to emit
`RALPH_COMPLETE` directly when all autonomous code, test, build, documentation,
and automatable validation work is done, even if manual demos, product review, or
human-only verification still need user follow-up. The server-side guard is only
a safety net for stale or non-compliant `RALPH_NEXT` responses.

## Related files

- [ralph-launch.md](ralph-launch.md) — direct goal launch, worktree execution mode,
  promoting an ask-mode chat, and grilling-phase prompt injection.
- [ralph-lifecycle.md](ralph-lifecycle.md) — resume, continue, submit-as-PR, scheduled
  runs, and final-check automation.
