# DAG Workflow Configuration Schema Reference

Complete specification for DAG workflow YAML configuration. For the linear pipeline format (`input`/`map`/`reduce` or `job:`), see [schema.md](schema.md).

## Root Configuration

```yaml
name: string                          # Required: Workflow identifier
description?: string                  # Optional: Human-readable description
settings?:                            # Optional: Cascade defaults for all nodes
  concurrency?: number                # Default: 5 (parallel AI calls per node)
  timeoutMs?: number                  # Default: 1800000 (30 min per node)
  model?: string                      # Default AI model for all AI nodes
  workingDirectory?: string           # AI session working directory
nodes:                                # Required: Named node map
  <node-id>: NodeConfig               # Each node keyed by unique kebab-case ID
```

**Settings cascade:** Node-level fields override `settings:` values. For example, if `settings.concurrency: 5` and a specific map node has `concurrency: 10`, the node uses 10.

---

## Common Fields (BaseNode)

All node types share these fields:

```yaml
<node-id>:
  type: string           # Required: Node type discriminant
  from?: string[]        # Parent node IDs (edges); omit for root nodes
  label?: string         # Optional display name
  onError?: abort | warn # Default: abort
```

- **`type`** — Required discriminant. One of: `load`, `script`, `filter`, `map`, `reduce`, `merge`, `transform`, `ai`
- **`from`** — Array of parent node IDs. Defines the DAG edges. Omit for root nodes (e.g., `load`).
- **`label`** — Human-readable name for display in logs and error messages.
- **`onError`** — `abort` (default): propagate error and halt workflow. `warn`: emit empty items and continue.

---

## Node Types

### `load` — Data Source

Loads data into the workflow. Must have no `from` (root node).

```yaml
<node-id>:
  type: load
  source:
    type: csv | json | inline | ai
    # Type-specific fields below
```

**CSV source:**
```yaml
source:
  type: csv
  path: "data.csv"          # Relative to pipeline package directory
  delimiter?: ","            # Default: ","
```

**JSON source:**
```yaml
source:
  type: json
  path: "data.json"         # Relative to pipeline package directory
```

**Inline source:**
```yaml
source:
  type: inline
  items:
    - field1: value1
      field2: value2
```

**AI-generated source:**
```yaml
source:
  type: ai
  prompt: "Generate 10 test items with fields: name, category, priority"
  schema: [name, category, priority]   # Expected output fields
  model?: "gpt-4"                       # Optional model override
```

---

### `script` — External Script Execution

Runs an external command (shell, Python, Node.js, etc.) with optional stdin/stdout data marshaling.

```yaml
<node-id>:
  type: script
  from: [parent-id]
  run: "python3 transform.py"    # Required: Command to execute (shell: true)
  args?: ["--flag", "value"]     # Optional: Additional arguments
  env?: { KEY: "value" }         # Optional: Environment variables
  cwd?: "./scripts"              # Optional: Working directory
  timeoutMs?: 120000             # Optional: Script timeout
  input?: json | csv | none      # How to send parent data to stdin (default: none)
  output?: json | csv | text | passthrough  # How to parse stdout (default: text)
  shell?: default | powershell | bash       # Shell to use (default: system shell)
```

**Input/Output modes:**
- `input: json` — Parent items serialized as JSON array to stdin
- `input: csv` — Parent items serialized as CSV to stdin
- `input: none` — No data sent to stdin
- `output: json` — Parse stdout as JSON array of items
- `output: csv` — Parse stdout as CSV
- `output: text` — Stdout as single item with `text` field
- `output: passthrough` — Pass parent items through unchanged (ignore stdout)

**Shell modes:**
- `shell: default` (or omitted) — system shell: `cmd.exe` on Windows, `/bin/sh` on Unix
- `shell: powershell` — `powershell.exe` — enables PowerShell cmdlets (`ConvertTo-Json`, `ForEach-Object`, etc.)
- `shell: bash` — `bash` — Bash syntax on Unix/WSL

