---
name: delegate
description: Delegate a job from the current chat to a new conversation. Use when the user asks to delegate or hand off work.
metadata:
  author: Yiheng Tao
  version: "0.0.6"
---

# Delegate

Based on this conversation, delegate the requested job to a new conversation with the relevant context, constraints, and expected outcome.

## Invocation

Users reach this skill either through plain language ("hand this off to a new chat") or through the `/delegate [provider] <task>` command. Provider is the only optional parameter; there is no flag grammar.

| Input | Outcome |
| --- | --- |
| `/delegate Review the plan` | Delegate the review in `ask` mode, inheriting the provider as usual. |
| `/delegate claude Review the plan` | Delegate the review to Claude using its defaults. |
| `/delegate claude Review the plan with high effort` | Delegate to Claude at its High effort tier. |
| `/delegate Submit the outgoing commits as a PR` | Delegate in `autopilot` mode, since the job must push and open a PR. |

## Writing the handoff

Assemble a self-contained prompt holding the context, constraints, decisions, and expected outcome. Prefer file path references over pasted file contents. Describe the actual work so the child does it rather than delegating it onward.

Call `send_to_conversation` **without** a `processId` so a new conversation is created. Always include a short, task-specific `title` in this create-mode call, along with `content`. Use a non-empty title of at most 80 characters; surrounding whitespace is trimmed. The title stays the conversation's visible custom title across AI title generation and restarts.

Return the created chat link plus a one-line summary of the task and the chosen provider. A queued chat is queued, not finished — say so.

## Choosing a provider

Concrete providers are `copilot`, `codex`, `claude`, and `opencode`, matched case-insensitively; whether one is usable depends on the server's enabled providers. `auto` is not a value this tool accepts.

- Omit `provider` when the user did not name one, so the tool's existing parent inheritance of provider, model, and effort applies.
- An explicit provider selects that provider's own defaults, including when it matches the parent. Do not carry over the parent's model or effort.
- Apply clear natural-language overrides such as effort through the tool's supported options.
- Pick `mode` from what the job does. Use `ask` for read-only jobs: review, research, analysis, questions, and planning. Use `autopilot` for jobs that change files, the repo, or external state: implementing or fixing code, committing, pushing, opening PRs, and editing docs or skills. When it is unclear whether the job writes, ask one short question.
- Use `ralph` (create mode only) for long, multi-step build-until-done goals that write to the repo. It starts an autonomous Ralph loop with no clarifying questions, so write `content` as a self-contained goal spec: goal, acceptance criteria, constraints, and references by path. It shares the autopilot queue and returns a `sessionId` with the chat link.
- An explicit user request for a mode wins. Autopilot jobs share one execution queue and may wait, so mention that when the current chat is waiting on the result.
- The destination defaults to the current workspace. Honor an explicit request for another repo by passing its name as `workspaceId` (use `name@server` when the same name exists on several servers), or call `list_workspaces` to find its id. Ask when the destination is ambiguous.
- Remote repos (on another registered CoC server) work in create mode: pass their `remote:<serverId>:<workspaceId>` id or `name@server`. The remote server's own provider defaults apply unless the user names a provider. Posting into an existing remote conversation is not supported.

## Ambiguity and failure

- Treat an unambiguous leading provider name as provider selection. Keep provider mentions inside ordinary task text as task text. For wording like "Claude integration review," ask whether Claude is the provider or the subject. An unknown first word is not a provider — clarify an apparent typo or unsupported provider.
- With a bare `/delegate` or a provider alone, proceed only when the conversation clearly identifies one task and outcome. Otherwise ask one focused question first.
- If a provider is unavailable or an override is incompatible, explain the specific problem and offer the known alternatives. Never silently substitute a provider, model, or effort.
- If dispatch is rejected, report the reason and correct the request before retrying. If the result is uncertain or timed out, do not dispatch again — check existing conversation state, return the child link if creation is confirmed, and otherwise say creation is unconfirmed.
