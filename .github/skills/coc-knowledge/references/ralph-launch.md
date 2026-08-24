# Ralph — Launch paths

How a Ralph session gets created: direct goal launch, isolated worktree execution,
promoting an existing ask-mode chat, and the grilling phase that precedes execution.
The journal format and writer protocol are in [ralph.md](ralph.md); everything after
the first iteration is in [ralph-lifecycle.md](ralph-lifecycle.md).

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
a note. The dialog includes the shared Ralph execution repository selector from
`shared/RalphExecutionRepoSelector.tsx`; it lists registered local workspaces and
online remote-CoC workspaces, shows remote load warnings without blocking local
launches, and posts `/api/ralph-launch` to the selected target server with that
target's `workspaceId`. `folderPath` is the source/context folder for the goal
spec, while `workingDirectory` is an optional explicit execution directory; both
are sent only when the selected target is the source workspace/server. When they
are omitted, the multi-repo queue router resolves the execution root from
`workspaceId`. The route validates optional `provider` and `reasoningEffort`
inputs and carries them, alongside optional `config.model`, onto the first
queued Ralph execution task.

`POST /api/processes/:id/ralph-start`
(`packages/coc/src/server/routes/queue-ralph-routes.ts`) starts execution from
a completed grilling-phase session. The SPA `features/chat/RalphStartPanel.tsx`
uses the same execution repository selector and `ModalJobAiControls` as direct
launch. If the selected target is the same workspace/server as the completed
grilling process, it posts to `/api/processes/:id/ralph-start` so the
grilling-phase Ralph session is reused. If the selected target differs, it posts
the reviewed `goalSpec` to that target server's `/api/ralph-launch` endpoint and
mints a fresh execution session. Any launch that hits `/api/ralph-launch` (direct
launch, or a grilling-phase launch into a different/remote target) persists a
`ralphLaunchedSession` pointer onto the source chat's process metadata so the
panel's closed banner can recover and render that session's live executing/
complete status on reopen and reload. The start route validates the resolved provider
plus optional `config.model`/`config.reasoningEffort` overrides and applies them
only to the first queued execution task.

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

## Worktree Execution Mode

Ralph launches can opt into running inside an isolated per-run Git worktree so
autonomous coding never touches the workspace's current checkout. The mode is
gated by the disabled-by-default `features.gitWorktreeExecution` flag; when off,
every path below is bypassed and behavior is unchanged.

The opt-in travels as `worktree: { enabled: true, baseRef? }` on
`POST /api/ralph-launch`, `POST /api/processes/:id/ralph-start`, and the Work
Item `execute` route with `executionMode='ralph'`. The shared helper
`packages/coc/src/server/ralph/ralph-worktree-launch.ts`
(`createRalphLaunchWorktree` + `attachWorktreeToRalphSession`) flag-gates,
resolves the **target server's own** workspace checkout root
(`processStore.getWorkspaces().find(id).rootPath` — the server always creates the
worktree for its own repo; remoteness is a client routing concern gated by the
runtime capability flag), and calls `GitWorktreeService.createWorktree` **before**
`initSession`/enqueue so a Git failure (bad `baseRef`, non-Git folder) aborts the
launch before the first iteration is queued and before any session state changes.
Default base is the checkout's current `HEAD`; a supplied `baseRef` must resolve
locally. Uncommitted source changes are excluded and surfaced as a warning.

The resolved `WorktreeMetadata` is persisted onto the Ralph session record
(`RalphSessionRecord.worktree`), carried in the dependency-free `coc-workflow`
package as the structural mirror `RalphWorktreeMetadata`. The first iteration's
task is enqueued with `payload.workingDirectory` set to the worktree path; the
queue-executor bridge threads that directory into every later iteration and the
final check automatically. Resume/continue/new-loop recover it through
`recoverIterationPaths` in `ralph-route-utils.ts`, which **prefers**
`record.worktree.path` when `status === 'active'` so a stuck or extended session
keeps running in the worktree rather than falling back to the source checkout.

