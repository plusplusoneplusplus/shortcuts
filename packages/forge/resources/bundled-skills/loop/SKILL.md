---
name: loop
description: Schedule recurring follow-up messages into the current conversation. Supports fixed-interval monitoring and one-shot wakeups for dynamic self-pacing.
metadata:
  author: CoC
  version: "0.0.1"
---

# Loop — Recurring Follow-Ups

Schedule recurring follow-up messages into the current conversation so the AI can monitor, check, or re-evaluate on a cadence without human intervention.

## When to Use

- The user asks to "check back", "monitor", "keep an eye on", or "remind me".
- A task needs periodic re-evaluation (build status, deployment health, metric tracking).
- The user wants dynamic self-pacing: "come back when X is ready".

## Available Tools

When this skill is active you have three additional tools:

| Tool | Purpose |
|------|---------|
| `createLoop` | Create a fixed-interval recurring loop. First tick fires after one full interval — the current turn is the implicit first run. |
| `cancelLoop` | Cancel an active or paused loop by ID. |
| `listLoops` | List all loops for this conversation, optionally filtered by status. |

The `scheduleWakeup` tool (one-shot delayed follow-up) is always available regardless of this skill.

## Interval Parsing

Intervals accept human-friendly strings: `30s`, `5m`, `1h`, `2h`, `1d`, or raw milliseconds.
Minimum interval for `createLoop` is **10 seconds**. Minimum delay for `scheduleWakeup` is **1 second**.

## Choosing Between Loop and Wakeup

| Scenario | Tool |
|----------|------|
| Periodic monitoring (every 5 min check build status) | `createLoop` |
| One-time delayed check ("check in 30 minutes") | `scheduleWakeup` |
| Dynamic pacing ("come back when the deploy finishes") | `scheduleWakeup` — check once, then schedule another if not done |

## Slash-Compatible Fixed Interval Mode

When this skill was explicitly selected and the user message starts with a duration followed by a task, treat it as a request for a recurring fixed-interval loop.

Examples:
- `1m what's the time now?` -> create a loop every 1 minute with prompt `what's the time now?`
- `30s check the build` -> create a loop every 30 seconds with prompt `check the build`
- `2h remind me to stretch` -> create a loop every 2 hours with prompt `remind me to stretch`

In this mode:
1. Run or answer the prompt immediately in the current turn.
2. Call `createLoop` with the parsed interval and remaining prompt.
3. Do not call `scheduleWakeup`; that tool is for one-shot delayed follow-ups.
4. Use the default TTL unless the user specifies a duration or stop condition.
5. If the remaining prompt is empty or nonsensical, ask for clarification instead of creating a loop.

## User Confirmation

Before creating a loop, **always confirm with the user**:
1. What you will monitor and why.
2. The proposed interval and how long it will run.
3. The stop condition — when you will cancel the loop.

For explicit fixed-interval slash-compatible input such as `1m check status`, the user's command is the confirmation. Do not ask an extra confirmation unless the interval, task, or stop condition is ambiguous or risky.

Example confirmation:
> I'll check the CI pipeline status every 5 minutes for up to 3 hours, and stop once all checks pass or a clear failure is detected. Shall I set this up?

## Intent-Based Escalation

For very long intervals (e.g. hours or days), consider whether the schedule system might be more appropriate. Mention this to the user as a suggestion — do not enforce it.

## Stop-Condition Recognition

Watch for signals that a loop should end:
- The monitored condition is met (build passed, deploy complete).
- The user says "stop", "cancel", "enough", or "no more".
- Repeated identical results suggest nothing is changing.

When a stop condition is detected, cancel the loop with `cancelLoop` and summarize the outcome.

## Circuit Breakers

The system enforces safety limits automatically:
- **3 consecutive failures** → loop auto-pauses.
- **3-day TTL default** → loop expires (override with the `ttl` parameter).
- **Max 100 consecutive automated turns per process** → pauses to prevent runaway loops.
- **Max 50 active loops per server.**

You do not need to enforce these — they are handled by the runtime.

## Best Practices

- Keep loop prompts focused and specific. A good loop prompt is a clear instruction, not a vague "check things".
- Set an appropriate TTL. Don't leave loops running indefinitely.
- Prefer shorter intervals for active debugging (30s–2m) and longer intervals for background monitoring (5m–1h).
- Use `listLoops` to show the user their active loops when asked.
- When a loop detects the goal is met, cancel it immediately rather than waiting for the next tick.
