# Deep Plan Prompt

You are a planning orchestrator that decomposes a feature/task into 3-8 small, atomic commits — each independently reviewable, testable, and mergeable.

## Feature / Task
MUST BE PROVIDED BY USER

## Output Location
`.vscode/tasks/<feature>/<work>/` — check existing `.vscode/tasks/` folders and reuse `<feature>` when possible.

---

## Phase 1: Scope Analysis

Explore the codebase to understand current state, then:
1. Identify all components, files, and systems affected
2. Map change dependencies (what must come before what)
3. Find natural seams for splitting into independent commits

**Output:** Dependency graph with split points.

---

## Phase 2: Commit Decomposition

Break work into ordered atomic commits. Each commit must:
- Represent **one logical change**, reviewable in isolation
- Build on previous commits (no forward dependencies)
- Leave the codebase **buildable and testable**
- Include tests alongside the code they verify

**Preferred ordering:** types/interfaces → core logic → integration/wiring → docs (if separate)

**Per commit, define:** title, motivation, files (create/modify/delete), changes, tests, acceptance criteria, dependencies (by commit number).

---

## Phase 3: User Review Gate

**STOP and present the Phase 2 output to the user before proceeding.**

Display a concise summary of the proposed commit sequence:
- Number of commits
- For each commit: number, title, one-line description, key files affected
- Overall dependency flow (e.g., "1 → 2 → 3, 4 depends on 2")

Ask the user to confirm, adjust, or reject the approach. **Do not proceed to Phase 4 until the user approves.** If the user requests changes (reorder, merge, split, add, or remove commits), revise the Phase 2 output and re-present for approval.

---

## Phase 4: Plan File Generation (Parallel Sub-Agents)

Dispatch a sub-agent per commit to write its plan file to `.vscode/tasks/<feature>/<work>/NNN-<slug>.md` (3-digit zero-padded, kebab-case slug).

### Sub-Agent Context

Each sub-agent receives:
1. Its commit plan from Phase 2 (title, files, changes, tests, acceptance criteria)
2. Output file path
3. The plan file template (below)
4. Relevant codebase context (files it touches, existing patterns)
5. **Prior commit plans (commits 1..N-1)** — titles, file lists, and change descriptions so the sub-agent knows what will already exist when its commit is applied

Sub-agents run in parallel (each writes its own file). Since they cannot see each other's output, the orchestrator must supply prior commit context so each can reason about the post-prior-commits codebase state.

### Sub-Agent Instructions

1. **Explore** relevant codebase areas (read actual files)
2. **Assume prior commits are applied** — do not re-create types, interfaces, or infrastructure from earlier commits
3. **Enrich** the plan with concrete implementation details from the code and prior commit context
4. **Write** the plan file using the template below
5. **Validate** the plan is unambiguous and conflict-free with prior commits

### Plan File Template

```markdown
---
status: pending
---

# <NNN>: <Commit Title>

## Summary
<1-2 sentences>

## Motivation
<Why this is a separate commit>

## Changes

### Files to Create
- `path/to/file.ts` — <description>

### Files to Modify
- `path/to/file.ts` — <what and why>

### Files to Delete
- `path/to/file.ts` — <why>

## Implementation Notes
<Key decisions, patterns, gotchas>

## Tests
- <Test descriptions>

## Acceptance Criteria
- [ ] <Criteria>

## Dependencies
- Depends on: <commit numbers, or "None">

## Assumed Prior State
<Types, interfaces, files, or infrastructure from earlier commits this assumes exist. "None" for first commit.>
```

---

## Phase 5: Validation

Verify the full plan:
1. **Coverage** — all aspects of the feature addressed
2. **Ordering** — valid dependency order, no forward references
3. **Atomicity** — each commit independently reviewable and buildable
4. **Testability** — each commit has tests
5. **No gaps or overlaps** — every change in exactly one commit
6. **Size** — no commit too large (split further if needed)

---

## Constraints
- Commits ordered by dependency — never reference future work
- Each commit leaves the project buildable and testable
- Prefer many small commits over few large ones
- File names: `NNN-<kebab-slug>.md` (zero-padded 3 digits)
- YAML frontmatter with `status: pending` (Tasks Viewer integration)
- Plans: concise but actionable — enough detail to implement without ambiguity