> **Windows note:** When using `output: json`, the script must print a valid JSON array to stdout. On Windows with `shell: powershell`, use `ConvertTo-Json -AsArray` to produce the correct array output even when there is only one item.

---

### `filter` — Composable Boolean Filter

Filters items using recursive boolean rule composition.

```yaml
<node-id>:
  type: filter
  from: [parent-id]
  rule:                          # Required: Recursive filter rule
    type: field | ai | and | or | not
    # Type-specific fields below
```

**Field rule:**
```yaml
rule:
  type: field
  field: "severity"              # Field name to test
  op: eq                         # Filter operator (see table below)
  value: "critical"              # Comparison value
  values?: ["critical", "high"]  # For in/nin operators
```

**AI rule:**
```yaml
rule:
  type: ai
  prompt: |
    Is this item actionable?
    Title: {{title}}
    Return JSON: {"include": true}
  output: [include]              # Must include boolean 'include' field
  model?: "gpt-4"
```

**Boolean composition (and/or/not):**
```yaml
rule:
  type: and
  rules:
    - type: field
      field: status
      op: eq
      value: open
    - type: not
      rule:
        type: field
        field: priority
        op: lt
        value: 3
```

---

### `map` — Parallel Per-Item AI Processing

Processes each item independently with an AI call. One call per item (or per batch if `batchSize > 1`).

```yaml
<node-id>:
  type: map
  from: [parent-id]
  prompt: |                      # Exactly ONE of prompt/promptFile
    Analyze: {{title}}
    Return JSON with severity and category.
  promptFile?: "analyze.md"      # Alternative: load prompt from file
  output: [severity, category]   # Expected output fields
  model?: "gpt-4"               # Optional model override
  concurrency?: 5               # Parallel AI calls (overrides settings)
  timeoutMs?: 600000            # Per-item timeout (overrides settings)
  batchSize?: 1                 # Items per AI call (use {{ITEMS}} if > 1)
```

**When to use `map` vs `ai`:**
- Use `map` when each item needs **independent** analysis (one AI call per item)
- Use `ai` when the AI needs to see **all items holistically** (single AI call)

---

### `reduce` — Aggregation

Aggregates items from parent node into a single output using a specified strategy.

```yaml
<node-id>:
  type: reduce
  from: [parent-id]
  strategy: list | table | json | csv | concat | ai   # Required
  # For strategy: ai only:
  prompt?: |
    Summarize {{COUNT}} items:
    {{RESULTS}}
  promptFile?: "summarize.md"
  output?: [summary, priorities]
  model?: "gpt-4"
  timeoutMs?: 600000
```

**Strategies:**
- `list` — Output items as a formatted list
- `table` — Output items as a table
- `json` — Output items as JSON
- `csv` — Output items as CSV
- `concat` — Concatenate all items into a single array
- `ai` — Use AI to synthesize/summarize items (requires `prompt` or `promptFile`)

---

### `merge` — Combine Multiple Parent Outputs

Combines outputs from two or more parent nodes. Requires `from` with ≥2 parents.

```yaml
<node-id>:
  type: merge
  from: [parent-a, parent-b]     # Required: ≥2 parent node IDs
  strategy: concat | zip          # Required
```

**Strategies:**
- `concat` — Concatenate all parent items into a single array
- `zip` — Pair items from parents positionally (shorter array padded with nulls)

---

### `transform` — Field Manipulation

Transforms item fields without AI calls. Zero cost, deterministic.

```yaml
<node-id>:
  type: transform
  from: [parent-id]
  ops:                           # Required: Array of operations (applied in order)
    - op: select | drop | rename | add
      # Operation-specific fields below
```

**Select fields:**
```yaml
- op: select
  fields: [name, category, score]    # Keep only these fields
```

**Drop fields:**
```yaml
- op: drop
  fields: [internal_id, raw_data]    # Remove these fields
```

**Rename field:**
```yaml
- op: rename
  from: old_name
  to: new_name
```

**Add field:**
```yaml
- op: add
  field: pipeline_run
  value: "etl-2024"                  # Static value or {{template}} interpolation
```

