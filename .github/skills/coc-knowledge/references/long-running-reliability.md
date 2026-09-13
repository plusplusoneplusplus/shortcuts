# Long-Running Reliability

CoC distributes a bundled `long-running-reliability` skill and a detached
`coc reliability-watchdog` helper for multi-request autonomous delivery. The
system keeps normal pacing inside durable wakeups while recovering missing
continuations from a process outside the CoC server and SDK request.

## Package Boundaries

| Surface | Location | Responsibility |
|---|---|---|
| Skill | `packages/forge/resources/bundled-skills/long-running-reliability/SKILL.md` | Three-role protocol, ledger contract, recovery boundaries, invocation, PR terminal criteria |
| Registry | `packages/forge/src/skills/bundled-skills-registry.ts` | Bundled discovery metadata |
| State engine | `packages/forge/src/reliability/delivery-watchdog.ts` | Pure idle/recheck/recovery and classifier-circuit decisions, duplicate-writer classification, request construction, read-only SQLite probe |
| Runtime | `packages/forge/src/reliability/watchdog-runtime.ts` | Detached lifecycle, persistent state, classifier fail-closed boundary, heartbeat/recovery logs, stop request, HTTP calls |
| CLI | `packages/coc/src/commands/reliability-watchdog.ts` | Option resolution, input validation, start/resume/status/stop output |
| Detached entry | `packages/coc/src/commands/reliability-watchdog-runner.ts` | Server-independent Node child process |

Forge owns the reusable state and storage logic because it already owns the
process/queue schema and `better-sqlite3`. CoC owns the command surface and
spawns the compiled runner with the current Node executable.

## Operating Roles

The protocol has one read-only Ask supervisor, exactly one Autopilot or Ralph
writer per worktree, and one external watchdog targeting the writer. The
supervisor may inspect or schedule normal pacing, but its heartbeat does not
indicate that the writer SDK request remains healthy.

The writer checkpoints a ledger outside the repository after each bounded
subtask. It records identities, worktree/HEAD/dirty state, commands, validation,
watchdog state, evidence, blockers, and exactly one next action. Completion and
human-blocked markers are exact standalone tokens.

## Probe and Decision Flow

`probeDeliveryWatchdogDatabase` opens `<dataDir>/processes.db` with
`readonly: true`. It reads the target process, all active queue rows, and every
pending wakeup for the target process. Reading all active rows makes the
duplicate-writer guard effective when one physical worktree is registered under
multiple workspace IDs.

A target task is matched by task/process ID. Ralph additionally matches
`payload.context.ralph.sessionId`, so a resumed iteration with a fresh process
ID remains target activity. Any other active `autopilot` or `ralph` payload
whose normalized folder or working directory matches the target is a duplicate
writer.

The probe classifies the target error without exposing its text. It reports
`failureClass`, provider, and resumable SDK-session presence alongside activity,
binding, wakeup, split-brain, and duplicate-writer state.

Target queued/running work or any pending target wakeup resets the idle streak.
Three idle polls return a `recheck` decision. The runtime immediately probes
again and rejects new activity, duplicate writers, changed process bindings,
cooldown, TTL, or the resume ceiling before issuing one recovery.

The DB probe and HTTP enqueue are separate operations. The helper verifies the
endpoint first, then keeps the final probe and exact ledger check adjacent to
dispatch. The one-writer operating invariant covers the residual TOCTOU interval.

## Recovery Modes

Autopilot recovery posts one `/api/queue` chat payload carrying the same
`processId`, workspace ID, worktree, and bounded prompt file content. Ralph
recovery posts an empty body to
`/api/workspaces/:workspaceId/ralph-sessions/:sessionId/resume`; it never
emulates loop recovery with an ordinary follow-up.

A terminal/error process that still has a same-process active task is
split-brain. The state engine resets the idle streak and the runtime logs a
bounded wait. It never treats task cancellation as limiter release.

## Classifier Circuit

A classifier rejection requires both an HTTP/CAPI `400` or `422` signature and a
content-classification or safety-rejection phrase. Timeouts and unrelated
responses remain ordinary failures. Prompts and ledgers keep dense diagnostics on
disk and carry only neutral verdicts plus file paths.

Classifier state is independent of normal recovery state:
`classifierCircuit=closed|attempted|open`, rejection count, and compaction-attempt
count. A classifier attempt does not increment `resumeCount` or update its
cooldown.

After the normal idle/recheck guards, the first rejection may compact one
resumable Copilot, Codex, or Claude provider session in place. A successful
compact permits one mode-correct neutral attempt: Autopilot receives a
same-process prompt referencing the ledger's `Next bounded action`; Ralph uses
its session resume route. OpenCode and missing sessions fail closed.

