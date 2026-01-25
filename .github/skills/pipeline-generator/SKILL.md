---
name: pipeline-generator
description: Generate optimized YAML pipeline configurations from natural language requirements. Ask clarifying questions about task type, data source, and output format before creating pipelines. Use when users want to create, design, or build a pipeline for data processing, classification, research, or analysis tasks.
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

## Generation Process

Follow these steps in order:

### Step 1: Ask Clarifying Questions

**IMPORTANT:** Always start by asking these questions. Do NOT skip to generation.

Use the `ask_user` tool to gather requirements:

1. **Task Type**
   - "What is the main goal of this pipeline?"
   - Options: Classification, Research/Analysis, Data Extraction, Document Generation, Custom

2. **Data Source**
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

**Schema Validation:**
- ✓ Exactly ONE input source (items/from/generate)
- ✓ Map has exactly ONE of prompt/promptFile
- ✓ Output is array of valid identifiers
- ✓ If reduce type='ai', has prompt/promptFile

**Anti-Pattern Detection:**
- ⚠️ Timeout < 60000ms → Warn: too aggressive
- ⚠️ Parallel > 10 → Warn: may hit rate limits
- ⚠️ Large CSV without limit → Suggest: add `limit: 100` for testing
- ⚠️ batchSize > 1 without {{ITEMS}} → Error: must include {{ITEMS}} in prompt

### Step 8: Generate Complete YAML

Produce the final pipeline YAML with:
1. Descriptive name (from user's goal)
2. All required sections (input, map, reduce)
3. Optional filter (if applicable)
4. Inline comments explaining design decisions
5. Usage instructions

## Output Format

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

## Schema Reference

See [schema reference](references/schema.md) for:
- Complete field specifications
- Validation rules
- Error messages
- Anti-patterns to avoid
