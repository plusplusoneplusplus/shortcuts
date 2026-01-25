# Pipeline Patterns Reference

This document provides detailed examples of proven pipeline patterns.

## Pattern 1: Map-Reduce Classification

**Use Case:** Batch processing with structured output and AI synthesis

### Example: Bug Triage Pipeline

```yaml
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

## Pattern Selection Guide

| User Need | Pattern |
|-----------|---------|
| "Classify/categorize items" | Map-Reduce Classification |
| "Research/investigate topic" | AI Decomposition |
| "Generate docs/checklists" | Template-Based |
| "Compare AI models" | Multi-Model Fanout |
| "Process large dataset efficiently" | Hybrid Filtering + Classification |
| "Batch analysis with custom rules" | Map-Reduce + Rule Filter |

---

## Optimization Tips

1. **Parallelism:** Default to 5 for most cases
2. **Timeouts:** 300s (classification), 600s (analysis), 900s (research)
3. **Filters:** Use rule filters when possible (free, fast)
4. **Model Mix:** Cheaper models for map, best for reduce
5. **Batch Size:** Consider `batchSize: 10-50` for simple classification (reduces AI calls)
6. **Testing:** Always add `limit: 10-100` for initial testing
