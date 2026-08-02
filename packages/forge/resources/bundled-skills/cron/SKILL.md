---
name: cron
description: Schedule recurring follow-up messages into the current conversation. Supports fixed-interval monitoring and one-shot wakeups for dynamic self-pacing.
metadata:
  author: CoC
  version: "0.0.2"
---

# Cron — Recurring Follow-Ups

Schedule recurring follow-up messages into the current conversation so the AI can monitor, check, or re-evaluate on a cadence without human intervention.

## When to Use

- The user asks to "check back", "monitor", "keep an eye on", or "remind me".
- A task needs periodic re-evaluation (build status, deployment health, metric tracking).
- The user wants dynamic self-pacing: "come back when X is ready".

## Available Tools

When this skill is active you have one additional tool: `cron`, with an `action` parameter:

| Action | Purpose |
|--------|---------|
| `cron` action `create` | Create a fixed-interval recurring cron (requires `description`, `interval`, `prompt`). First tick fires after one full interval — the current turn is the implicit first run. |
| `cron` action `cancel` | Cancel an active or paused cron by `cronId`. |
| `cron` action `list` | List all crons for this conversation, optionally filtered by `status`. |

The `scheduleWakeup` tool (one-shot delayed follow-up) is always available regardless of this skill.

## Interval Parsing

Intervals accept human-friendly strings: `30s`, `5m`, `1h`, `2h`, `1d`, or raw milliseconds.
Minimum interval for `cron` action `create` is **10 seconds**. Minimum delay for `scheduleWakeup` is **1 second**.

## Choosing Between Cron and Wakeup

| Scenario | Tool |
|----------|------|
| Periodic monitoring (every 5 min check build status) | `cron` action `create` |
| One-time delayed check ("check in 30 minutes") | `scheduleWakeup` |
| Dynamic pacing ("come back when the deploy finishes") | `scheduleWakeup` — check once, then schedule another if not done |

## Slash-Compatible Fixed Interval Mode

When this skill was explicitly selected and the user message starts with a duration followed by a task, treat it as a request for a recurring fixed-interval cron.

Examples:
- `1m what's the time now?` -> create a cron every 1 minute with prompt `what's the time now?`
- `30s check the build` -> create a cron every 30 seconds with prompt `check the build`
- `2h remind me to stretch` -> create a cron every 2 hours with prompt `remind me to stretch`

In this mode:
1. Run or answer the prompt immediately in the current turn.
2. Call the `cron` tool with action `create`, the parsed interval, and the remaining prompt.
3. Do not call `scheduleWakeup`; that tool is for one-shot delayed follow-ups.
4. Use the default TTL unless the user specifies a duration or stop condition.
5. If the remaining prompt is empty or nonsensical, ask for clarification instead of creating a cron.

## User Confirmation

Before creating a cron, **always confirm with the user**:
1. What you will monitor and why.
2. The proposed interval and how long it will run.
3. The stop condition — when you will cancel the cron.

For explicit fixed-interval slash-compatible input such as `1m check status`, the user's command is the confirmation. Do not ask an extra confirmation unless the interval, task, or stop condition is ambiguous or risky.

Example confirmation:
> I'll check the CI pipeline status every 5 minutes for up to 3 hours, and stop once all checks pass or a clear failure is detected. Shall I set this up?

## Intent-Based Escalation

For very long intervals (e.g. hours or days), consider whether the schedule system might be more appropriate. Mention this to the user as a suggestion — do not enforce it.

## Stop-Condition Recognition

Watch for signals that a cron should end:
- The monitored condition is met (build passed, deploy complete).
- The user says "stop", "cancel", "enough", or "no more".
- Repeated identical results suggest nothing is changing.

When a stop condition is detected, cancel the cron with the `cron` tool (action `cancel`) and summarize the outcome.

## Circuit Breakers

The system enforces safety limits automatically:
- **3 consecutive failures** → cron auto-pauses.
- **3-day TTL default** → cron expires (override with the `ttl` parameter).
- **Max 100 consecutive automated turns per process** → pauses to prevent runaway crons.
- **Max 50 active crons per server.**

You do not need to enforce these — they are handled by the runtime.

## Best Practices

- Keep cron prompts focused and specific. A good cron prompt is a clear instruction, not a vague "check things".
- Set an appropriate TTL. Don't leave crons running indefinitely.
- Prefer shorter intervals for active debugging (30s–2m) and longer intervals for background monitoring (5m–1h).
- Use the `cron` tool with action `list` to show the user their active crons when asked.
- When a cron detects the goal is met, cancel it immediately rather than waiting for the next tick.
