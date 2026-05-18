---
name: grill-me
description: Interview the user about a plan or design and produce an autonomy-ready spec artifact. Use when the user wants to stress-test a plan, get grilled on a design, mentions "grill me", or when promoting an ask-mode chat into a Ralph loop.
metadata:
  author: Yiheng Tao
  version: "0.1.1"
---

# Grill Me

Adapted from [mattpocock/skills · grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md), extended with a two-phase flow, decision tags, slice template, and Definition of Done so the output is consumable by an autonomous Ralph loop.

Interview the user about a plan until both sides share enough understanding for an AI to **loop autonomously to completion** without further human input for the common case. The output is a structured artifact, not a conversation transcript.

Ask one question at a time. For each question, offer a recommended answer so the user can accept with "yes" or override briefly. If a question can be answered by exploring the codebase, explore the codebase instead of asking.

## Two-Phase Flow

### Phase 1 — Scope (lightweight, ~10 questions)

Capture only what is needed to size the work:

- Goal in one sentence.
- Functional acceptance criteria (high level, numbered).
- Out-of-scope items.
- Hard constraints (multi-repo, feature flag, platforms, security).
- References the implementer must read before starting.

At the end of Phase 1, apply the **size threshold**:

- If the feature has **3 or fewer functional ACs** and **no new persistent state**, a single `goal.md` is sufficient. Stop here, write `goal.md`, and skip Phase 2.
- Otherwise, tell the user: "this feature is large enough to split into spec slices" and proceed to Phase 2.

### Phase 2 — Per-AC depth (only when the size threshold trips)

For each functional AC, walk the slice template (below) and fill its slots. Each question carries a recommended answer. The user may say:

- **"good enough, AI figures the rest"** — remaining slots are filled with the recommended answers, each tagged `[assumption]`.
- **"split this AC"** — turn the AC into two ACs and continue grilling each.
- **"skip this slot"** — leave the slot empty unless it is required (Behavior or Definition of Done).

Two slots are mandatory per slice: **Behavior** and **Definition of Done**. Everything else is optional.

## Decision Tagging Convention

Inside any spec slot, tag items as one of:

- `[decision]` — the user committed to this in grilling. The implementer must not change it.
- `[assumption]` — the grill skill's recommendation. The implementer may revise it but must log the change and rationale in `progress.md`.
- `[open]` — unresolved. The implementer must either ask the user or pick a value and justify it in `progress.md`.

Decision tagging is the single biggest lever for autonomy: it tells the implementer which corners may be cut and which must be respected.

## Output Artifact

Write into the conversation's plan area:

```
Plans/<area>/<feature>/
  goal.md              # always; north star, ACs, decisions, references, dependency graph
  architecture.md      # only if the feature has non-trivial state or new abstractions
  ac-NN-<slug>.spec.md # one per functional AC, only when the size threshold tripped
  test-plan.md         # only if test strategy is non-obvious
  open-questions.md    # only if any [open] items survived grilling
```

When promoted into a Ralph synthesis turn (no plan area available), emit a single `## Goal` Markdown block as described by the synthesis prompt, but still carry the decision tags inline.

### `goal.md` skeleton

```markdown
---
feature: <slug>
status: ready-for-ralph | needs-clarification
---

# <Feature Title>

## Goal
One or two short paragraphs.

## Functional Acceptance Criteria
1. [decision] AC-01: ...
2. [decision] AC-02: ...

## Out of Scope
- ...

## Constraints
- [decision] multi-repo: ...
- [decision] feature flag default: ...

## References to Load
- `path/to/file.md`
- `path/to/other.ts`

## Dependency Graph
- AC-02 depends on AC-01

## Open Questions
None.  # or link to open-questions.md
```

### Slice skeleton (`ac-NN-<slug>.spec.md`)

```markdown
---
id: AC-<N>
depends-on: [AC-<X>, AC-<Y>]
status: pending | in-progress | done
---

# AC-<N>: <title>

## Behavior
Concrete user-visible flow, step by step.
"User clicks X → system does Y → on error shows Z."

## Surfaces (speculative)
File / route / component map. Each entry tagged [decision] or [assumption].
The implementer may revise [assumption] entries; must not change [decision] entries.

## API Contract
REST route, request/response JSON shape, error codes. WebSocket events if any.

## Data Model
Persistent state shape + path under `~/.coc/repos/<workspaceId>/...`.

## UX States
empty / loading / success / error / in-progress / disabled-by-flag.

## Edge Cases & Failure Modes
Concurrency, cancellation, network failure, dirty state, partial writes.

## Depends On
Other AC ids.

## Definition of Done
1. Exact manual demo script (3-7 numbered steps a human can run).
2. Exact test command(s) that must pass.
3. Code-search assertions, e.g. "no TODOs added", "feature flag default still false".

## Open Questions
Explicit list. Empty if none.
```

The **Definition of Done** is the most important section. It is the stop-signal for a Ralph loop.

## Restraint Guards

- All slice fields are optional except **Behavior** and **Definition of Done**.
- A single-file `goal.md` is the default for small features.
- Stop grilling the moment the user signals "enough"; fill remaining slots with recommended answers tagged `[assumption]`.
- Do not put pseudocode or file diffs in specs. Only API/JSON shapes are allowed as code blocks.

## Ready-for-Ralph Checklist

At the end of grilling, print this checklist and mark each line:

- [ ] every functional AC has a Definition of Done
- [ ] no `[open]` items remain, or `open-questions.md` exists
- [ ] dependency graph has no cycles
- [ ] `## References to Load` lists the cross-cutting docs the implementer needs

If all checks pass, set `status: ready-for-ralph` in the `goal.md` frontmatter. Otherwise leave `status: needs-clarification` and tell the user which checks failed.

## Notes for the Synthesis Path

When this skill runs inside the Ralph promotion synthesis turn (mode=ask + `context.ralph.phase = 'grilling'`), output exactly one `## Goal` Markdown block — no preamble, no follow-up questions — and inline-tag any constraints with `[decision]` or `[assumption]` so the downstream Ralph loop honors them.