---

### `ai` — Single AI Call (Holistic)

Makes a single AI call with all input items. Use for comparison, deduplication, synthesis across all items.

```yaml
<node-id>:
  type: ai
  from: [parent-id]
  prompt: |                      # Exactly ONE of prompt/promptFile
    Compare these items:
    {{ITEMS}}
    Return JSON with findings.
  promptFile?: "compare.md"
  output: [findings, recommendations]
  model?: "gpt-4"
  timeoutMs?: 600000
```

**When to use `ai` vs `map` vs `reduce`:**
- **`ai`** — Single call over all input items (holistic analysis, comparison, deduplication)
- **`map`** — One call per item (independent per-item analysis)
- **`reduce`** with `strategy: ai` — Aggregating map outputs into a summary

---

## Filter Operators

| Operator | Description | Value Type |
|----------|-------------|------------|
| `eq` | Equal to | single value |
| `neq` | Not equal to | single value |
| `in` | Value in list | `values` array |
| `nin` | Value not in list | `values` array |
| `contains` | Substring match (case-insensitive) | single value |
| `not_contains` | Substring not present | single value |
| `gt` | Greater than (numeric) | number |
| `lt` | Less than (numeric) | number |
| `gte` | Greater than or equal | number |
| `lte` | Less than or equal | number |
| `matches` | Regex pattern match | string pattern |

---

## Transform Operations

| Operation | Required Fields | Description |
|-----------|----------------|-------------|
| `select` | `fields: string[]` | Keep only specified fields |
| `drop` | `fields: string[]` | Remove specified fields |
| `rename` | `from: string`, `to: string` | Rename a field |
| `add` | `field: string`, `value: string` | Add a new field (supports `{{template}}` interpolation) |

---

## Template Variables

### Per Node Type

| Node Type | Variable | Description |
|-----------|----------|-------------|
| `map` | `{{fieldName}}` | Field values from input items |
| `map` | `{{ITEMS}}` | JSON array of batch items (when `batchSize > 1`) |
| `reduce` (ai) | `{{RESULTS}}` | JSON array of all parent items |
| `reduce` (ai) | `{{COUNT}}` | Total items count |
| `reduce` (ai) | `{{SUCCESS_COUNT}}` | Successful items count |
| `reduce` (ai) | `{{FAILURE_COUNT}}` | Failed items count |
| `ai` | `{{ITEMS}}` | JSON array of all input items |
| `ai` | `{{fieldName}}` | Field values from input items |
| `transform` (add) | `{{fieldName}}` | Interpolate existing field values |

---

## Validation Rules

### Required Fields
- ✓ `name` must be a non-empty string
- ✓ `nodes` must be a non-empty object (at least one node)

### Graph Integrity
- ✓ Every `from` reference must point to an existing node ID
- ✓ No cycles in the node graph (DFS detection)
- ✓ `merge` nodes must have ≥2 parents in `from`
- ✓ `load` nodes must have no `from` (they are root nodes)

### Node-Specific Constraints
- ✓ AI nodes (`map`, `reduce` with `strategy: ai`, `ai`, `filter` with `type: ai`) must have `prompt` or `promptFile`
- ✓ `script` nodes must have `run`
- ✓ `filter` nodes must have a `rule`
- ✓ `reduce` nodes must have a `strategy`
- ✓ `merge` nodes must have a `strategy`

### Anti-Patterns
- ⚠️ Single linear chain of 2 nodes (load → reduce) — consider a linear pipeline instead
- ⚠️ `merge` with only 1 parent — error: merge requires ≥2 parents
- ⚠️ Disconnected nodes (no `from` and not a `load`) — warning: node unreachable
- ⚠️ `script` with `output: passthrough` feeding a `map` — warning: map receives original (un-transformed) data

---

## Node Naming Convention

Use **kebab-case** for node IDs (e.g., `load-bugs`, `filter-critical`, `map-analyze`). This is consistent with pipeline package naming and produces readable log/error messages. This is a recommendation, not a hard requirement.