Cleanup is manual and non-destructive — see the worktree routes in
[rest-api.md](rest-api.md#git-worktrees) and the chip/list UI in
[dashboard-spa.md](dashboard-spa.md); the worktree is preserved after the session
completes until the user explicitly removes it, and the generated branch is never
deleted.

## Promote Ask-Mode Chat to Ralph

A completed ask-mode chat can be promoted to a Ralph session in place via
`POST /api/processes/:id/promote-to-ralph`
(`packages/coc/src/server/routes/ralph-promote-routes.ts`).

The endpoint:

1. Attaches a `grilling`-phase Ralph context to the existing process.
2. When the user typed guidance (`extraGuidance`), persists it as a
   `displayOnly: true` **user** turn so it renders as their own message bubble
   just before the synthesized `## Goal` turn. `displayOnly` keeps it out of
   model replay history (`buildConversationHistoryContext`) — the same guidance
   is already embedded in the synthesis prompt, so replaying it would
   double-count it. Best-effort: a failed append does not fail the promotion,
   and empty/whitespace guidance appends no turn.
3. Enqueues a synthesis follow-up turn with `mode=ask`,
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

The disabled-by-default `features.ralphMultiAgentGrill` gate is editable from
Admin -> Configure -> Features and enables multi-agent grilling only when the
task context also carries `context.ralph.grill.enabled=true`. The SPA exposes a
"Question planning setup" card on New Chat Ralph grilling and promoted ask-mode
Ralph sessions while the flag is enabled; the card lets users choose Light,
Standard (default), or Deep depth. When effort levels are enabled, each role
inherits the composer's concrete provider and selected effort tier by default,
with optional per-role provider plus effort-tier overrides behind collapsed role
rows; the compact summary shows the inherited defaults and override count. The
panel resolves each role's provider/tier client-side to concrete `model`,
`reasoningEffort`, and `effortTier` fields; providers without tier mode use that
provider's own default model and reasoning-effort preference. When effort levels
are disabled, the card shows depth only and all roles inherit the composer AI
settings.
Promotion requests accept an optional `grill` payload, sanitize it on the
server, and mirror it into `metadata.ralph.grill` plus the queued synthesis task
context. The planning engine lives in the
`packages/coc/src/server/ralph/grill-*.ts` module family, with
`grill-planning.ts` as the facade that owns round orchestration and re-exports
the public API: `grill-planning-types` (contracts), `grill-agent-config`
(role/depth definitions), `grill-setup` (setup normalization and provenance),
`grill-progress`, `grill-prompts`, `grill-response-parser`,
`grill-question-consolidator` (pure dedupe/conflict), `grill-agent-runner` (SDK
invocation), `grill-termination`, `grill-process-state`, `grill-plan-prompt`,
and `grill-ask-user-metadata`. Together they define the depth role
sets, per-agent provider/tier selection shape, provenance labels (`Role Agent ·
provider/tier` when a tier applies, falling back to `Role Agent ·
provider/model`), context normalization, strict JSON candidate-question parsing,
and the preflight runner that invokes one SDK request per selected grill agent
before the main grilling turn. Each agent uses its own resolved model and
reasoning effort, falling back to the enclosing task defaults only when the
agent does not specify them. Successful first-round runs record the SDK
`sessionId` returned by that role agent; failed or unavailable agents record no
session ID. On later grilling turns, the executor passes the retained
`ProcessSessionState.ralphGrill` state back into the planner, and role agents
with stored session IDs are resumed with the user's latest answers instead of a
fresh original-request prompt. The executor folds each plan into in-memory
`ProcessSessionState` as `ralphGrill` state, preserving `roundsRun`, per-role
status/session IDs, cumulative selected user-facing questions, and compact
warnings across chat-turn cleanup for the same process. Failed, unavailable, or
first-round empty agents produce warnings and do not block the main consolidated
grilling turn. If an SDK resume returns a different session ID, the planner
treats native history as unavailable, retries that role as a fresh agent seeded
with the accumulated original request, user answer turns, and already asked
questions, and adds a compact reduced-fidelity warning to the planning/progress
metadata. Planning/progress metadata includes the current round number and
three-round cap so the live and consolidated question-planning cards can show
"Round N of up to 3". Empty responses from resumed agents are treated as "no more
follow-ups" signals; when all resumed agents are empty, when the user sends a
compact stop signal such as "enough", or when the named three-round cap is
already reached, the planner returns a terminal result and the executor removes
the `ask_user` tool from that main turn so synthesis proceeds without another
question batch. The planner
consolidates candidate questions before the main turn: exact duplicates and
conservative semantic duplicates merge with combined provenance, recognized
conflicts become one select-style decision question, and follow-up-round
candidates that exact- or semantic-match the cumulative already-asked question
set are dropped so the user never sees a repeated question. Duplicate-only agent
contributions are reported as compact warnings, and the selected question set
plus consolidation summary are appended to the main user prompt. The appended
coverage-summary requirement includes a rounds-run line. While those
isolated agents run, the executor emits transient `ralph-grill-planning` SSE
progress so the SPA can show an immediate "Question planning" status card; raw
candidate-question state is not persisted for that interim UI. When the model
emits the consolidated `ask_user` batch, the executor enriches the persisted/SSE
question payloads with the preflight planning summary, per-question provenance,
and consolidation metadata. `AskUserInline` renders that metadata as a compact
"Question planning" card, grouped role sections, provenance chips, and
reduced-coverage warnings while preserving the normal single-form
answer/skip/defer submission flow. Because the provenance chip is rendered from
attached metadata, the grilling prompt instructs the model not to embed the
provenance label in the visible question text; it is kept only in the final
`## Agent Coverage Summary`. The main grilling prompt carries an explicit
final-goal contract requiring a `## Agent Coverage Summary` section with the
selected depth, provider/tier or provider/model used per agent,
warnings/reduced-coverage notes, and dedupe/conflict outcomes, plus the normal
autonomy-ready AC/Definition-of-Done, constraints, out-of-scope, and references
sections. When the flag is off or the context lacks an enabled grill setup,
existing single-agent grilling prompts and plain `ask_user` rendering remain
unchanged.

Work Item Goal grilling passes `context.workItemGoalGrilling`, which makes
`buildRalphGrillSuffix(...)` omit the Notes goal-file directive and tell the
model to emit the final `## Goal` spec in chat for immutable Work Item content
versioning instead. When that bound grilling chat completes and the durable Work
Items workflow flag is still enabled, the queue completion hook extracts the
final `## Goal` block from the assistant turn and saves it on the local-only
Goal as the next AI-authored immutable content version, moving draft/planning
Goals to `readyToExecute`.
