---
name: pipeline-generator
description: Generate optimized YAML pipeline configurations from natural language requirements, or DAG workflow configurations for complex multi-stage processing with fan-out, fan-in, and scripting. Ask clarifying questions about task type, data source, and output format before creating pipelines. Use when users want to create, design, or build a pipeline or workflow for data processing, classification, research, or analysis tasks.
---

# Pipeline Generator

This skill helps you create optimized YAML pipeline configurations for the workspace's pipeline framework. It uses a question-driven approach to understand requirements before generating valid, production-ready pipeline YAML.

## When to Use This Skill

Use this skill when the user wants to:
- Create a new pipeline
- Design a data processing workflow
- Set up batch classification or analysis
- Build a multi-agent research system
- Generate pipeline configuration from requirements
- Run a **single one-shot AI prompt** (no CSV/batch required)
- Design a **DAG workflow** with branching, merging, or scripted data transformations

## Generation Process

Follow these steps in order:

### Step 1: Ask Clarifying Questions

**IMPORTANT:** Always start by asking these questions. Do NOT skip to generation.

Use the `ask_user` tool to gather requirements:

0. **Pipeline Mode**
   - "What kind of processing pipeline do you need?"
   - Options:
     - **Linear pipeline** — straightforward input → process → output (existing map-reduce or single-job)
     - **DAG workflow** — arbitrary graph with parallel branches, fan-out/fan-in, merge, transform, or script nodes

   If the user selects **Linear pipeline**, proceed with the existing Steps 1–8 unchanged.
   If the user selects **DAG workflow**, proceed to the DAG-specific questions below, then skip to Step 2w.

   **DAG-specific questions (when DAG workflow is selected):**

   **1w. Data Sources**
   - "How many data sources does this workflow have?"
   - Options: Single CSV/JSON, Multiple files, Inline data, AI-generated, Mixed (some of the above)

   **2w. Processing Stages**
   - "Describe the processing stages and how data flows between them."
   - Free-form: user describes the desired graph topology (e.g., "load data, split into bugs and features, analyze each separately, merge results, generate report")

   **3w. Script Nodes**
   - "Do any stages need to run external scripts or CLI tools?"
   - Options: Yes (ask for language/command), No

   **4w. Error Handling**
   - "If a node fails, should the workflow abort or continue with empty data?"
   - Options: Abort (default — fail fast), Warn (continue with empty output), Mixed (per-node decision)

   **5w. Output Format**
   - Same as existing question 5 (reuse)

1. **Task Type**
   - "What is the main goal of this pipeline?"
   - Options: Classification, Research/Analysis, Data Extraction, Document Generation, **Single one-shot AI call (no input data)**, Custom

2. **Data Source** *(skip if Single one-shot AI call)*
   - "Where will the input data come from?"
   - Options: CSV file (ask for path), Inline data (small dataset), AI-generated items, Multiple AI models (comparison)

3. **Data Description** (if CSV or inline)
   - "What fields/columns does your data have?" (e.g., title, description, priority)
   - "How many items do you expect to process?" (Small <50, Medium 50-1000, Large 1000+)

4. **Processing Goal**
   - "What should the pipeline do with each item?" (e.g., classify by severity, extract key points, analyze sentiment)
   - "What information should be extracted or generated?" (helps build output schema)

5. **Output Format**
   - "How would you like the results?"
   - Options: Prioritized list, Table/comparison, JSON export, CSV export, AI-generated summary

6. **Filtering** (optional, if applicable)
   - "Do you want to filter items before processing?" (saves cost)
   - If yes: "What conditions?" (e.g., status=open, priority=high)

### Step 2: Select Pattern

Based on answers, choose the appropriate pattern:

**Pattern A: Map-Reduce Classification**
- Use when: Batch classification/analysis of structured data
- Characteristics: CSV/inline input, parallel processing, structured output
- Example: Bug triage, code review, sentiment analysis

**Pattern B: AI Decomposition Research**
- Use when: Complex research or exploratory tasks
- Characteristics: AI-generated sub-tasks, parallel research, synthesis with deduplication
- Example: Technology evaluation, competitive analysis, literature review

**Pattern C: Template-Based**
- Use when: Reusable general-purpose processing
- Characteristics: Parameterized prompts, runtime data input
- Example: Documentation generation, code review checklist

