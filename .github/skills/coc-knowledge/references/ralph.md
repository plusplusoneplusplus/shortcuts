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
```

`session.json` is a `RalphSessionRecord` from
`@plusplusoneplusplus/coc-workflow/ralph` (re-exported by
`packages/coc/src/server/ralph/types.ts` for CoC compatibility). It includes `sessionId`,
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
`session.json` and `progress.md` as source of truth and never mutate them. The
session read route also returns raw text for every direct file in the session
folder as `files: { name, content }[]`, sorted alphabetically by filename, plus
optional transient `resumeDefaults` recovered from the latest iteration process
for stuck-session Resume controls. A missing journal is surfaced as `null` or
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
`packages/coc/src/server/ralph/iteration-prompt.ts`). The prompt begins with a
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

## Direct Goal Launch

`POST /api/ralph-launch` (`packages/coc/src/server/routes/ralph-launch-routes.ts`)
starts an execution-phase Ralph session directly from an already-written goal
spec. The SPA `shared/RalphLaunchDialog.tsx` is shared by goal-file launches
from Notes and direct-goal launches from New Chat. Notes render a read-only
preview with modal-owned `ModalJobAiControls`; New Chat renders an editable
review dialog prefilled from the composer and passes its current
workspace-scoped provider/model/reasoning-effort selection into the launch. The
New Chat direct-goal path sends goal text only: attachments and images block
confirmation, no grilling chat is enqueued, and the pasted goal is not saved as
a note. `folderPath` is the source/context folder for the goal spec, while
`workingDirectory` is an optional explicit execution directory; when omitted,
the multi-repo queue router resolves the execution root from `workspaceId`. The
route validates optional `provider` and `reasoningEffort` inputs and carries
them, alongside optional `config.model`, onto the first queued Ralph execution
task.

`POST /api/processes/:id/ralph-start`
(`packages/coc/src/server/routes/queue-ralph-routes.ts`) starts execution from
a completed grilling-phase session. The SPA `features/chat/RalphStartPanel.tsx`
uses the same `ModalJobAiControls` as direct launch and sends the resolved
provider plus optional `config.model`/`config.reasoningEffort`; the route
validates those overrides and applies them only to the first queued execution
task.

Work Item execution can also start a Ralph loop through
`POST /api/workspaces/:workspaceId/work-items/:itemId/execute` with
`executionMode='ralph'`. That path is gated by `workItems.workflow.enabled` and
limited to local-only `work-item` and `goal` items. Local-only Goals default to
Ralph when the mode is omitted; Work Items default to one-shot execution. The
executor initializes the repo-scoped Ralph journal, enqueues the first iteration
with the standard Ralph task shape, preserves the top-level `payload.workItemId`
for Work Item completion hooks, and records `ralphSessionId`, selected content
version, execution mode, skills, and AI settings in the Work Item execution
history.

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

### Grilling-Phase Prompt Injection

During the `grilling` phase, `chat-base-executor` prepends a directive to the
**user message** (never the system message) via `buildRalphGrillSuffix(...)`
(`packages/coc/src/server/executors/chat-base-executor.ts`). It carries the
`ultra-ralph` grill-section pointer, the `## Goal` machine contract, and — when
an `AutoFolderContext` resolves — an explicit goal-file save-location directive
pointing at the repo's `notes/Plans` root (`~/.coc/repos/<workspaceId>/notes/Plans/`)
with a `*.goal.md` filename. This keeps the goal file out of the repository
working tree and lets the Notes/scratchpad UI open and edit it (`isGoalFile`
detects `*.goal.md`). The generic bundled `grill-me` skill stays host-agnostic:
it defers to whatever save location the host supplies and only falls back to a
working-directory-relative `Plans/<area>/<feature>/` when none is given.

The disabled-by-default `features.ralphMultiAgentGrill` gate enables the
multi-agent grilling prompt contract only when the task context also carries
`context.ralph.grill.enabled=true`. The pure planning helpers live in
`packages/coc/src/server/ralph/grill-planning.ts`; they define the Light,
Standard (default), and Deep depth role sets, per-agent provider/model selection
shape, provenance labels (`Role Agent · provider/model` with unavailable-model
fallbacks), and the prompt block requiring actual separate grill agents,
semantic dedupe/conflict consolidation, one consolidated `ask_user` batch, and a
coverage summary in the final goal. When the flag is off or the context lacks an
enabled grill setup, existing single-agent grilling prompts remain unchanged.

Work Item Goal grilling passes `context.workItemGoalGrilling`, which makes
`buildRalphGrillSuffix(...)` omit the Notes goal-file directive and tell the
model to emit the final `## Goal` spec in chat for immutable Work Item content
versioning instead. When that bound grilling chat completes and the durable Work
Items workflow flag is still enabled, the queue completion hook extracts the
final `## Goal` block from the assistant turn and saves it on the local-only
Goal as the next AI-authored immutable content version, moving draft/planning
Goals to `readyToExecute`.

## Resume Routes

