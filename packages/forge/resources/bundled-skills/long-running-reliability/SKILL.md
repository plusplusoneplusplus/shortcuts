---
name: long-running-reliability
description: Use for multi-hour or unattended autonomous delivery, supervised single-writer coding, Ralph execution, long tests/builds/PR completion, recovery from SDK timeout, idle timeout, classifier rejection, queue/process split-brain, and silent completed-without-continuation stalls, or when the user says "I restarted CoC; re-engage the watchdog." Establishes one writer, a durable ledger, scheduled pacing, and an external detached watchdog; do not use for ordinary one-off commands or simple monitoring.
metadata:
  author: CoC
  version: "0.0.3"
---

# Long-Running Reliability

This skill defines a durable operating protocol for autonomous work that spans
multiple AI requests and infrastructure failure boundaries.

## Required Roles

Use exactly these three roles:

1. A read-only Ask supervisor may inspect progress and escalate decisions. Its
   cron or heartbeat does not prevent writer SDK failure.
2. There is exactly one Autopilot or Ralph writer for a worktree. Never delegate
   repository writes, tests, builds, commits, pushes, or PR mutation to another
   writer.
3. An external durable watchdog runs as a detached OS process outside CoC. It
   targets the writer, never the Ask supervisor, and consumes no AI request or
   queue slot while polling.

Before every write and every recovery, reject another active Autopilot/Ralph
task targeting the same normalized worktree.

## Verified Runtime Boundaries

- Each AI request has a 6-hour wall limit.
- One hour without a streaming activity event triggers the 1-hour idle limit.
- Queue retries default off. A loud SDK failure can therefore end the task.
- A process can report completed while no continuation is queued. Status- or
  error-only recovery misses this silent stall.
- A shell that backgrounds without a follow-up read can produce no activity and
  hit the idle limit. A still in-flight background tool can suppress that safety
  net until the wall limit. Reap background shells before ending a turn.
- A `400` or `422` content-classifier rejection is distinct from timeout and stall
  recovery. Rejected history can persist in the provider session, so a blind
  same-process retry can deterministically fail again.
- Keep crash, audit, security, and tool-output detail on disk. Prompts and ledgers
  carry only compact neutral engineering verdicts and file paths.
- Startup orphan reconciliation runs when CoC starts. Pending wakeups re-arm
  after restart, but neither wakeups nor a supervisor cron replace an external
  watchdog.

## Durable Ledger

Create the ledger before unattended work and keep it outside the repository.
At every turn boundary record:

- writer workspace, process, SDK session, mode, worktree, branch, HEAD, upstream,
  and exact dirty state;
- watchdog PID, state/log paths, target, startup heartbeat, cooldown, TTL, and
  resume ceiling;
- active commands, shells, tests, builds, artifacts, and external job IDs;
- compact evidence, completed validation, blockers, and exactly one next bounded
  action;
- dedicated completion and human-blocked markers, each permitted only as an
  exact standalone line.

Never place either terminal marker as a standalone line in instructions,
examples, or unfinished checkpoints.

## Turn Protocol

1. Re-read the ledger and recheck the duplicate writer guard.
2. Perform one substantial bounded subtask.
3. Keep dense output in files and record compact evidence.
4. Reap background shells. Never sleep inside an AI request merely to monitor.
5. Update the ledger with exactly one next bounded action.
6. Use a scheduled wakeup for normal pacing and end the turn to obtain a fresh
   request budget. The watchdog is recovery, not pacing.

## Watchdog Decision Protocol

The watchdog opens `processes.db` read-only. A target queued/running task or
every pending target wakeup is activity. Otherwise it requires three consecutive
target-specific idle polls and an immediate recheck.

The recheck rejects a duplicate writer or newly appeared activity. A confirmed
stall produces exactly one bounded recovery, then enforces cooldown, TTL, and a
maximum resume count. It logs startup, periodic heartbeats, split-brain, rejected
recoveries, and every recovery attempt.

The database recheck and HTTP enqueue cross a process boundary, so they cannot
form one transaction. Keep them adjacent and treat the duplicate-writer operator
rule as authoritative: the watchdog minimizes but cannot eliminate that TOCTOU
window without a server-side guarded-recovery capability.

Queue/process split-brain means a terminal/error process still has a
queued/running task. Log it and keep a bounded wait. Never assume cancellation
releases a leaked exclusive limiter slot; release occurs only when the executor
unwinds.

## Classifier Circuit Breaker

The watchdog recognizes classifier rejection only when an HTTP/CAPI `400` or
`422` signature appears with a content-classification or safety-rejection phrase.
Unrelated `400`/`422` responses remain ordinary failures.

On the first rejection, use the normal idle streak, endpoint verification,
duplicate-writer guard, and immediate recheck. Copilot, Codex, and Claude may
receive one controlled in-place compaction followed by one mode-correct neutral
attempt. OpenCode and processes without a resumable SDK session fail closed.
Classifier attempts have their own counter and never consume the normal resume
budget.

Compaction summarizes the same provider history; it does not create a clean
conversation. A failed/no-op compact, uncertain dispatch, or recurring classifier
rejection opens the circuit. An open circuit prohibits every further same-process
enqueue.