**Pattern D: Single AI Job** *(new)*
- Use when: One-shot AI task — no CSV, no batch, no map-reduce cycle
- Characteristics: `job:` key only, top-level `parameters:`, no `input`/`map`/`reduce`
- Example: Summarize a PR diff, answer a Q&A question, generate a report from a pasted snippet
- Key constraint: `job:` and `map:` are mutually exclusive

**Pattern E: DAG Workflow**
- Use when: Complex multi-stage processing with branching, merging, or scripting
- Characteristics: Named nodes with explicit `from:` edges, arbitrary graph topology, supports all eight node types
- Example: ETL pipeline, multi-source comparison, fan-out classification with merge

### Step 3: Design Input Phase

Generate input configuration based on data source:

**For CSV:**
```yaml
input:
  from:
    type: csv
    path: "path/to/data.csv"  # Use user-provided path
  limit: 100  # Add for testing if large dataset
```

**For Inline Items:**
```yaml
input:
  items:
    - field1: value1
      field2: value2
    # ... (use user's data)
```

**For AI-Generated:**
```yaml
input:
  generate:
    prompt: "Generate [N] items for [user's goal]"
    schema: [field1, field2, field3]  # Infer from user's description
    model: "gpt-4"
```

**For Multi-Model Comparison:**
```yaml
input:
  from:
    - model: gpt-4
    - model: claude-sonnet-4
  parameters:
    - name: sharedData
      value: "[user's data]"
```

### Step 3b: Design Single Job (Pattern D only)

If Pattern D was selected, skip Steps 3–6 and generate a `job:` pipeline instead:

```yaml
name: "[Descriptive Name]"
description: "[What this job does]"

job:
  prompt: |
    [Task instructions]
    {{param1}}
    {{param2}}

  # Optional: structured output fields (omit for raw text)
  output:
    - field1
    - field2

  model: "gpt-4o"       # Optional, falls back to default
  timeoutMs: 60000      # Optional, default: 30 min

# Top-level parameters (not nested under input)
parameters:
  - name: param1
    value: "..."         # Or supplied via --param param1="..." at CLI
  - name: param2
    value: "..."
```

**Single-job design decisions:**
- `output:` omitted → raw AI text returned (text mode)
- `output:` specified → AI response parsed as JSON, extract those fields
- Parameters supplied at YAML authoring time OR overridden via `--param` at CLI
- `promptFile:` and `skill:` are supported identically to map phase
- No `input:`, `map:`, `reduce:` sections — these are forbidden alongside `job:`

**Use `coc run` to execute:** `coc run path/to/pipeline.yaml --param param1="value"`

After designing the job, skip to **Step 7: Validate**.

---

### Step 3w: Design DAG Workflow (Pattern E only)

If Pattern E was selected, skip Steps 3–6 and design the workflow graph:

**3w-a. Identify nodes:** Based on the user's processing stages description, identify each node with:
- A descriptive kebab-case ID (e.g., `load-bugs`, `filter-critical`, `map-analyze`)
- The appropriate node type (`load`, `script`, `filter`, `map`, `reduce`, `merge`, `transform`, `ai`)
- Parent edges (`from:` array) connecting it to upstream nodes

**3w-b. Configure each node** using the type-specific fields from the [workflow schema reference](references/workflow-schema.md).

**Note on `ai` vs `map` vs `reduce`:**
- Use `map` when each item needs **independent** analysis (one AI call per item)
- Use `ai` when the AI needs to see **all items holistically** (comparison, deduplication, synthesis)
- Use `reduce` with `strategy: ai` when aggregating map outputs into a summary

**3w-c. Apply settings defaults** in the top-level `settings:` block for shared `concurrency`, `timeoutMs`, and `model` values.

**3w-d. Validate the graph:**
- Every `from:` reference resolves to a defined node
- No cycles
- `merge` nodes have ≥2 parents
- `load` nodes have no parents
- Every AI node has a `prompt` or `promptFile`
- Every `script` node has a `run` command

After designing the workflow, skip to **Step 7: Validate**.

