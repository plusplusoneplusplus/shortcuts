# Pipeline Patterns Reference

This document provides detailed examples of proven pipeline patterns.

## Pattern 1: Map-Reduce Classification

**Use Case:** Batch processing with structured output and AI synthesis

### Example: Bug Triage Pipeline

```yaml
# Format: Linear (compiles to load → map → reduce workflow)
name: "Bug Classification Pipeline"

input:
  from:
    type: csv
    path: "bug-reports.csv"  # Columns: title, description, priority
  limit: 100  # Remove after testing

map:
  prompt: |
    Classify this bug report:
    Title: {{title}}
    Description: {{description}}
    Priority: {{priority}}
    
    Analyze severity, category, and estimated effort.
    
    Return JSON with:
    - severity: critical|high|medium|low
    - category: crash|performance|ui|security|other
    - effort_hours: estimated hours to fix (number)
  
  output: [severity, category, effort_hours]
  parallel: 5  # Optimal for 100 items (20 batches)
  timeoutMs: 300000  # 5 minutes per classification
  model: "gpt-4"

reduce:
  type: ai
  prompt: |
    Analyzed {{COUNT}} bug reports ({{SUCCESS_COUNT}} successful):
    {{RESULTS}}
    
    Tasks:
    1. Group by severity (critical → low)
    2. Sum effort_hours per category
    3. Identify patterns in critical bugs
    4. Recommend prioritization order for sprint planning
  
  output: [summary, prioritized_list, effort_breakdown, patterns]
  model: "gpt-4"
```

**Key Characteristics:**
- CSV input with structured data
- Parallel processing (5 concurrent AI calls)
- Structured output schema
- AI-powered synthesis for pattern detection

**When to Use:**
- Batch classification tasks
- Consistent schema across items
- Need prioritization with reasoning
- 10-10,000 items to process

---

## Pattern 2: AI Decomposition Research

**Use Case:** Complex research with dynamic task breakdown

### Example: Technology Evaluation Pipeline

```yaml
# Format: Linear (compiles to load → map → reduce workflow)
name: "Tech Stack Research"

input:
  generate:
    prompt: |
      Research topic: "Vector databases for code search"
      
      Decompose into 3-8 focused sub-queries for parallel research.
      For each sub-query:
      - focus_area: Specific aspect to research
      - complexity: simple|medium|high
      - tool_budget: Number of searches (5-15 based on complexity)
      - rationale: Why this matters for evaluation
    
    schema: [focus_area, complexity, tool_budget, rationale]
    model: "claude-opus-4"

map:
  prompt: |
    Research focus: {{focus_area}}
    Budget: {{tool_budget}} searches/tool uses
    
    Investigate thoroughly and track sources.
    
    Return JSON with:
    - findings: Key discoveries (array of strings)
    - sources: URLs with quality ratings (array of {url, type, quality})
    - confidence: high|medium|low based on source quality
  
  output: [findings, sources, confidence]
  parallel: 5
  timeoutMs: 600000  # 10 minutes for research tasks
  model: "claude-sonnet-4"  # Cheaper model for parallel workers

reduce:
  type: ai
  prompt: |
    Synthesize findings from {{COUNT}} research sub-agents:
    {{RESULTS}}
    
    Tasks:
    1. Deduplicate findings (merge similar discoveries)
    2. Rate source quality: academic > official docs > blog > forum
    3. Resolve conflicts (if agents disagree, explain why)
    4. Assess overall confidence based on source quality
    5. Generate executive summary with recommendations
  
  output: [executive_summary, key_findings, all_sources, confidence_assessment]
  model: "claude-opus-4"  # Best model for synthesis
```

**Key Characteristics:**
- AI-generated input (dynamic decomposition)
- Extended timeout (600s for deep research)
- Model mix (cheaper for map, best for reduce)
- Citation tracking with quality ratings
- Deduplication and conflict resolution

**When to Use:**
- Complex exploratory research
- Need parallel investigation of aspects
- Synthesis requires cross-finding reasoning
- Cost optimization important (model mix)

---

## Pattern 3: Template-Based Reusable Pipeline

**Use Case:** Parameterized workflows for different inputs

### Example: Code Review Checklist Generator

