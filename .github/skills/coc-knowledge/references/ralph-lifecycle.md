# Ralph — Session lifecycle

What happens after a session starts: resuming a stuck one, continuing a completed one,
submitting its commits as a PR, scheduled runs, and final-check automation. Creation is in
[ralph-launch.md](ralph-launch.md); the journal format is in [ralph.md](ralph.md).

## Resume Routes

`packages/coc/src/server/routes/ralph-route-utils.ts` is shared by `/continue`, `/new-loop`,
and `/resume` for in-flight Ralph task scans, `additionalIterations` validation/defaults,
resume hard caps, and best-effort recovery of `workingDirectory`/`folderPath` from the latest
iteration process. Final-check gap-fix loops use the same additional-iteration resolver so
per-repo `maxRalphIterations` fallback stays consistent.

### Shared AI controls

`/resume` and `/continue` accept the same per-task AI controls as `/ralph-start` and
`/ralph-launch` — optional `provider`, `config.model`, `config.reasoningEffort`,
`config.effortTier`, `autoProviderRouting` — validated by the shared `parseRalphAiSelection`.
Explicit values apply only to the newly enqueued iteration; omitted values fall back to the
recovered prior provider/model/reasoning-effort, except that an explicit `effortTier`
suppresses recovered model/reasoning-effort so tier expansion picks concrete values. In the
SPA both confirmation panels render shared `ModalJobAiControls` initialized from
`resumeDefaults`; unchanged recovered defaults are omitted from the request so the route
preserves prior settings.

### Resume Stuck Executing Sessions

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/resume`
(`routes/ralph-resume-routes.ts`) handles sessions stuck in `phase=executing` with no
in-flight task — typically the last iteration's task failed or was cancelled, or the server
crashed mid-loop.

Eligibility: `phase === 'executing'` AND `currentIteration < maxIterations` AND no
queued/running task for this `sessionId`. The endpoint appends a resume marker to
`progress.md` (`appendResumeMarker`) and enqueues iteration `currentIteration + 1` without
changing `maxIterations`. At the cap it returns 409 directing the user to `/continue`.

`RalphWorkflowPane` offers Resume when `phase === 'executing'` and the read route reports
`hasInFlightTask === false`. Gating on the server-computed in-flight signal rather than the
iteration counter covers a first-iteration cancellation (`currentIteration === 0`,
`iterations === []`) without falsely offering Resume on a freshly launched session; the
`=== false` check keeps Resume hidden when an older/remote server omits the field.
`coc-client` exposes `resumeRalphSession()`.

### Continue a Completed Session

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/continue`
(`routes/ralph-continue-routes.ts`) extends a completed session (`terminalReason`
`CAP_REACHED` or `NO_SIGNAL`) by `additionalIterations` and enqueues iteration
`currentIteration + 1` on the same `sessionId`. `coc-client` exposes
`continueRalphSession()` taking a `RalphContinueRequest`.

### Submit Session Commits as a PR

`POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/submit-pr`
(`routes/ralph-submit-routes.ts`) publishes a completed session's commits as a GitHub pull
request by enqueuing an autopilot submit job attached to the session (same attached-job
pattern as final-check). No request body. Allowed for ANY `phase === 'complete'` session
regardless of `terminalReason`; 409 when not complete, when a Ralph task for the session is
in flight (`findInFlightRalphTask`), or when a prior submit is `queued`/`running`; 404 for an
unknown session. Repeat submits after a terminal submit increment `submitIndex`. Response:
`{ submitted: true, sessionId, taskId, submitIndex }`.

Each submit persists a portable `RalphSubmitRecord` (`submitIndex`, `taskId`, `processId`,
`startedAt`, `completedAt`, `status` `queued|running|completed|failed`, `prUrl`, `prNumber`,
`commitShas`, `error`) into `submits[]` via `RalphSessionStore.upsertSubmitRecord(...)`;
records without `submits` parse fine.

Task construction and guards live in `server/ralph/enqueue-submit.ts` (mirrors
`enqueue-final-check.ts`): `buildSubmitTaskPayload` enqueues a `mode='ralph'` chat with
`context.ralph.submit = { kind: 'submit-pr', submitIndex }` and taskGroup role `submit-pr`,
deliberately carrying no provider/model selection so workspace defaults apply. The prompt
comes from the portable `buildRalphSubmitPrompt` (`submit-prompt.ts`): determine commits via
`baselineSha..HEAD` when a baseline exists, else a startedAt/completedAt time window
cross-checked against `progress.md`; whole-session scope including gap-fix loops; invoke the
`submit-commits-as-pr` skill with an explicit comma-separated SHA list; PR title/body from
the goal plus a journal summary, auto-merge on, not draft; never resolve cherry-pick
conflicts (the skill aborts); end with a `RALPH_SUBMIT_RESULT` JSON block
`{ status: 'submitted'|'failed', prUrl?, prNumber?, commitShas?, error? }`.

