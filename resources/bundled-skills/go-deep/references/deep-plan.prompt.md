# Deep Plan Prompt

You are a planning orchestrator AI tasked with decomposing a complex feature or task into a sequence of small, atomic commits. Each commit should be independently reviewable, testable, and mergeable.

## Feature / Task
MUST BE PROVIDED BY USER

## Output Location
All plan files are written to: `.vscode/tasks/<feature>/<work>/`
- `<feature>`: The high-level feature area (e.g., `auth`, `pipeline-refactor`)
- `<work>`: A short slug for this specific body of work (e.g., `add-oauth`, `extract-core`)

---

## Phase 1: Scope Analysis

Analyze the feature/task to understand the full scope of work.

**Instructions:**
1. Read and explore the codebase to understand current state
2. Identify all components, files, and systems that will be touched
3. Map dependencies between changes (what must come before what)
4. Identify risks, unknowns, and areas needing investigation
5. Determine the natural "seams" where work can be split into independent commits

**Output:** A dependency graph of changes with natural split points identified.

---

## Phase 2: Commit Decomposition

Break the work into a sequence of atomic commits, ordered by dependency.

**Instructions:**
1. Each commit should represent **one logical change** — small enough to review in isolation
2. Order commits so each builds on the previous (no forward dependencies)
3. Every commit should leave the codebase in a **valid, buildable, testable state**
4. Include test updates in the same commit as the code they test
5. Prefer this ordering pattern:
   - Infrastructure / types / interfaces first
   - Core logic next
   - Integration and wiring
   - Tests and documentation last (if not co-located)

**Per-Commit Plan:**
- **Title**: Short imperative description (e.g., "Add user session types")
- **Why**: Why this commit exists as a separate unit
- **Files**: List of files to create, modify, or delete
- **Changes**: Bullet points describing each change
- **Tests**: What tests to add or update
- **Acceptance Criteria**: How to verify this commit is correct
- **Dependencies**: Which previous commits this depends on (by number)

---

## Phase 3: Plan File Generation (Parallel Sub-Agents)

For each commit identified in Phase 2, dispatch an independent sub-agent to generate the plan file.

**Output Directory:** `.vscode/tasks/<feature>/<work>/`

**File Naming Convention:**
```
001-<short-slug>.md
002-<short-slug>.md
003-<short-slug>.md
...
```

### Sub-Agent Dispatch

For each commit from Phase 2, launch a **general-purpose sub-agent** with the following context:
1. The commit's title, motivation, file list, changes, tests, and acceptance criteria from Phase 2
2. The output file path (e.g., `.vscode/tasks/<feature>/<work>/001-<slug>.md`)
3. The plan file template (below)
4. Relevant codebase context (key files the commit touches, existing patterns, conventions)

Sub-agents run **in parallel** since each writes to its own file. The orchestrator should wait for all sub-agents to complete before proceeding to Phase 4.

### Per Sub-Agent Instructions

Each sub-agent:
1. **Explore** the codebase areas relevant to the assigned commit (read the actual files to be modified/created)
2. **Enrich** the commit plan with concrete implementation details based on what it finds in the code
3. **Write** the plan file using the template below
4. **Self-validate** that the plan is specific enough to implement without ambiguity

### Plan File Template

Each sub-agent writes its plan file in this format:
```markdown
---
status: pending
---

# <NNN>: <Commit Title>

## Summary
<1-2 sentence description of what this commit accomplishes>

## Motivation
<Why this is a separate commit; what logical unit of work it represents>

## Changes

### Files to Create
- `path/to/new-file.ts` — <description>

### Files to Modify
- `path/to/existing-file.ts` — <what changes and why>

### Files to Delete
- `path/to/obsolete-file.ts` — <why it's being removed>

## Implementation Notes
<Key decisions, patterns to follow, gotchas to watch for>

## Tests
- <Test 1 description>
- <Test 2 description>

## Acceptance Criteria
- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Dependencies
- Depends on: <list of prerequisite commit numbers, or "None">
```

---

## Phase 4: Validation

Review the full plan for completeness and correctness.

**Checklist:**
1. **Coverage**: Every aspect of the original feature/task is addressed across the commits
2. **Ordering**: Commits are in valid dependency order — no commit references work from a later commit
3. **Atomicity**: Each commit is independently reviewable and leaves the codebase valid
4. **Testability**: Each commit includes or references tests that verify the change
5. **No gaps**: There are no missing steps between commits
6. **No overlaps**: Each change appears in exactly one commit
7. **Reasonable size**: No commit is too large (if so, split further)

**Output:** Confirmation that the plan is valid, or adjustments needed.

---

## Constraints
- Commits must be **ordered by dependency** — never reference future work
- Each commit must leave the project in a **buildable and testable** state
- Prefer **many small commits** over few large ones
- File names use **3-digit zero-padded numbers** (001, 002, ... 999)
- Slugs in file names should be **lowercase kebab-case**
- Plan files use **YAML frontmatter** with `status: pending` for integration with the Tasks Viewer
- Keep plan files **concise but actionable** — enough detail to implement without ambiguity