```yaml
# Format: Linear (compiles to load → map → reduce workflow)
name: "Code Review Checklist"

input:
  items: []  # Provided at runtime (git diffs, file changes)
  parameters:
    - name: reviewFocus
      value: "correctness, edge cases, security, performance"
    - name: riskThreshold
      value: "medium"

map:
  prompt: |
    Review this code change:
    File: {{file}}
    Change Type: {{changeType}}
    Diff: {{diff}}
    
    Focus on: {{reviewFocus}}
    Flag items at {{riskThreshold}} risk or higher.
    
    Generate checklist items:
    - what_to_check: Specific thing to verify
    - why: Why it matters
    - risk_level: critical|high|medium|low
  
  output: [what_to_check, why, risk_level]
  parallel: 5
  timeoutMs: 300000
  model: "gpt-4"

reduce:
  type: ai
  prompt: |
    Consolidate {{COUNT}} file-level checklists:
    {{RESULTS}}
    
    Focus: {{reviewFocus}}
    
    Tasks:
    1. Organize by risk_level (critical → low)
    2. Deduplicate cross-file items
    3. Assess overall risk across all changes
    4. Generate prioritized review checklist
  
  output: [prioritized_checklist, risk_assessment, review_recommendations]
  model: "gpt-4"
```

**Key Characteristics:**
- Empty items (runtime data)
- Parameters control behavior
- Same pipeline, different configurations
- Reusable template logic

**When to Use:**
- General-purpose templates
- Apply same logic to different data
- Integration into larger systems (IDEs, CI/CD)
- Need configuration flexibility

---

## Pattern 4: Multi-Model Fanout

**Use Case:** Compare results across different AI models

### Example: Multi-Model Code Analysis

```yaml
# Format: Linear (compiles to load → map → reduce workflow)
name: "Multi-Model Consensus Analysis"

input:
  from:
    - model: gpt-4
    - model: claude-sonnet-4
    - model: gemini-3-pro
  parameters:
    - name: codeSnippet
      value: |
        function processUser(user) {
          return user.name.toUpperCase();
        }

map:
  prompt: |
    Analyze this code:
    {{codeSnippet}}
    
    Using {{model}} model, evaluate:
    - Bugs/errors present
    - Edge cases not handled
    - Security issues
    
    Return JSON with:
    - issues: Array of problems found
    - severity: overall severity (critical|high|medium|low|none)
    - recommendations: Array of fixes
  
  output: [issues, severity, recommendations]
  model: "{{model}}"  # Per-item model selection
  parallel: 3  # One per model
  timeoutMs: 300000

reduce:
  type: ai
  prompt: |
    Compare analysis from {{COUNT}} AI models:
    {{RESULTS}}
    
    Tasks:
    1. Identify consensus issues (all models agree)
    2. Identify divergent opinions (models disagree)
    3. Assess severity consensus
    4. Generate unified recommendation list
  
  output: [consensus_issues, divergent_opinions, unified_recommendations]
```

**Key Characteristics:**
- Inline array input (model list)
- Parameters shared across all models
- Dynamic model selection via template
- Consensus analysis in reduce

**When to Use:**
- Compare model capabilities
- Need consensus or diverse perspectives
- Verify critical decisions across models

---

## Pattern 5: Hybrid Filtering

**Use Case:** Pre-filter with rules, confirm with AI

### Example: Smart Document Processing

```yaml
# Format: Linear (compiles to load → filter → map → reduce workflow)
name: "Filtered Document Analysis"

input:
  from:
    type: csv
    path: "documents.csv"  # Columns: title, content, category, priority

filter:
  type: hybrid
  combineMode: and  # Must pass both rule AND AI filters
  
  rule:
    mode: all  # All rules must match (AND logic)
    rules:
      - field: category
        operator: in
        values: [legal, financial, compliance]
      - field: priority
        operator: gte
        value: 5
  
  ai:
    prompt: |
      Document: {{title}}
      Content preview: {{content}}
      
      Is this document actionable and requires immediate review?
      Consider: urgency, completeness, relevance to business operations.
      
      Return JSON with:
      - include: true|false (whether to process this item)
      - reason: Brief explanation
    
    output: [include, reason]
    parallel: 5
    timeoutMs: 30000  # 30 seconds for filter decisions

map:
  prompt: |
    Analyze this high-priority document:
    {{title}}
    {{content}}
    
    Extract:
    - Key action items
    - Stakeholders involved
    - Deadline (if any)
    - Risk level
  
  output: [action_items, stakeholders, deadline, risk_level]
  parallel: 5
  timeoutMs: 600000

reduce:
  type: ai
  prompt: |
    Processed {{COUNT}} high-priority documents:
    {{RESULTS}}
    
    Generate:
    1. Prioritized action plan
    2. Stakeholder notification list
    3. Upcoming deadlines
    4. Risk mitigation strategies
  
  output: [action_plan, stakeholders, deadlines, risk_mitigation]
```