On completion the queue bridge routes `context.ralph.submit` to `handleSubmitCompletion` →
`server/ralph/orchestrate-submit.ts` (`orchestrateSubmitCompletion`), which records the
`processId`, parses the response with the tolerant portable `parseRalphSubmitResult`
(`submit-result-parser.ts`, modeled on `parseFinalCheckResult`), and updates the record:
`submitted` → `completed` with `prUrl`/`prNumber`/`commitShas`; `failed` → `failed` with the
agent's `error`; missing or malformed block → `failed` with `error: 'unparseable'`.
`completedAt` is set on terminal updates and `upsertSubmitRecord` preserves the original
`startedAt`. A submit completion never enqueues further work. Server code never switches git
branches — the only branch manipulation happens inside the submit skill's script.

`coc-client` exposes `workspaces.submitRalphPr(workspaceId, sessionId)` (contract in
`src/contracts/workspaces.ts`, implementation in `src/domains/workspaces.ts`): an empty-body
POST returning `RalphSubmitPrResponse`. Its `RalphSessionRecord` mirrors `baselineSha?` and
`submits?`.

`RalphWorkflowPane` shows a one-click `Submit PR` action for any complete session, disabled
while a submit is `queued`/`running` or a request is in flight, with inline errors for
rejected requests. Each record renders a `RalphSubmitNode` after all iteration/final-check
timeline items in `submitIndex` order: completed nodes link `prUrl`, failed nodes show
`error`, and a node with a `processId` opens the submit chat. `useRalphSessionView` keeps
polling a complete session while a submit is `queued`/`running`.

## Scheduled Ralph Runs

Prompt schedules with `mode='ralph'` seed a repo-scoped session before enqueueing the first
iteration. The queued task carries `context.scheduleId`, `context.scheduleRunId`, and
`context.ralph.sessionId`; continuation, final-check, and gap-fix tasks preserve the schedule
context so the originating run stays active for the whole session.

The queue bridge exposes an internal `ralphSessionComplete` callback alongside the dashboard
WebSocket event. `ScheduleExecutor` uses it to finalize scheduled runs only at a terminal
reason: queue failures and terminal final-check failure reasons mark the run failed; clean,
capped, or normal terminal reasons complete it.

## Final Check Automation

`orchestrateFinalCheck(...)` (`server/ralph/orchestrate-final-check.ts`) applies the portable
intents from `decideRalphFinalCheckActions(...)`: append the final-check result to
`progress.md`, read the session once, and persist a `RalphFinalCheckRecord` with shared base
fields (`loopIndex`, `sourceIteration`, `taskId`, `processId`, `startedAt`, `completedAt`)
plus outcome-specific metadata. The queue bridge likewise applies
`decideRalphIterationActions(...)` intents for recording iterations, queueing
continuations/final checks, and broadcasting terminal completion. CoC remains the only owner
of queue payloads, process metadata, repo-scoped paths, WebSocket events, and filesystem
writes.

`decideRalphIterationActions(...)` derives an effective signal: when the response text carries
no inline `RALPH_*` token, it recovers intent from the journal section the agent wrote for the
current iteration. `orchestrate-iteration` supplies it via `recentProgressSections`
(`iteration`, `signal`, `body`), which always includes the current iteration's section, not
just the trailing `-3` window. The recovered signal drives control flow and is recorded to
`session.json`/`progress.md`, so a dropped `RALPH_COMPLETE` still enqueues final-check and a
dropped `RALPH_NEXT` still continues the loop. An inline token stays authoritative when
present, even if it disagrees with the journal; `NO_SIGNAL` is terminal only when neither
source carries a signal.

All three Ralph task kinds — iteration, final-check, PR-submit — ride the same `RalphExecutor`
and are told apart by `getRalphTaskKind(ctx)` (`server/ralph/task-kind.ts`), which reads
`context.ralph` and returns `'iteration' | 'final-check' | 'submit'`. The executor rebuilds the
user prompt from `buildRalphIterationPrompt` for `'iteration'` only; final-check and submit
prompts are built at enqueue time and pass through verbatim with no context-map pointer. Repo
instructions are `'ask'` for final-check and `'ralph'` for the other two — submit needs write
access to push the branch and open the PR. `agentMode` is `'autopilot'` for every kind. The
queue bridge routes completions off the same helper.

Final-check tasks are queued as Ralph chat tasks with autopilot capability, but
`RalphExecutor` switches to validation-only system instructions when `context.ralph.finalCheck`
is present: inspection and read-only validation commands are allowed, file edits/commits/
state-changing tools are forbidden, and the response must be a `RALPH_FINAL_CHECK_RESULT`
rather than `RALPH_NEXT`/`RALPH_COMPLETE`.

Terminal paths broadcast `ralph-session-complete` with `reason`: `signal` (clean), `cap`,
`final-check-failed` (parse failure), `final-check-enqueue-failed`,
`final-check-session-missing`, `final-check-gap-loop-start-failed`,
`final-check-gap-enqueue-failed`. A successful gap-fix enqueue broadcasts nothing because the
next loop continues the session.

The `RalphWorkflowPane` timeline surfaces `RalphFinalCheckRecord` entries as
`Final check #<checkIndex>` nodes placed after their `sourceIteration`, and labels the gap-fix
divider `Gap fix loop <N>` when a record reports `gapLoopStarted`/`gapLoopIndex`. This is
display only — it reads already-persisted `finalChecks` from the read route. The `coc-client`
`RalphFinalCheckStatus` contract includes the persisted `queued` state.
