---
name: update-agents-md
description: Update AGENTS.md files across the repository to reflect the latest codebase status and create missing ones for critical folders. Uses sub-agents to explore and write in parallel, preserving main context. Use when AGENTS.md files are outdated or missing.
---

# Update AGENTS.md

Refresh and create AGENTS.md files throughout the repository using parallel sub-agents to keep the main context lean.

## Overview

AGENTS.md files provide developer-facing reference documentation for each module or package. This skill orchestrates sub-agents to:

1. **Discover** the repo structure and locate existing AGENTS.md files
2. **Identify** critical folders that are missing AGENTS.md
3. **Analyze** each folder's current state via sub-agents
4. **Write** updated or new AGENTS.md content via sub-agents

## Instructions

### Phase 1 — Discovery (main agent)

1. Find all directories that are "critical folders" — these are top-level feature modules, packages, or any directory that contains meaningful source code (e.g., has its own `package.json`, `tsconfig.json`, `src/` subdirectory, or multiple source files).
2. List all existing AGENTS.md files in the repo (exclude `node_modules`, `dist`, `out`, `.git`).
3. Classify each critical folder as:
   - **existing** — has an AGENTS.md already
   - **missing** — needs a new AGENTS.md

### Phase 2 — Analyze & Update (sub-agents, parallel)

For each critical folder, launch an **explore** or **general-purpose** sub-agent with a prompt tailored to that folder. Run sub-agents in parallel where possible (batch 3-5 at a time).

#### For folders with an existing AGENTS.md — use a sub-agent with this prompt pattern:

```
Read the file <path>/AGENTS.md and then explore the directory <path>/ to understand its current structure, public API, key files, dependencies, and recent changes.

Compare what the current AGENTS.md says with the actual state of the code. Produce a summary of what needs updating:
- Outdated descriptions or architecture diagrams
- Missing files, modules, or exports
- Stale references to removed code
- Missing build/test commands

Output a JSON object:
{
  "path": "<path>/AGENTS.md",
  "status": "up-to-date" | "needs-update",
  "changes": ["list of specific changes needed"]
}
```

#### For folders missing an AGENTS.md — use a sub-agent with this prompt pattern:

```
Explore the directory <path>/ to understand its purpose, structure, key files, public API, dependencies, build commands, and test commands.

Output a JSON object:
{
  "path": "<path>/AGENTS.md",
  "status": "missing",
  "purpose": "one-line summary",
  "structure": ["key files and subdirectories"],
  "publicApi": ["exported symbols or entry points"],
  "dependencies": ["internal and external deps"],
  "buildAndTest": "how to build and test this module",
  "notes": "anything else an agent should know"
}
```

### Phase 3 — Write (sub-agents, parallel)

For each folder that needs a new or updated AGENTS.md, launch a **general-purpose** sub-agent to do the actual file write. Batch 3-5 at a time.

#### For new AGENTS.md files — use this prompt pattern:

```
Create the file <path>/AGENTS.md with developer reference documentation for this module.

Here is the analysis:
<paste the JSON from Phase 2>

Follow this format:
1. H1 title: "<Module Name> - Developer Reference"
2. One-paragraph summary of what this module does
3. Key sections (only include sections that are relevant):
   - **Architecture / Structure** — directory layout, key files
   - **Public API** — main exports, entry points
   - **Dependencies** — internal (sibling modules) and external (npm packages)
   - **Build & Test** — commands to build and test
   - **Key Patterns** — important conventions or patterns used
   - **Notes** — gotchas, recent changes, or things to watch out for

Keep it concise and factual. Under 150 lines. Do not invent information — only document what exists in the code.
```

#### For updating existing AGENTS.md files — use this prompt pattern:

```
Update the file <path>/AGENTS.md to reflect the current state of the codebase.

Here are the changes needed:
<paste the JSON from Phase 2>

Rules:
- Preserve the existing structure and tone
- Make surgical edits — do not rewrite sections that are still accurate
- Add new sections only if the module has grown significantly
- Remove references to code that no longer exists
- Keep it under 150 lines
```

### Phase 4 — Verify (main agent)

After all sub-agents complete:

1. List all AGENTS.md files that were created or modified
2. Spot-check 1-2 files to confirm they look reasonable
3. Report a summary to the user:
   - How many AGENTS.md files were updated
   - How many new AGENTS.md files were created
   - Any folders that were skipped and why

## Tips

- Use `explore` sub-agents for Phase 2 (read-only analysis) and `general-purpose` sub-agents for Phase 3 (file writes).
- If the repo is very large, prioritize packages and top-level feature modules over deeply nested subdirectories.
- Look for existing conventions in the repo's AGENTS.md files and match the style.
- If a root-level AGENTS.md exists, update it last so it can reference the module-level files.