**Key Characteristics:**
- Rule filter (fast pre-screening)
- AI filter (semantic validation)
- Hybrid AND mode (strict filtering)
- Significant cost reduction (90% filtered by rules)

**When to Use:**
- Large datasets with structured fields
- Need semantic filtering (AI) but want cost control (rules first)
- Strict filtering requirements (both rule AND AI must approve)

**Cost Analysis:**
- 1000 items → Rule filter passes 100 → AI filter confirms 50 → Map processes 50
- Saves 950 map AI calls vs no filtering

---

---

## Pattern 6: Single AI Job

**Use Case:** One-shot AI prompt — no batch, no CSV, no map-reduce cycle

### Example 1: PR Summarizer

```yaml
# Format: Linear — Single Job (compiles to single ai node)
name: "Summarize PR"
description: "Generate a summary for a pull request"

job:
  prompt: |
    Summarize the following git diff in 3 bullet points:
    {{diff}}
  output:
    - summary
  model: gpt-4o
  timeoutMs: 60000

parameters:
  - name: diff
    value: "..."  # Or supplied via --param diff="..." at CLI
```

### Example 2: Q&A / Code Generation (text mode)

```yaml
# Format: Linear — Single Job (compiles to single ai node)
name: "Generate Release Notes"
description: "Generate release notes from a list of commits"

job:
  prompt: |
    You are a technical writer. Given the following commits, write concise release notes
    for version {{version}}:

    {{commits}}

    Format as markdown with sections: Features, Bug Fixes, Breaking Changes.
  # No output: field → raw AI text returned (text mode)
  model: gpt-4o
  timeoutMs: 120000

parameters:
  - name: version
    value: "2.5.0"
  - name: commits
    value: |
      feat: add single AI job support
      fix: guard config.map accesses
      feat: export JobConfig type
```

### Example 3: With Skill and PromptFile

```yaml
# Format: Linear — Single Job (compiles to single ai node)
name: "Deep Code Review"
description: "Review a code snippet using the go-deep skill"

job:
  promptFile: review.prompt.md   # Loaded from pipeline directory
  skill: go-deep                  # Prepends .github/skills/go-deep/SKILL.md
  output:
    - issues
    - suggestions
    - overall_rating
  model: gpt-4o
  timeoutMs: 180000

parameters:
  - name: code
    value: |
      function add(a, b) { return a + b; }
  - name: language
    value: JavaScript
```

**Key Characteristics:**
- Uses `job:` key instead of `input:`/`map:`/`reduce:`
- Top-level `parameters:` (not under `input`)
- `job:` and `map:` are mutually exclusive — validation error if both present
- `output:` optional: omit for raw AI text, specify fields for JSON parsing
- Supports `promptFile:` and `skill:` same as map phase
- Parameters overridable at runtime via `--param name=value`

**When to Use:**
- Single document/snippet to process (not a batch)
- Q&A, summarization, code generation, one-off analysis
- Tasks that don't iterate over items
- Quick AI utilities with configurable parameters

---

## Pattern Selection Guide

