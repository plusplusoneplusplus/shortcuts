---
name: long-running-reliability
description: Use for multi-hour or unattended autonomous delivery, supervised single-writer coding, Ralph execution, long tests/builds/PR completion, or recovery from SDK timeout, idle timeout, queue/process split-brain, and silent completed-without-continuation stalls. Establishes one writer, a durable ledger, scheduled pacing, and an external detached watchdog; do not use for ordinary one-off commands or simple monitoring.
metadata:
  author: CoC
  version: "0.0.1"
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
- Dense crash or audit text persists in conversation context and can repeatedly
  trigger content classification. Keep full output on disk and carry compact
  verdicts plus file paths.
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

Inspect or stop the exact helper instance:

```text
coc reliability-watchdog status --state-dir ./reliability-state/watchdog
coc reliability-watchdog stop --state-dir ./reliability-state/watchdog
```

`stop` writes an instance-bound stop request; it does not signal an arbitrary
reused PID. The helper resolves the endpoint from `--server-url`,
`COC_SERVER_URL`, or CoC serve configuration, verifies `/api/health`, and
requires an explicit URL when runtime binding differs from configuration.

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