Session resume endpoints share infrastructure in
`packages/coc/src/server/routes/ralph-route-utils.ts`.
`/continue`, `/new-loop`, and `/resume` all use it for in-flight Ralph task
scans, `additionalIterations` validation/default resolution, resume hard caps,
and best-effort recovery of `workingDirectory` / `folderPath` from the latest
iteration process. Final-check gap-fix loops use the same additional-iteration
resolver so per-repo `maxRalphIterations` fallback stays consistent.

### Resume Stuck Executing Sessions

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/resume`
(`packages/coc/src/server/routes/ralph-resume-routes.ts`) handles sessions
stuck in `phase=executing` with no in-flight task — the typical outcome when
the last iteration's task failed/was cancelled or the server crashed mid-loop.

Eligibility: `phase === 'executing'` AND `currentIteration < maxIterations`
AND no queued/running task for this `sessionId`.

The endpoint appends a resume marker to `progress.md` (via
`appendResumeMarker`) and enqueues iteration `currentIteration + 1` without
changing `maxIterations`. If the session has reached its cap, the endpoint
returns 409 directing the user to `/continue` instead.

The request body may include the same per-task AI controls accepted by
`/api/processes/:id/ralph-start` and `/api/ralph-launch`: optional `provider`,
`config.model`, `config.reasoningEffort`, `config.effortTier`, and
`autoProviderRouting`. Explicit values apply only to the newly enqueued resumed
iteration. Omitted values continue to use the recovered prior
provider/model/reasoning-effort when recoverable, except that an explicit
`effortTier` suppresses recovered model/reasoning-effort so tier expansion can
select the resumed iteration's concrete model and effort.

The SPA `RalphWorkflowPane` shows a "Resume" button (amber) when it detects
a stuck executing session (phase executing, iterations > 0, no iteration with
status `running`). Its confirmation panel renders shared `ModalJobAiControls`
initialized from `resumeDefaults` when available; unchanged recovered defaults
are omitted from the request so the route preserves prior settings, while
changed or unrecovered defaults are sent through `resumeRalphSession()`.
`coc-client` exposes `resumeRalphSession()`.

### Continue a Completed Session

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/continue`
(`packages/coc/src/server/routes/ralph-continue-routes.ts`) extends a completed
session (`terminalReason` `CAP_REACHED` or `NO_SIGNAL`) by `additionalIterations`
and enqueues iteration `currentIteration + 1` on the same `sessionId`.

Its request body accepts the same per-task AI controls as `/resume`: optional
`provider`, `config.model`, `config.reasoningEffort`, `config.effortTier`, and
`autoProviderRouting`, validated by the shared `parseRalphAiSelection`. The
override/recovery merge is identical to resume — explicit values win, omitted
values fall back to the recovered prior provider/model/reasoning-effort, and an
explicit `effortTier` suppresses recovered model/reasoning-effort.

The SPA `RalphWorkflowPane` "Continue loop" confirmation panel renders the same
`ModalJobAiControls` (initialized from `resumeDefaults`); unchanged recovered
defaults are omitted, changed/unrecovered selections are forwarded through
`continueRalphSession()`. `coc-client` exposes `continueRalphSession()` taking a
`RalphContinueRequest`.

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
`packages/coc/src/server/ralph/orchestrate-final-check.ts` applies the portable
action intents returned by `decideRalphFinalCheckActions(...)` from
`@plusplusoneplusplus/coc-workflow/ralph`: it appends the final-check result to
`progress.md`, reads the session once, and persists a `RalphFinalCheckRecord`
with shared base fields (`loopIndex`, `sourceIteration`, `taskId`, `processId`,
`startedAt`, `completedAt`) plus outcome-specific metadata. The queue bridge
similarly applies `decideRalphIterationActions(...)` intents for recording
iterations, queueing continuations/final checks, and broadcasting terminal
completion; CoC remains the only owner of queue payloads, process metadata,
repo-scoped paths, WebSocket events, and filesystem writes.

Final-check tasks are still queued as Ralph chat tasks and still use autopilot
capability, but `RalphExecutor` switches to validation-only system instructions
when `context.ralph.finalCheck` is present. Those instructions allow inspection
and read-only validation commands, forbid file edits/commits/state-changing
tools, and require a `RALPH_FINAL_CHECK_RESULT` response instead of
`RALPH_NEXT`/`RALPH_COMPLETE`.

Terminal paths broadcast `ralph-session-complete`: clean checks use
`reason='signal'`, cap-reached checks use `reason='cap'`, parse failures use
`reason='final-check-failed'`, final-check setup failures use
`reason='final-check-enqueue-failed'` or `reason='final-check-session-missing'`,
gap-loop creation failures use `reason='final-check-gap-loop-start-failed'`,
and gap-loop enqueue failures use `reason='final-check-gap-enqueue-failed'`. A
successful gap-fix enqueue does not broadcast completion because the next loop
continues the session.

The SPA `RalphWorkflowPane` timeline surfaces these `RalphFinalCheckRecord`
entries as distinct `Final check #<checkIndex>` nodes placed after their
`sourceIteration`, and labels the gap-fix loop divider `Gap fix loop <N>` when a
record reports `gapLoopStarted`/`gapLoopIndex`. This is display/navigation only —
it reads already-persisted `finalChecks` from the session read route and adds no
new persistence. The `coc-client` `RalphFinalCheckStatus` contract includes the
persisted `queued` state.