| User Need | Pattern | Format |
|-----------|---------|--------|
| "Classify/categorize items" | Map-Reduce Classification | Linear |
| "Research/investigate topic" | AI Decomposition | Linear |
| "Generate docs/checklists" | Template-Based | Linear |
| "Compare AI models" | Multi-Model Fanout | Linear |
| "Process large dataset efficiently" | Hybrid Filtering + Classification | Linear |
| "Batch analysis with custom rules" | Map-Reduce + Rule Filter | Linear |
| "One-shot prompt, no input data" | Single AI Job | Linear |
| "Summarize a document/diff/snippet" | Single AI Job | Linear |
| "Process data through parallel branches" | DAG Fan-Out Classification | DAG |
| "Mix scripts with AI processing" | ETL with Script Nodes | DAG |
| "Combine data from multiple sources" | Multi-Source Merge and Compare | DAG |
| "Review recent git commits in parallel" | Git-Driven Parallel Review | DAG |

---

## Pattern 7: DAG Fan-Out Classification

**Use Case:** Split a single data source into parallel branches for different analysis, then merge results.

```yaml
# Format: DAG Workflow (native nodes format)
name: "Multi-Category Bug Analysis"

settings:
  concurrency: 5
  model: "gpt-4"

nodes:
  load-bugs:
    type: load
    source:
      type: csv
      path: "bugs.csv"

  filter-critical:
    type: filter
    from: [load-bugs]
    rule:
      type: field
      field: severity
      op: in
      values: [critical, high]

  filter-standard:
    type: filter
    from: [load-bugs]
    rule:
      type: not
      rule:
        type: field
        field: severity
        op: in
        values: [critical, high]

  analyze-critical:
    type: map
    from: [filter-critical]
    prompt: |
      Deep-analyze this critical bug:
      Title: {{title}}
      Description: {{description}}

      Return JSON with root_cause, impact, and fix_urgency.
    output: [root_cause, impact, fix_urgency]
    timeoutMs: 600000

  analyze-standard:
    type: map
    from: [filter-standard]
    prompt: |
      Briefly classify this bug:
      Title: {{title}}

      Return JSON with category and effort_hours.
    output: [category, effort_hours]
    timeoutMs: 300000

  merge-results:
    type: merge
    from: [analyze-critical, analyze-standard]
    strategy: concat

  report:
    type: reduce
    from: [merge-results]
    strategy: ai
    prompt: |
      Combine results from critical ({{SUCCESS_COUNT}} items) and standard analysis:
      {{RESULTS}}

      Generate a unified sprint planning report with priorities.
    output: [sprint_plan, risk_items, effort_estimate]
```

**Key Characteristics:**
- Single load fans out to two filter branches
- Different analysis depth per branch (more time for critical bugs)
- Merge reunites branches before final reduce
- `filter` uses composable boolean algebra (`not` wrapping `field`)

**When to Use:**
- Different processing logic for different data subsets
- Cost optimization (cheap analysis for low-priority items)
- Need to reunite results for a single summary

---

## Pattern 8: ETL with Script Nodes

**Use Case:** Data transformation pipeline that mixes external scripts with AI processing.

```yaml
# Format: DAG Workflow (native nodes format)
name: "Data ETL Pipeline"

settings:
  concurrency: 3

nodes:
  load-raw:
    type: load
    source:
      type: csv
      path: "raw-data.csv"

  normalize:
    type: script
    from: [load-raw]
    run: "python3 normalize.py"
    input: json
    output: json
    timeoutMs: 120000

  clean:
    type: transform
    from: [normalize]
    ops:
      - op: drop
        fields: [internal_id, raw_timestamp]
      - op: rename
        from: normalized_name
        to: name
      - op: add
        field: pipeline_run
        value: "etl-2024"

  enrich:
    type: map
    from: [clean]
    prompt: |
      Enrich this record with additional context:
      Name: {{name}}
      Category: {{category}}

      Return JSON with enriched_description and quality_score.
    output: [enriched_description, quality_score]

  export:
    type: script
    from: [enrich]
    run: "python3 export_to_db.py"
    input: json
    output: passthrough
    onError: warn
```

**Key Characteristics:**
- Script nodes for data normalization and export
- Transform node for field manipulation (no AI cost)
- `onError: warn` on export — workflow completes even if DB write fails
- Linear chain but uses node types not available in linear pipelines

**When to Use:**
- Need external script integration (Python, shell, etc.)
- Data cleaning/transformation before AI processing
- Export to external systems as final step

---

## Pattern 9: Multi-Source Merge and Compare

