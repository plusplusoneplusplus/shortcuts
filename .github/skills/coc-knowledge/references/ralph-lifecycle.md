# Ralph — Session lifecycle

What happens to a session after it starts running: resuming a stuck one, continuing a
completed one, submitting its commits as a PR, scheduled runs, and final-check
automation. Session creation is in [ralph-launch.md](ralph-launch.md); the journal
format is in [ralph.md](ralph.md).

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
a stuck executing session: `phase === 'executing'` and the read route's
`hasInFlightTask === false`. Gating on the server-computed in-flight signal
rather than the iteration counter covers a first-iteration cancellation
(`currentIteration === 0`, `iterations === []`) without falsely offering Resume
on a freshly launched session whose first iteration is still running; the
`=== false` check keeps Resume hidden when an older/remote server omits the
field. Its confirmation panel renders shared `ModalJobAiControls`
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

### Submit Session Commits as a PR

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/submit-pr`
(`packages/coc/src/server/routes/ralph-submit-routes.ts`) publishes a completed
session's commits as a GitHub pull request by enqueuing an autopilot submit job
attached to the session (same attached-job pattern as final-check). It takes no
request body. Allowed for ANY `phase === 'complete'` session regardless of
`terminalReason`; guards return 409 when the session is not complete, when a
Ralph task for the session is in flight (`findInFlightRalphTask`), or when a
prior submit is still `queued`/`running`; 404 for an unknown session. Repeat
submits after a terminal submit are allowed and increment `submitIndex`.
Response: `{ submitted: true, sessionId, taskId, submitIndex }`.

Each submit persists a `RalphSubmitRecord` (`submitIndex`, `taskId`,
`processId`, `startedAt`, `completedAt`, `status`
`queued|running|completed|failed`, `prUrl`, `prNumber`, `commitShas`, `error`)
in a `submits[]` array on the session record via
`RalphSessionStore.upsertSubmitRecord(...)`; legacy records without `submits`
parse fine. The record type is portable
(`@plusplusoneplusplus/coc-workflow/ralph`, re-exported by coc's
`server/ralph/types.ts` barrel).

Task construction and guards live in
`packages/coc/src/server/ralph/enqueue-submit.ts` (mirrors
`enqueue-final-check.ts`): `buildSubmitTaskPayload` enqueues a `mode='ralph'`
chat with `context.ralph.submit = { kind: 'submit-pr', submitIndex }` and
taskGroup role `submit-pr`, deliberately carrying no provider/model selection so
workspace defaults apply. The prompt comes from the portable
`buildRalphSubmitPrompt` (`@plusplusoneplusplus/coc-workflow/ralph`,
`submit-prompt.ts`): determine commits via `baselineSha..HEAD` when the session
has a baseline, else via a startedAt/completedAt time window cross-checked
against `progress.md`; whole-session scope (all loops including gap-fix); invoke
the `submit-commits-as-pr` skill with an explicit comma-separated SHA list; PR
title/body from the goal plus a progress-journal summary, auto-merge on, not
draft; never resolve cherry-pick conflicts (the skill aborts); end with a
`RALPH_SUBMIT_RESULT` JSON block
`{ status: 'submitted'|'failed', prUrl?, prNumber?, commitShas?, error? }`.

On task completion the queue bridge routes `context.ralph.submit` completions to
`handleSubmitCompletion` →
`packages/coc/src/server/ralph/orchestrate-submit.ts`
(`orchestrateSubmitCompletion`), which records the `processId`, parses the
response with the tolerant portable `parseRalphSubmitResult`
(`submit-result-parser.ts`, modeled on `parseFinalCheckResult`), and updates the
persisted submit record: `submitted` → `completed` with
`prUrl`/`prNumber`/`commitShas`; `failed` → `failed` with the agent's `error`;
missing/malformed block → `failed` with `error: 'unparseable'`. `completedAt` is
set on terminal updates and `upsertSubmitRecord` preserves the original
`startedAt` on patches. A submit completion never enqueues further work. Server
code never switches git branches — the only branch manipulation happens inside
the submit skill's script.

`coc-client` exposes `workspaces.submitRalphPr(workspaceId, sessionId)`
(contract types in `src/contracts/workspaces.ts`, implementation next to
`continueRalphSession` in `src/domains/workspaces.ts`): an empty-body POST to
the submit-pr route returning the typed `RalphSubmitPrResponse`. The client
`RalphSessionRecord` mirrors `baselineSha?` and `submits?: RalphSubmitRecord[]`
so the dashboard can render submit nodes from the session read response.

In the dashboard SPA, `RalphWorkflowPane` shows a `Submit PR` action in the
header meta row for ANY `phase === 'complete'` session (any terminal reason).
One click — no confirmation dialog — calls `workspaces.submitRalphPr` on the
selected clone's server (container override `onSubmitPr` refreshes the view);
the button is disabled while any submit record is `queued`/`running` or while
the request is in flight, and an inline error surfaces a rejected request
(e.g. a 409 guard). Each `RalphSubmitRecord` renders a `RalphSubmitNode`
("PR submit #N") appended after all iteration/final-check timeline items in
`submitIndex` order: completed nodes link the `prUrl` in a new tab, failed
nodes show the `error` text, and a node with a recorded `processId` is
clickable to open the submit chat (wired to the host process-id callback like
final-check nodes). `useRalphSessionView` keeps polling a complete session
while a submit is `queued`/`running` so node status updates live.

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

`decideRalphIterationActions(...)` derives an effective signal: when the response
text carries no inline `RALPH_*` token, it recovers the agent's intent from the
journal section the agent wrote for the current iteration. `orchestrate-iteration`
supplies that section via `recentProgressSections`, which carry `iteration`,
`signal`, and `body` and always include the current iteration's section (not just
the trailing `-3` window). The recovered signal drives control flow and is the
value recorded to `session.json`/`progress.md`, so a dropped `RALPH_COMPLETE`
still enqueues final-check and a dropped `RALPH_NEXT` still continues the loop. An
inline token stays authoritative when present (even if it disagrees with the
journal); `NO_SIGNAL` stays terminal only when neither source carries a signal.

All three Ralph task kinds — iteration, final-check and PR-submit — ride the same
`RalphExecutor` and are told apart by `getRalphTaskKind(ctx)`
(`packages/coc/src/server/ralph/task-kind.ts`), which reads `context.ralph` and
returns `'iteration' | 'final-check' | 'submit'`. The executor rebuilds the user
prompt from `buildRalphIterationPrompt` for `'iteration'` only; final-check and
submit prompts (built at enqueue time by `buildFinalCheckPrompt` /
`buildRalphSubmitPrompt`) pass through verbatim and get no context-map pointer.
Repo instructions are `'ask'` for final-check and `'ralph'` for the other two —
submit needs write access to push the branch and open the PR. `agentMode` is
`'autopilot'` for every kind. The queue bridge routes completions off the same
helper.

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
