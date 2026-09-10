---
name: delegate
description: Delegate a job from the current chat to a new conversation. Use when the user asks to delegate or hand off work.
metadata:
  author: Yiheng Tao
  version: "0.0.2"
---

# Delegate

Based on this conversation, delegate the requested job to a new conversation with the relevant context, constraints, and expected outcome.

## Invocation

Users reach this skill either through plain language ("hand this off to a new chat") or through the `/delegate [provider] <task>` command. Provider is the only optional parameter; there is no flag grammar.

| Input | Outcome |
| --- | --- |
| `/delegate Review the plan` | Delegate the review, inheriting the provider as usual. |
| `/delegate claude Review the plan` | Delegate the review to Claude using its defaults. |
| `/delegate claude Review the plan with high effort` | Delegate to Claude at its High effort tier. |

## Writing the handoff

Assemble a self-contained prompt holding the context, constraints, decisions, and expected outcome. Prefer file path references over pasted file contents. Describe the actual work so the child does it rather than delegating it onward.

Call `send_to_conversation` **without** a `processId` so a new conversation is created. Return the created chat link plus a one-line summary of the task and the chosen provider. A queued chat is queued, not finished — say so.

## Choosing a provider

Concrete providers are `copilot`, `codex`, `claude`, and `opencode`, matched case-insensitively; whether one is usable depends on the server's enabled providers. `auto` is not a value this tool accepts.

- Omit `provider` when the user did not name one, so the tool's existing parent inheritance of provider, model, and effort applies.
- An explicit provider selects that provider's own defaults, including when it matches the parent. Do not carry over the parent's model or effort.
- Apply clear natural-language overrides such as effort through the tool's supported options.
- `mode` defaults to `ask` and the destination defaults to the current workspace, even when the parent runs in Autopilot. Honor an explicit request for Autopilot or another registered workspace, and ask when the destination is ambiguous. Autopilot jobs share one execution queue and may wait, so `ask` is the better choice when the job must start right away or the current chat is waiting on its result.

## Ambiguity and failure

- Treat an unambiguous leading provider name as provider selection. Keep provider mentions inside ordinary task text as task text. For wording like "Claude integration review," ask whether Claude is the provider or the subject. An unknown first word is not a provider — clarify an apparent typo or unsupported provider.
- With a bare `/delegate` or a provider alone, proceed only when the conversation clearly identifies one task and outcome. Otherwise ask one focused question first.
- If a provider is unavailable or an override is incompatible, explain the specific problem and offer the known alternatives. Never silently substitute a provider, model, or effort.
- If dispatch is rejected, report the reason and correct the request before retrying. If the result is uncertain or timed out, do not dispatch again — check existing conversation state, return the child link if creation is confirmed, and otherwise say creation is unconfirmed.