Compaction preserves the provider-session identity and CoC transcript. A
failed/no-op compact, uncertain dispatch, unsupported provider, missing session,
or recurring rejection opens the circuit. The runtime persists
`classifier-circuit-open`, predecessor lineage, and a fixed manual-handoff action,
then performs no further same-process enqueue.

`failureOccurrenceId` is a SHA-256 digest of process ID and failure `endTime`; it
contains no error text. Successful partial process updates can preserve an older
error column, so `status=completed` suppresses classifier failure even when that
column remains populated. `classifierLastOccurrenceId` lets an attempted circuit
wait on the same stored rejection without changing counters. A different digest
is recurrence and opens the circuit. State files without occurrence fields restore
that value as `null`.

Queue retry creates a fresh task but retains the original payload prompt. Fork
copies provider history and CoC turns. Neither operation is a clean handoff.
Public APIs lack one atomic operation covering old-writer quiescence,
duplicate-worktree exclusion, fresh enqueue, successor discovery, lineage, and
watchdog retargeting, so automatic classifier handoff is fail-closed.

The supervisor completes a serialized handoff by checkpointing the ledger,
proving the predecessor has no active task or pending wakeup, rechecking duplicate
writers, creating exactly one fresh Autopilot writer from a minimal ledger-path
prompt, recording predecessor/successor IDs, and binding one detached watchdog to
the successor before work resumes.

## Detached Lifecycle

`startDeliveryWatchdog` acquires an exclusive state-directory claim, then
validates canonical paths, markers, mode-specific process identity, positive
limits, target binding, duplicate writers, `/api/health`, and the target process
from the serving CoC instance. It writes an instance configuration and spawns the
compiled runner with `detached: true` and ignored stdio. Start waits for the
child's persisted startup heartbeat before reporting success.

State preserves the instance ID, PID, target, mode, start time, idle streak,
recovery count, classifier circuit/counters, last recovery, last heartbeat,
latest probe, status, action, and manual-handoff lineage. Recovery attempts remain
bounded across a replacement process for the same target.

`status` combines persisted state with a PID liveness probe. `stop` writes an
instance-bound stop request. The child observes that file and exits; CoC never
signals a potentially reused PID.

`coc reliability-watchdog resume --state-dir <dir> [--server-url <url>]`
re-engages one known persisted deployment after a CoC/server restart. Persisted
configuration supplies target identity, paths, limits, markers, and mode. Endpoint
precedence is explicit option, `COC_SERVER_URL`, explicitly configured current
serve host/port, then the persisted URL.

Resume acquires the atomic start claim before its idempotent decision. A live
active PID returns success without spawning only after an instance-bound loopback
challenge verifies the child process lease; a reused PID or unverifiable identity
fails closed. A dead deployment passes exact-marker, valid original-TTL start with
a five-second clock-skew allowance, persisted binding, read-only SQLite activity,
duplicate-writer, pending-wakeup, health, and target-process checks under the
claim. Relaunch preserves recovery and classifier counters, the original TTL
start, and lineage.

Resume handles one explicit state directory. Automatic host-reboot auto-discovery,
`resume-all`, and supervisor dialtone resurrection are separate product work.
Missing or unreadable configuration/state and every uncertain preflight condition
fail closed.

The runtime checks the ledger after each poll and after endpoint verification,
immediately before recovery. This minimizes but cannot eliminate the external
TOCTOU interval. It logs startup, heartbeat, split-brain, rejected recovery,
recovery response, terminal exit, and fatal errors under the external state
directory.

## Safety Boundary

The helper reads SQLite and writes only its caller-selected state directory. Start
and resume do not update process/queue rows, cancel tasks, kill SDK clients, reset
queue limiters, globally force-fail work, enqueue recovery directly, or restart
CoC.

For a leaked exclusive slot, the operating sequence is bounded wait through
request timeout and stale-task grace, optional targeted cancellation with no
assumption of slot release, mode-correct resume/continuation only after the
in-flight guard clears, and an explicitly approved server restart when no safe
runtime unwind remains.

## Distribution

`long-running-reliability` is in `DEFAULT_BUNDLED_SKILLS`, so `coc serve`
installs it into the managed global skills directory and version-check updates
it. Startup sequences bundled updates and default installation before enabled
Codex and Claude mirrors, so a fresh data directory exposes the skill to every
provider in one start. Codex mirrors the installed directory; Claude mirrors
`SKILL.md`. The skill invokes the stable CoC CLI command rather than a relative
script, so both mirror forms retain a working helper reference.

## Validation

Forge tests cover pure state transitions, classifier signatures and attempt
ceilings, serialized-handoff prerequisites, exact terminal matching,
multi-workspace duplicate detection, split-brain, limits, mode-correct request
routing, read-only SQLite fixtures, detached deployment, idempotent resume,
preserved bounded state, persisted status, instance-bound stop, and fail-closed
runtime behavior. CoC tests cover command registration, endpoint precedence,
option validation, default installation, package resources, and Claude/Codex
mirrors.
