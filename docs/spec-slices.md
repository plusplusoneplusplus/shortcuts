# Spec Slices for Autonomous Ralph Loops

This document defines the artifact format the `grill-me` skill produces and the
`buildRalphIterationPrompt` execution contract reads. The goal is to let an AI
loop autonomously to completion on the common case without re-deriving the same
context every iteration.

## Why Spec Slices

A one-line acceptance criterion is enough for a human reviewer but not for an
autonomous loop. Each iteration would otherwise re-derive:

- which files / routes / components to touch
- the lifecycle / state machine
- the exact API contract
- the "done" signal for each slice
- which assumptions are revisable and which are decisions

Spec slices capture that context once so the loop converges instead of
drifting.

## Artifact Layout

```
Plans/<area>/<feature>/
  goal.md              # always; north star, ACs, decisions, references
  architecture.md      # only if the feature has non-trivial state or new abstractions
  ac-NN-<slug>.spec.md # one per functional AC, only when the size threshold tripped
  test-plan.md         # only if test strategy is non-obvious
  open-questions.md    # only if any [open] items survived grilling
```

**Size threshold.** A single `goal.md` is sufficient when the feature has **3
or fewer functional ACs** and **no new persistent state**. Otherwise, split
into slices. The `grill-me` skill decides and tells the user.

## Decision-Tagging Convention

Inside any spec slot, tag items as one of:

| Tag | Meaning | Implementer obligation |
| --- | --- | --- |
| `[decision]` | User committed to this in grilling. | Must not change. If wrong, stop and surface the conflict. |
| `[assumption]` | Grill's recommendation. | May revise; must log change + rationale in `progress.md`. |
| `[open]` | Unresolved. | Ask the user, or pick a value and justify in `progress.md`. |

Decision tagging is the single biggest lever for autonomy: it tells the
implementer which corners may be cut and which must be respected.

## YAML Frontmatter

Both `goal.md` and slice files carry frontmatter so tools can list and order
ACs deterministically.

`goal.md`:

```yaml
---
feature: <slug>
status: ready-for-ralph | needs-clarification
---
```

`ac-NN-<slug>.spec.md`:

```yaml
---
id: AC-<N>
depends-on: [AC-<X>, AC-<Y>]
status: pending | in-progress | done
---
```

## Slice Template

Two slots are mandatory: **Behavior** and **Definition of Done**. Everything
else is optional.

```markdown
# AC-<N>: <title>

## Behavior
Concrete user-visible flow, step by step.
"User clicks X → system does Y → on error shows Z."

## Surfaces (speculative)
File / route / component map. Each entry tagged [decision] or [assumption].

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

The **Definition of Done** lives entirely inside the spec text — it does not
require a per-feature npm script. The implementer copies the test command
verbatim into the iteration's tool calls.

## How Ralph Uses Slices

Each Ralph iteration prompt embeds the spec contract (`RALPH_SPEC_CONTRACT_PROMPT`
in `packages/coc/src/server/ralph/iteration-prompt.ts`). On every iteration the
agent:

1. Reads `goal.md` first, then `progress.md`.
2. Picks the next undone slice whose `depends-on` entries are all done.
3. Reads the slice file in full before editing code.
4. Treats `[decision]` items as immutable, revises `[assumption]` items with
   a `progress.md` log entry, and resolves `[open]` items by asking or
   picking-and-justifying.
5. Stops the iteration only when the slice's Definition of Done is satisfied,
   recording evidence (test command output, demo transcript, code-search
   results) in `progress.md`.
6. Declares the overall Ralph session complete only when every functional
   AC's Definition of Done is satisfied.

## Restraint Guards

- Slice fields are all optional except Behavior and Definition of Done.
- Single-file `goal.md` remains the default for small features.
- Grilling stops the moment the user signals "enough"; remaining slots are
  filled with the grill's recommended answers tagged `[assumption]`.
- No pseudocode and no file diffs in specs. Only API/JSON shapes are allowed
  as code blocks.

## Ready-for-Ralph Checklist

The grill skill prints this checklist at the end of grilling:

- [ ] every functional AC has a Definition of Done
- [ ] no `[open]` items remain, or `open-questions.md` exists
- [ ] dependency graph has no cycles
- [ ] `## References to Load` lists the cross-cutting docs the implementer needs

`open-questions.md` is a **warning, not a block** — Ralph may still start, but
must resolve every `[open]` item via ask-or-pick-and-justify before completing
the affected slice.