**Example DAG Workflow:**
```yaml
name: "Bug Triage with Script Enrichment"
description: "Load bugs, enrich via script, classify, generate report"

settings:
  concurrency: 5
  model: "gpt-4"

nodes:
  load-bugs:
    type: load
    source:
      type: csv
      path: "bugs.csv"

  enrich:
    type: script
    from: [load-bugs]
    run: "python3 enrich.py"
    input: json
    output: json

  classify:
    type: map
    from: [enrich]
    prompt: |
      Classify bug: {{title}}
      Description: {{description}}
      Enriched: {{enrichment_data}}

      Return JSON with severity and category.
    output: [severity, category]

  report:
    type: reduce
    from: [classify]
    strategy: ai
    prompt: |
      Summarize {{COUNT}} classified bugs:
      {{RESULTS}}

      Generate an executive summary with priorities.
    output: [summary, priorities]
```

---

### Step 4: Design Map Phase

Generate map configuration with optimized settings:

```yaml
map:
  prompt: |
    [Task verb] this item:
    {{field1}}: {{field1}}
    {{field2}}: {{field2}}
    
    [Instructions based on processing goal]
    
    Return JSON with:
    - [output_field1]: [description]
    - [output_field2]: [description]
  
  output: [field1, field2, field3]  # Infer from processing goal
  
  parallel: [3-5]  # Use decision tree below
  
  timeoutMs: [300000-900000]  # Use decision tree below
  
  model: "gpt-4"
```

**Parallelism Decision:**
- Small dataset (<10 items): `parallel: 3`
- Medium (10-100): `parallel: 5`
- Large (100+): `parallel: 5`

**Timeout Decision:**
- Classification/Extraction: `timeoutMs: 300000` (5 min)
- Analysis: `timeoutMs: 600000` (10 min)
- Research: `timeoutMs: 900000` (15 min)

**Output Schema Inference:**
- Classification → `[category, confidence, rationale]`
- Analysis → `[issues, score, recommendations]`
- Research → `[findings, sources, confidence]`
- Extraction → `[extracted_field1, extracted_field2, ...]`

### Step 5: Design Filter Phase (Optional)

If user requested filtering and data has structured fields:

**Rule-Based Filter:**
```yaml
filter:
  type: rule
  rule:
    mode: all  # Use 'all' for AND, 'any' for OR
    rules:
      - field: [field_name]
        operator: equals  # or: in, contains, gte, etc.
        value: [value]
```

**Available Operators:**
- Comparison: `equals`, `not_equals`, `greater_than`, `less_than`, `gte`, `lte`
- Set: `in`, `not_in`
- String: `contains`, `not_contains`, `matches` (regex)

### Step 6: Design Reduce Phase

Select reduce type based on output format:

**Deterministic (No AI):**
```yaml
reduce:
  type: list  # or: table, json, csv
```

**AI-Powered Synthesis:**
```yaml
reduce:
  type: ai
  prompt: |
    Analyzed {{COUNT}} items ({{SUCCESS_COUNT}} successful):
    {{RESULTS}}
    
    Tasks:
    1. [Group by relevant field from map.output]
    2. Identify patterns
    3. Prioritize by importance
    4. Generate recommendations
  
  output: [summary, priorities, patterns, recommendations]
  model: "gpt-4"  # Consider upgrading to better model for synthesis
```

**Use AI reduce when:**
- Need deduplication
- Need pattern detection
- Need prioritization with reasoning
- Need cross-item synthesis

### Step 7: Validate Configuration

Check for anti-patterns and issues:

**Schema Validation (Map-Reduce pipelines):**
- ✓ Exactly ONE input source (items/from/generate)
- ✓ Map has exactly ONE of prompt/promptFile
- ✓ Output is array of valid identifiers
- ✓ If reduce type='ai', has prompt/promptFile

**Schema Validation (Single-job pipelines):**
- ✓ `job:` and `map:` are mutually exclusive — error if both present
- ✓ `job:` has exactly ONE of prompt/promptFile
- ✓ No `input:`, `map:`, or `reduce:` sections present
- ✓ All `{{variable}}` in job prompt are listed in top-level `parameters:`

**Schema Validation (DAG Workflow):**
- ✓ `name` must be non-empty string
- ✓ `nodes` must be a non-empty object
- ✓ Every `from` reference points to an existing node ID
- ✓ No cycles in the node graph
- ✓ `merge` nodes have ≥2 parents
- ✓ `load` nodes have no `from`
- ✓ AI nodes have `prompt` or `promptFile`
- ✓ `script` nodes have `run`
- ✓ `filter` nodes have a `rule`
- ✓ `reduce` nodes have a `strategy`