**Use Case:** Load data from multiple sources, merge, and perform comparative analysis.

```yaml
# Format: DAG Workflow (native nodes format)
name: "Cross-Source Data Comparison"

settings:
  model: "gpt-4"
  concurrency: 5

nodes:
  load-source-a:
    type: load
    source:
      type: csv
      path: "source-a.csv"

  load-source-b:
    type: load
    source:
      type: json
      path: "source-b.json"

  load-source-c:
    type: load
    source:
      type: ai
      prompt: "Generate 5 benchmark items for comparison with fields: name, score, category"
      schema: [name, score, category]

  merge-all:
    type: merge
    from: [load-source-a, load-source-b, load-source-c]
    strategy: concat

  tag-source:
    type: transform
    from: [merge-all]
    ops:
      - op: add
        field: source_id
        value: "merged"

  compare:
    type: ai
    from: [tag-source]
    prompt: |
      Compare these items from multiple data sources:
      {{ITEMS}}

      Identify overlaps, conflicts, and gaps across sources.
      Return JSON with comparison_matrix, conflicts, and recommendations.
    output: [comparison_matrix, conflicts, recommendations]
    timeoutMs: 600000
```

**Key Characteristics:**
- Three load nodes with different source types (CSV, JSON, AI-generated)
- Merge node combines all sources
- Single `ai` node for holistic comparison (not per-item map)
- Transform adds metadata before analysis

**When to Use:**
- Comparing data from heterogeneous sources
- Need a unified view across datasets
- Benchmarking against AI-generated baseline data

---

## Pattern 10: Git-Driven Parallel Review

**Use Case:** Use `git log` to discover recent commits and review each one in parallel with an AI skill.

### Windows / PowerShell Variant

```yaml
# Format: DAG Workflow (native nodes format)
# Git-Driven Parallel Code Review (Windows / PowerShell)
name: "Git Commit Review"
description: "Find recent commits matching a keyword and review each in parallel"

settings:
  concurrency: 4
  model: "gpt-4o"

nodes:
  get-commits:
    type: script
    shell: powershell
    run: |
      git log --grep="fix" --since="7 days ago" --format="%H|||%s|||%an" |
        ForEach-Object {
          $p = $_ -split '\|\|\|'
          [PSCustomObject]@{ hash=$p[0]; subject=$p[1]; author=$p[2] }
        } | ConvertTo-Json -AsArray
    output: json

  review:
    type: map
    from: [get-commits]
    skill: code-review
    prompt: |
      Review commit {{hash}} by {{author}}:
      Subject: {{subject}}

      Fetch the diff with: git show {{hash}}
      Identify any issues or improvements.
    output: [findings, severity]
```

### Unix Variant

```yaml
# Format: DAG Workflow (native nodes format)
# Unix variant (same workflow, no shell field needed)
nodes:
  get-commits:
    type: script
    run: |
      git log --grep="fix" --since="7 days ago" \
        --format='{"hash":"%H","subject":"%s","author":"%an"}' | \
        jq -s '.'
    output: json
```

**Key Characteristics:**
- `shell: powershell` on Windows enables `ConvertTo-Json -AsArray` for correct JSON array output
- Unix uses `jq -s '.'` to collect newline-delimited JSON objects into an array
- `map` node fans out over each commit for parallel review
- `skill:` key loads a pre-built prompt from `.github/skills/`

**When to Use:**
- Automated commit review in CI/CD or periodic schedules
- Reviewing commits that match a keyword (bugfix, feature, refactor)
- Any workflow where git history drives the processing pipeline

---

## Optimization Tips

1. **Parallelism:** Default to 5 for most cases
2. **Timeouts:** 300s (classification), 600s (analysis), 900s (research)
3. **Filters:** Use rule filters when possible (free, fast)
4. **Model Mix:** Cheaper models for map, best for reduce
5. **Batch Size:** Consider `batchSize: 10-50` for simple classification (reduces AI calls)
6. **Testing:** Always add `limit: 10-100` for initial testing
7. **Format Choice:** Both formats produce identical runtime behavior. Choose linear for simplicity, DAG for complex topologies (fan-out, merge, scripts, multiple data sources).
