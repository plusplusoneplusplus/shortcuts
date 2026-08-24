# Ralph

Ralph is a CoC server feature for iterative AI execution backed by a small
file-based session journal. The session store is
`packages/coc/src/server/ralph/ralph-session-store.ts`.

Portable contracts and pure helpers live in `@plusplusoneplusplus/coc-workflow/ralph`:
session/final-check/submit record types, signal parsing, progress-section
parsing/formatting, iteration/final-check/submit prompt builders, result parsers, and
pure action-decision intents. The CoC server owns all side effects — queue tasks,
process metadata, WebSocket events, repo-scoped path resolution, filesystem writes.

## Session Journal

Each session owns a journal directory under the repo data directory:

```text
~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/
  session.json    # metadata, written via temp file + rename
  progress.md     # append-only Markdown journal, AI-writable
  context.md      # agent-owned living context map, created by the agent
```

`session.json` is a `RalphSessionRecord` (re-exported for CoC by
`packages/coc/src/server/ralph/types.ts`): `sessionId`, `workspaceId`, `originalGoal`,
`maxIterations`, `currentIteration`, `phase` (`executing` | `complete` | `failed`),
`startedAt`, and `iterations[]` (each with `iteration`, `signal`, `startedAt`, optional
`processId`/`completedAt`), plus optional `worktree`, `finalChecks`, and `submits[]`.

Non-worktree sessions also carry optional `baselineSha` — the checkout HEAD captured at
creation by `captureRalphBaselineSha` (`capture-baseline-sha.ts`, best-effort: absent
when no directory is known or git fails) so automation can compute `baselineSha..HEAD`.
`initSession` applies it on first creation only, so continue/resume/new-loop never
overwrite it; worktree sessions record `worktree.baseSha` instead. All five creation
paths capture it: ralph-launch, ralph-start, promote-to-ralph, work-item Ralph runs
(reusing `headBefore` when supplied), and Ralph schedules (only when
`schedule.params.workingDirectory` is set).

`progress.md` starts with a header from `initSession(...)`. Each iteration appends:

```text
## Iteration <N> - <SIGNAL> - <ISO_TIMESTAMP>
Files: <comma-separated list of files created/modified>
Decisions: <one-line rationale for the key choices made>
Remaining: <what still has to happen, or "none">
Findings: <what was newly learned this iteration>
```

`SIGNAL` is `RALPH_NEXT`, `RALPH_COMPLETE`, or `NONE`. Parsing accepts standalone signal
tokens and valid adjacent runs (`RALPH_COMPLETERALPH_COMPLETE`) but rejects arbitrary
suffixes (`RALPH_NEXTEND`). The writer emits an em dash separator in headings; the parser
also accepts a plain hyphen. The section parser recognizes only iteration headings and
stores the body opaquely, so the `Files:`/`Decisions:`/`Remaining:`/`Findings:` labels do
not affect signal extraction.

`context.md` is owned by the agent. The store resolves it with `getContextPath(...)` and
reads it with `readContext(...)` for diagnostics and tests; a missing file reads as an
empty string. The server never creates, derives, parses, compacts, or rewrites it.

## Writer Protocol

The Ralph executor is the only writer. It calls `initSession(workspaceId, sessionId, ...)`
once at session start (idempotent), then per iteration `appendProgressSection(...)` with
the iteration number, exit signal, timestamp, and AI summary body, and
`updateSessionRecord(...)` to bump `currentIteration`, append to `iterations[]`, and set
`phase` on terminal signals.

After every successful `session.json` write the store notifies a module-level,
dataDir-keyed listener (`registerRalphSessionChangeListener`). The server registers one
listener at startup that projects the record into the generic task-group registry
(`syncRalphSessionToTaskGroup`): groupId = sessionId, type `ralph`, children = iterations
(role `iteration`) and final checks (role `final-check`). Iteration and final-check queue
tasks also carry `payload.context.taskGroup` alongside `context.ralph`.
`listSessionIds(workspaceId)` enumerates persisted session directories for registry
backfill. Listener errors are swallowed so registry sync never breaks persistence.

Readers — REST handlers and the SPA `useRalphSessionView` hook — treat `session.json` and
`progress.md` as source of truth and never mutate them. The session read route also
returns raw text for every direct file in the session folder as
`files: { name, content }[]` sorted by filename, plus optional transient `resumeDefaults`
recovered from the latest iteration process, plus `hasInFlightTask` (from
`findInFlightRalphTask`). A missing journal surfaces as `null` or empty state; a partially
written `session.json` is tolerated as `null` and rewritten by the next mutator.

## Size Cap

`appendProgressSection(...)` enforces a defensive 10 MB hard cap on `progress.md`. Past
the cap the store keeps roughly the last 500 KB and prepends a
`# Ralph Session (truncated)` banner with the original byte size. The cap is intentionally
lossy: no compaction pass and no archive, so runaway sessions stay bounded at the cost of
older journal content.

## Per-Iteration User Prompt

`buildRalphIterationPrompt(...)` (portable; CoC re-export in
`packages/coc/src/server/ralph/iteration-prompt.ts`) builds each iteration's user prompt.
It opens with the `ultra-ralph` execution-section skill pointer, then surfaces durable
state **by path only** — `Progress journal: <progress.md>`, optional
`Context map: <context.md>` with read-first/rewrite-at-end instructions, and the iteration
counter — and embeds `originalGoal` last in a `<goal>` block. The agent reads the files
itself; content is never injected.

The prompt must not name repository-specific implementation skills, set `context.skills`,
or begin with `<available_skills>`, `<additional_tool_instructions>`, or `<skill-context`,
since the retriever skips messages with those prefixes when locating the user query.

See `docs/spec-slices.md` for the slice template, decision-tagging convention, and
ready-for-Ralph checklist the bundled `grill-me` skill produces.

## Manual Verification Only Guard

`RALPH_NEXT` means concrete autonomous implementation or validation work remains. When a
below-cap iteration emits `RALPH_NEXT` but its `Remaining:` text is explicitly
manual-verification-only, final-check-only, blocked on unavailable credentials, or
otherwise user-only, the portable decision helper classifies it as
`manualVerificationOnly`. The CoC adapter records the iteration complete with
`terminalReason='MANUAL_VERIFICATION_ONLY'`, enqueues no further iteration, and enters the
same final-check enqueue path as `RALPH_COMPLETE`. The dashboard labels this state
"Manual verification needed"; it is not resumable via Continue loop.

The bundled `ultra-ralph` instructions require agents to emit `RALPH_COMPLETE` directly
once all autonomous code, test, build, documentation, and automatable validation work is
done, even if manual demos or human-only verification remain. The server guard is only a
safety net for non-compliant `RALPH_NEXT` responses.

## Related files

- [ralph-launch.md](ralph-launch.md) — goal launch, worktree execution mode, promoting an
  ask-mode chat, grilling-phase prompt injection.
- [ralph-lifecycle.md](ralph-lifecycle.md) — resume, continue, submit-as-PR, scheduled
  runs, final-check automation.