**Anti-Pattern Detection (DAG):**
- ⚠️ Single linear chain of 2 nodes (load → reduce) → Suggest: use a linear pipeline instead
- ⚠️ `merge` with only 1 parent → Error: merge requires ≥2 parents
- ⚠️ Disconnected nodes (no `from` and not a `load`) → Warn: node unreachable
- ⚠️ `script` with `output: passthrough` feeding a `map` → Warn: map will receive original (un-transformed) data

**Anti-Pattern Detection:**
- ⚠️ Timeout < 60000ms → Warn: too aggressive
- ⚠️ Parallel > 10 → Warn: may hit rate limits
- ⚠️ Large CSV without limit → Suggest: add `limit: 100` for testing
- ⚠️ batchSize > 1 without {{ITEMS}} → Error: must include {{ITEMS}} in prompt
- ❌ `job:` + `map:` together → Error: mutually exclusive

### Step 8: Generate Complete YAML

Produce the final pipeline YAML with:
1. Descriptive name (from user's goal)
2. All required sections (input, map, reduce)
3. Optional filter (if applicable)
4. Inline comments explaining design decisions
5. Usage instructions

## Output Format

**For DAG Workflows:**

````markdown
```yaml
name: "[Descriptive Name]"
description: "[What this workflow does]"

settings:
  # [Explanation of defaults]
  concurrency: [value]
  model: "[model]"

nodes:
  [node-id]:
    type: [type]
    # [Explanation]
    [type-specific config]

  [node-id]:
    type: [type]
    from: [[parent-ids]]
    # [Explanation]
    [type-specific config]
```

**How to use:**
1. Save this as `.vscode/pipelines/[name]/pipeline.yaml`
2. Place any referenced CSV/JSON files in the same directory
3. Place any referenced scripts in the same directory (or adjust `cwd`)
4. Execute from the VSCode Pipelines view or via `coc run`
````

**For Linear Pipelines:**

Present the pipeline YAML with explanations:

````markdown
Here's your generated pipeline configuration:

```yaml
name: "[Descriptive Name]"

input:
  # [Explanation of input strategy]
  [input config]

filter:  # Optional
  # [Explanation of filter logic]
  [filter config]

map:
  # [Explanation of processing logic]
  # Parallel: [value] - [rationale]
  # Timeout: [value] - [rationale]
  [map config]

reduce:
  # [Explanation of aggregation strategy]
  [reduce config]
```

**How to use:**
1. Save this as `.vscode/pipelines/[name]/pipeline.yaml`
2. If using CSV input, create the CSV file at the specified path
3. Execute from the VSCode Pipelines view
4. For testing: The `limit: 100` setting processes only the first 100 items

**Key design decisions:**
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]
- [Decision 3]: [Rationale]
````

## Important Guidelines

1. **Always ask questions first** - Never skip to generation without clarifying requirements
2. **Use ask_user tool** - Present clear options for each question
3. **Validate before generating** - Check for anti-patterns and constraints
4. **Explain decisions** - Add inline comments to generated YAML
5. **Provide usage instructions** - Help user test and deploy the pipeline
6. **Optimize by default** - Use proven patterns (parallel: 5, reasonable timeouts)
7. **Consider cost** - Suggest filters to reduce AI calls, appropriate model selection

## Common Patterns Quick Reference

See [patterns reference](references/patterns.md) for detailed examples of:
- Map-Reduce Classification (bug triage, code review)
- AI Decomposition (multi-agent research)
- Template-Based (doc generation, reusable workflows)
- Multi-Model Fanout (consensus analysis)
- Hybrid Filtering (rule + AI filtering)
- **Single AI Job** (one-shot prompts, Q&A, summaries — no input/map/reduce)
- **DAG Workflow** (fan-out classification, ETL with scripting, multi-source merge)

## Schema Reference

See [schema reference](references/schema.md) for:
- Complete field specifications
- Validation rules
- Error messages
- Anti-patterns to avoid

See [workflow schema reference](references/workflow-schema.md) for:
- DAG workflow YAML format
- Node type specifications
- Graph validation rules