The watchdog identifies a rejection occurrence with an opaque digest of the
process ID and failure completion time; raw error text never enters watchdog state
or logs. CoC partial updates can retain an older error after later success, so a
completed process does not represent a rejection. After one attempt, the same
occurrence waits without changing counters. Only a distinct later occurrence opens
the circuit. State files without an occurrence field load with no prior occurrence.

Queue retry is not a clean handoff because it retains the source payload prompt.
Fork is not clean because it copies provider and CoC history. Automatic handoff
also fails closed because public APIs do not atomically guard the old writer,
create a fresh writer, discover its process ID, persist lineage, and retarget the
watchdog.

Use this serialized handoff:

1. Checkpoint the authoritative ledger with one next bounded action.
2. Prove the old writer has no queued/running task or pending wakeup.
3. Recheck that no other Autopilot/Ralph writer targets the worktree.
4. Start exactly one fresh Autopilot writer with a minimal prompt that references
   the ledger path rather than copying diagnostics.
5. Record predecessor and successor process IDs in the ledger.
6. Stop the old watchdog through its instance-bound control, start one watchdog
   for the successor, and recheck that the writers never overlap.

Example lifecycle: keep detailed evidence in `./reliability-state/evidence.log`;
on a first classifier rejection, allow one supported compact plus neutral attempt;
on recurrence, checkpoint `./reliability-state/DELIVERY.md`, wait for the old
writer to become fully idle, start one fresh writer with only that ledger path,
record lineage, and retarget the watchdog before work resumes.

## Mode-Correct Recovery

- **Autopilot continuation:** enqueue one follow-up carrying the same process ID.
- **Ralph resume:** call the supported workspace Ralph resume route for the
  session. An ordinary follow-up may restore conversation work without restoring
  the Ralph loop.

The helper never cancels queue tasks, edits the database, kills SDK processes,
resets concurrency, or restarts CoC.

## Stuck-Session Escalation

Use these distinct actions in order:

1. **bounded wait:** allow the request timeout plus stale-task grace to unwind a
   held execution;
2. **targeted cancellation:** cancel only a confirmed target task when stopping
   it is necessary, while treating the exclusive slot as still held;
3. **Ralph resume:** use only after the session is eligible and no Ralph task is
   in flight;
4. **Autopilot continuation:** use only after target idleness and the duplicate
   writer guard are confirmed;
5. **approved server restart:** use only with explicit human approval when a
   leaked in-memory limiter cannot unwind safely.

Cancellation never proves the limiter is released. Never globally force-fail
tasks or restart the server as an automatic recovery.

## Helper Lifecycle

Create a bounded continuation prompt file, then start the detached helper:

```text
coc reliability-watchdog start --workspace-id ws-example --process-id queue_example --worktree ./project-feature --ledger ./reliability-state/DELIVERY.md --prompt-file ./reliability-state/continue.txt --state-dir ./reliability-state/watchdog --data-dir ./coc-data --server-url http://127.0.0.1:4000 --mode autopilot --complete-marker DELIVERY_COMPLETE --blocked-marker DELIVERY_BLOCKED
```

For Ralph, add `--mode ralph --ralph-session-id ralph-example`. Keep the state
directory and ledger outside the target worktree.

After a CoC/server restart, re-engage one known state directory without rebuilding
its configuration:

```text
coc reliability-watchdog resume --state-dir ./reliability-state/watchdog
```

Persisted configuration supplies the target identity, paths, limits, markers, and
mode. Resume resolves the endpoint from explicit `--server-url`,
`COC_SERVER_URL`, explicitly configured current CoC serve host/port, then the
persisted URL. It acquires the atomic start claim before deciding whether to
relaunch. A live recorded watchdog is idempotent success only when its
instance-bound loopback lease proves the PID belongs to that watchdog. A dead
watchdog relaunches once through the held claim and preserves its valid original
TTL start, recovery and classifier counters, and lineage.

Resume fails closed for an exact terminal marker, expired TTL, missing or
unreadable configuration/state, invalid start time beyond the bounded clock-skew
allowance, target binding mismatch, unverifiable process identity, duplicate
writer, queued/running target work, pending target wakeup, or conflicting live
start claim. It never discovers deliveries. Automatic host-reboot auto-discovery,
`resume-all`, and supervisor dialtone resurrection are separate product work.

Inspect or stop the exact helper instance:

```text
coc reliability-watchdog status --state-dir ./reliability-state/watchdog
coc reliability-watchdog stop --state-dir ./reliability-state/watchdog
```

`stop` writes an instance-bound stop request; it does not signal an arbitrary
reused PID. Start and resume verify `/api/health` plus the target process before
spawning. Status includes classifier circuit state, rejection/compaction counters,
and manual-handoff lineage when the circuit is open.

## PR-Ready Terminal Criteria

Do not write the completion marker merely because code was pushed. PR-ready
terminal state requires:

- requested behavior, focused tests, package resources, docs, and trigger
  evaluation complete;
- relevant builds and tests green at the exact committed HEAD;
- independent adversarial review resolved;
- clean worktree, non-force push, correct target branch, and conflict-free PR;
- relevant CI/policies terminal and nonblocking;
- no active blocking review comment;
- watchdog stopped only after the exact standalone completion marker is
  independently verified.
