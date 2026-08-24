# Ralph — Launch paths

How a Ralph session gets created: direct goal launch, isolated worktree execution,
promoting an ask-mode chat, and the grilling phase that precedes execution. Journal format
and writer protocol are in [ralph.md](ralph.md); everything after the first iteration is in
[ralph-lifecycle.md](ralph-lifecycle.md).

## Direct Goal Launch

`POST /api/ralph-launch` (`packages/coc/src/server/routes/ralph-launch-routes.ts`) starts
an execution-phase session from an already-written goal spec. The SPA
`shared/RalphLaunchDialog.tsx` serves both goal-file launches from Notes (read-only preview)
and direct-goal launches from New Chat (editable review prefilled from the composer,
carrying its workspace-scoped provider/model/reasoning-effort selection). The New Chat
direct-goal path sends goal text only: attachments and images block confirmation, no
grilling chat is enqueued, and the pasted goal is not saved as a note.

The dialog embeds `shared/RalphExecutionRepoSelector.tsx`, which lists registered local
workspaces plus online remote-CoC workspaces (remote load warnings do not block local
launches) and posts to the selected target server with that target's `workspaceId`.
`folderPath` is the goal spec's source/context folder; `workingDirectory` is an optional
explicit execution directory. Both are sent only when the target is the source
workspace/server; otherwise the multi-repo queue router resolves the execution root from
`workspaceId`. The route validates optional `provider` and `reasoningEffort` and carries
them, with optional `config.model`, onto the first queued Ralph task.

`POST /api/processes/:id/ralph-start` (`routes/queue-ralph-routes.ts`) starts execution from
a completed grilling-phase session. `features/chat/RalphStartPanel.tsx` uses the same repo
selector and AI controls. If the target matches the grilling process's workspace/server it
posts here and reuses the grilling-phase session; otherwise it posts the reviewed `goalSpec`
to that target's `/api/ralph-launch` and mints a fresh session. Any launch through
`/api/ralph-launch` persists a `ralphLaunchedSession` pointer on the source chat's process
metadata so the panel can recover and render that session's live status on reopen. The start
route validates the resolved provider plus optional `config.model`/`config.reasoningEffort`
overrides and applies them only to the first queued task.

Work Items can start a Ralph loop through
`POST /api/workspaces/:workspaceId/work-items/:itemId/execute` with `executionMode='ralph'`,
gated by `workItems.workflow.enabled` and limited to local-only `work-item` and `goal` items.
Local-only Goals default to Ralph when the mode is omitted; Work Items default to one-shot.
The executor initializes the repo-scoped journal, enqueues the first iteration with the
standard Ralph task shape, preserves top-level `payload.workItemId` for completion hooks, and
records `ralphSessionId`, content version, execution mode, skills, and AI settings in the
Work Item execution history.

## Worktree Execution Mode

Launches can opt into running inside an isolated per-run Git worktree so autonomous coding
never touches the workspace checkout. Gated by the disabled-by-default
`features.gitWorktreeExecution` flag; when off every path below is bypassed.

The opt-in travels as `worktree: { enabled: true, baseRef? }` on `/api/ralph-launch`,
`/api/processes/:id/ralph-start`, and the Work Item `execute` route with
`executionMode='ralph'`. `packages/coc/src/server/ralph/ralph-worktree-launch.ts`
(`createRalphLaunchWorktree` + `attachWorktreeToRalphSession`) flag-gates, resolves the
**target server's own** checkout root (`processStore.getWorkspaces().find(id).rootPath` — a
server always creates the worktree for its own repo; remoteness is a client routing concern
gated by the runtime capability flag), and calls `GitWorktreeService.createWorktree`
**before** `initSession`/enqueue, so a Git failure (bad `baseRef`, non-Git folder) aborts the
launch before any state changes. Default base is current `HEAD`; a supplied `baseRef` must
resolve locally. Uncommitted source changes are excluded and surfaced as a warning.

The resolved `WorktreeMetadata` persists as `RalphSessionRecord.worktree`, mirrored in
`coc-workflow` as the dependency-free `RalphWorktreeMetadata`. The first iteration is
enqueued with `payload.workingDirectory` set to the worktree path; the queue-executor bridge
threads that directory into later iterations and the final check. Resume/continue/new-loop
recover it via `recoverIterationPaths` in `ralph-route-utils.ts`, which **prefers**
`record.worktree.path` when `status === 'active'` so a stuck or extended session keeps running
in the worktree.

