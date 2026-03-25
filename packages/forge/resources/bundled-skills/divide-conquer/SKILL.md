---
name: divide-conquer
description: >-
  Divide a problem into independent pieces, process each in parallel via sub-agents,
  and conquer by aggregating results. Supports multi-stage pipelines where the output
  of one stage feeds the next. Only invoke when the user explicitly asks to use the
  divide-conquer skill or pattern by name. Do not auto-select for general tasks.
---

# Divide & Conquer

A generic orchestration pattern with 4 roles: **Orchestrator**, **Discoverer**, **Mapper**, **Reducer**. You are the Orchestrator.

## Roles

**Orchestrator** (you) — Analyze the request. Decompose it into a stage plan. Manage data flow, concurrency, and error handling. All inter-stage data lives as physical files in a working directory.

**Discoverer** (single sub-agent) — Given a goal, enumerate the input set. Return a JSON array of items. The discoverer decides *how* to find items (filesystem, git, APIs, search, AI reasoning — whatever fits).

**Mapper** (N sub-agents, parallel) — Each receives one item (or a small batch) and a task. Returns structured JSON results. Mappers are stateless and independent. Run up to 5 in parallel.

**Reducer** (single sub-agent) — Receives all mapper outputs. Produces a consolidated result: a new item list (for the next stage) or a final output.

## Stage Plan

Decompose the user's request into an ordered sequence of stages:

```
[discover] → [map] → [reduce] → [map] → [reduce] → ...
```

A pipeline always starts with `discover` and alternates `map`/`reduce`. The reduce output of one cycle becomes the input for the next map. The final reduce produces the end result.

Present the stage plan before executing. If the discover phase yields more than 3 items, confirm with the user via `ask_user` before proceeding to map.

## Working Directory

Before executing, initialize the working directory using the [init script](scripts/init-run.ps1):

```powershell
powershell -File .github/skills/divide-conquer/scripts/init-run.ps1 -Slug "<short-name>"
```

This creates:
```
.divide-conquer/
├── .gitignore
└── <timestamp>-<slug>/
    ├── plan.json
    ├── stage-1-discover/
    │   └── output.json
    ├── stage-2-map/
    │   ├── input.json
    │   ├── item-000.json
    │   └── output.json
    ├── stage-3-reduce/
    │   ├── input.json
    │   └── output.json
    └── result.md
```

Stage directories are created as needed during execution.

## Data Contract

All inter-stage data is **JSON files** containing arrays of objects:

```json
[{"key": "value", "key2": 123}, ...]
```

| File | Written by | Purpose |
|------|-----------|---------|
| `plan.json` | Orchestrator | Stage plan |
| `output.json` | Discoverer / Reducer | Stage result |
| `input.json` | Orchestrator | Copied from prior stage output |
| `item-NNN.json` | Mapper | Per-item result |
| `result.md` | Orchestrator | Final human-readable output |

## Execution Flow

```
1. Analyze the user's request
2. Decompose into stage plan
3. Run init script → get run directory
4. Write plan.json
5. For each stage:
   a. Create stage directory, write input.json from prior output
   b. Dispatch sub-agent(s):
      - discover → 1 discoverer (explore agent)
      - map     → N mappers in parallel (explore or general-purpose)
      - reduce  → 1 reducer (explore or general-purpose)
   c. Merge mapper item files into output.json (for map stages)
6. Write result.md
7. Present final output
```

## Model Selection

| Role | Model | Rationale |
|------|-------|-----------|
| Discoverer | `claude-opus-4.6` | Enumeration is straightforward |
| Mapper | `claude-sonnet-4.6` or `gpt-5.4` | Parallel work — fast, capable, cost-effective at scale |
| Reducer | `claude-opus-4.6` | Synthesis requires deeper reasoning over all results |

Pass the model via the `model` parameter on the `task` tool.

## Sub-Agent Dispatch

Use the `task` tool. Provide each sub-agent with:
1. Its role prompt from [references/](references/)
2. The working directory path and which files to read/write
3. The task-specific instructions derived from the user's request
4. For mappers: the item to process and the output schema
5. For reducers: whether this is a mid-pipeline reduce (output = new item list) or final reduce (output = report)

See reference prompts:
- [Discoverer prompt](references/discoverer.prompt.md)
- [Mapper prompt](references/mapper.prompt.md)
- [Reducer prompt](references/reducer.prompt.md)

## Error Handling

- **Failed mapper**: Write `item-NNN.json` with `{"__error": "description"}`. Continue. Report failures in result.md.
- **Failed discoverer**: Fatal. Stop and report to user.
- **Failed reducer**: Fall back to concatenating raw mapper outputs. Warn user.
- **Resumability**: Check for existing `output.json` before running a stage. Skip completed stages.

## Parameters

Determine these from context or ask the user:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_parallel` | 5 | Concurrent mapper sub-agents |
| `agent_type` | auto | `explore` for read-only, `general-purpose` for mutations |
| `confirm_threshold` | 5 | Confirm with user if items exceed this |