Cleanup is manual and non-destructive — the worktree is preserved after completion until
explicitly removed, and the generated branch is never deleted. See
[rest-api.md](rest-api.md#git-worktrees) and [spa/git-and-prs.md](spa/git-and-prs.md).

## Promote Ask-Mode Chat to Ralph

`POST /api/processes/:id/promote-to-ralph` (`routes/ralph-promote-routes.ts`) converts a
completed ask-mode chat into a Ralph session in place. It:

1. Attaches a `grilling`-phase Ralph context to the existing process.
2. Persists typed `extraGuidance` as a `displayOnly: true` **user** turn so it renders as the
   user's own bubble just before the synthesized `## Goal` turn. `displayOnly` keeps it out of
   model replay history (`buildConversationHistoryContext`) — the same guidance is already in
   the synthesis prompt, so replay would double-count it. Best-effort: a failed append does
   not fail promotion, and empty guidance appends no turn.
3. Enqueues a synthesis follow-up with `mode=ask`, `context.skills=['grill-me']`,
   `context.ralph.phase='grilling'`, carrying `buildRalphSynthesisPrompt`
   (`server/ralph/synthesis-prompt.ts`).

The SPA offers this on eligible chats through `coc-client`'s `processes.promoteToRalph`.

### Grilling-Phase Prompt Injection

During the `grilling` phase, `chat-base-executor` prepends a directive to the **user
message** (never the system message) via `buildRalphGrillSuffix(...)`
(`server/executors/chat-base-executor.ts`). It carries the `ultra-ralph` grill-section
pointer, the `## Goal` machine contract, and — when an `AutoFolderContext` resolves — a
goal-file save-location directive pointing at `~/.coc/repos/<workspaceId>/notes/Plans/` with
a `*.goal.md` filename. This keeps goal files out of the repository working tree and lets the
Notes UI open them (`isGoalFile` detects `*.goal.md`). The bundled `grill-me` skill stays
host-agnostic: it defers to the host-supplied location and falls back to a
working-directory-relative `Plans/<area>/<feature>/` only when none is given.

Work Item Goal grilling passes `context.workItemGoalGrilling`, which makes
`buildRalphGrillSuffix(...)` omit the Notes directive and instruct the model to emit the final
`## Goal` spec in chat instead. When that grilling chat completes with the Work Items workflow
flag enabled, the queue completion hook extracts the final `## Goal` block and saves it on the
local-only Goal as the next AI-authored immutable content version, moving draft/planning Goals
to `readyToExecute`.

### Multi-Agent Grill Planning

The disabled-by-default `features.ralphMultiAgentGrill` flag (Admin -> Configure -> Features)
enables multi-agent grilling only when the task context also carries
`context.ralph.grill.enabled=true`. Promotion requests accept an optional `grill` payload,
sanitized server-side and mirrored into `metadata.ralph.grill` and the queued synthesis task
context. Users pick Light, Standard (default), or Deep depth; each role inherits the composer's
provider and effort tier by default, with optional per-role provider/tier overrides. The SPA
resolves each role client-side to concrete `model`, `reasoningEffort`, and `effortTier`;
providers without tier mode use their own default model and reasoning-effort preference.

The engine is the `packages/coc/src/server/ralph/grill-*.ts` module family, with
`grill-planning.ts` as the facade that owns round orchestration and re-exports the public API:
`grill-planning-types`, `grill-agent-config` (role/depth definitions), `grill-setup`
(normalization and provenance), `grill-progress`, `grill-prompts`, `grill-response-parser`,
`grill-question-consolidator` (pure dedupe/conflict), `grill-agent-runner` (SDK invocation),
`grill-termination`, `grill-process-state`, `grill-plan-prompt`, `grill-ask-user-metadata`.
Provenance labels read `Role Agent · provider/tier`, falling back to `provider/model`.

A preflight runner issues one SDK request per selected grill agent before the main grilling
turn, each with its own resolved model and effort (falling back to task defaults). Successful
first-round runs record the returned SDK `sessionId`. On later turns the executor passes the
retained `ProcessSessionState.ralphGrill` back into the planner and resumes roles with stored
session IDs using the user's latest answers. If a resume returns a *different* session ID, the
planner treats native history as unavailable, retries that role fresh (seeded with the
accumulated request, answer turns, and already-asked questions), and adds a reduced-fidelity
warning. `ralphGrill` state — `roundsRun`, per-role status/session IDs, cumulative selected
questions, compact warnings — survives chat-turn cleanup for the same process.

Consolidation runs before the main turn: exact and conservative semantic duplicates merge with
combined provenance, recognized conflicts collapse into one select-style decision question, and
follow-up candidates matching the cumulative already-asked set are dropped. Duplicate-only
contributions become compact warnings. The selected question set and consolidation summary are
appended to the main user prompt.

Termination: empty responses from resumed agents mean "no more follow-ups". When all resumed
agents are empty, the user sends a stop signal such as "enough", or the three-round cap is
reached, the planner returns a terminal result and the executor removes the `ask_user` tool from
that turn so synthesis proceeds. Failed, unavailable, or first-round-empty agents produce
warnings and never block the main turn.

While isolated agents run the executor emits transient `ralph-grill-planning` SSE progress;
raw candidate-question state is not persisted. When the model emits the consolidated `ask_user`
batch, the executor enriches the persisted/SSE payloads with the planning summary, per-question
provenance, and consolidation metadata, which `AskUserInline` renders alongside the normal
answer/skip/defer flow. Because provenance is rendered from metadata, the prompt instructs the
model not to embed provenance labels in visible question text — they belong only in the final
`## Agent Coverage Summary`, which the prompt requires to list depth, per-agent provider/tier
(or provider/model), warnings, and dedupe/conflict outcomes alongside the normal
autonomy-ready AC/Definition-of-Done, constraints, out-of-scope, and references sections.

With the flag off or no enabled grill setup, single-agent grilling prompts and plain `ask_user`
rendering apply.
