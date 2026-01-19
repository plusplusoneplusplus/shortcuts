# Multi-Agent Research System

A production-ready pipeline implementing Anthropic's multi-agent research architecture for parallel information gathering and synthesis.

## Overview

This pipeline implements the **orchestrator-worker pattern** described in [Anthropic's Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system):

```
Research Topic → AI Decomposes → Parallel Subagents → Lead Agent Synthesizes
```

**Key Innovation:** Uses **AI-powered query decomposition** to automatically break down research topics into focused sub-queries for parallel exploration - no manual CSV creation needed!

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: AI Decomposition (Input Generation)               │
│                                                             │
│ Input: "Multi-agent AI systems for code analysis"          │
│   ↓                                                         │
│ AI generates 3-8 focused sub-queries:                      │
│   • Architecture patterns (high complexity, 12 searches)   │
│   • Error handling (medium complexity, 8 searches)         │
│   • Testing strategies (medium complexity, 8 searches)     │
│                                                             │
│ User reviews & approves ✓                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Parallel Subagent Exploration (Map)               │
│                                                             │
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│ │ Subagent 1  │  │ Subagent 2  │  │ Subagent 3  │        │
│ │ Architecture│  │ Error       │  │ Testing     │        │
│ │ 12 searches │  │ 8 searches  │  │ 8 searches  │        │
│ └─────────────┘  └─────────────┘  └─────────────┘        │
│       ↓                 ↓                 ↓                │
│  findings[]        findings[]        findings[]           │
│  sources[]         sources[]         sources[]            │
│  confidence        confidence        confidence           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Lead Agent Synthesis (Reduce)                     │
│                                                             │
│ • Deduplicates findings across subagents                   │
│ • Resolves conflicting information                         │
│ • Rates source quality (academic vs blog vs forum)         │
│ • Identifies research gaps                                 │
│ • Generates executive summary with confidence              │
│                                                             │
│ Output: Comprehensive research report                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Principles

Based on Anthropic's learnings, this pipeline embodies:

### 1. **Scale Effort to Complexity**
```yaml
tool_budget: 8   # Medium queries: 6-10 searches
tool_budget: 15  # Complex queries: 10-15 searches
```

### 2. **Start Wide, Then Narrow**
Prompt explicitly instructs: "Start with broad exploration... progressively narrow focus"

### 3. **Source Quality Heuristics**
- Prefer primary sources over secondary
- Flag SEO-optimized content vs authoritative documentation
- Track source type: academic, documentation, blog, forum

### 4. **Parallel Execution for Breadth**
```yaml
parallel: 5  # 3-10 subagents based on query complexity
```

### 5. **Separation of Concerns**
Each subagent gets:
- Distinct focus area (no overlap)
- Clear task boundaries
- Independent exploration trajectory

### 6. **AI-Powered Synthesis**
The lead agent uses **extended thinking** to:
- Resolve conflicts between subagent findings
- Identify patterns and themes
- Deduplicate redundant discoveries
- Assess overall confidence

### 7. **Token Budget Management**
```yaml
timeoutMs: 600000  # 10 min per agent
model: "claude-sonnet-4"  # Cost-effective for subagents
reduce.model: "claude-opus-4"  # Best reasoning for synthesis
```

## Quick Start

### Step 1: Set Your Research Topic

Edit `pipeline.yaml` and change the `research_topic` parameter:

```yaml
input:
  parameters:
    - name: research_topic
      value: "Modern approaches to LLM agent orchestration"
    - name: project_context
      value: "Building a multi-agent code review system"
```

### Step 2: Preview AI Decomposition

1. Right-click the pipeline in the Pipelines view
2. Select **"Preview Pipeline"**
3. The AI will generate 3-8 focused sub-queries with:
   - Focus areas (independent aspects to research)
   - Complexity levels (simple/medium/high)
   - Tool budgets (search count per area)
   - Rationale (why each focus matters)
4. Review and edit the decomposition if needed
5. Approve to execute

**Example AI Decomposition:**
```json
[
  {
    "focus_area": "Orchestrator-worker patterns",
    "complexity": "high",
    "tool_budget": 12,
    "rationale": "Core architectural pattern for coordination"
  },
  {
    "focus_area": "Inter-agent communication protocols",
    "complexity": "medium",
    "tool_budget": 8,
    "rationale": "Essential for agent collaboration"
  },
  {
    "focus_area": "Error propagation and recovery",
    "complexity": "high",
    "tool_budget": 10,
    "rationale": "Critical for production reliability"
  }
]
```

### Step 3: Review Results

The pipeline produces:
- **Executive summary**: High-level answer with confidence assessment
- **Key findings**: Top 5-10 discoveries with source citations
- **All sources**: Deduplicated source list with quality ratings
- **Research gaps**: What still needs exploration
- **Recommended actions**: Specific next steps for follow-up

## How It Works

### Why AI Decomposition?

This approach mirrors how Anthropic's lead agent works:

1. **Lead Agent Plans**: AI analyzes the research topic and decides how to break it down
2. **Dynamic Strategy**: Different topics get different decomposition strategies
3. **User Control**: Review and edit before execution (transparency)
4. **No Manual CSV**: Just set one topic parameter

### Decomposition Guidelines (Built Into Prompt)

The AI follows these principles when decomposing queries:

1. **Independence**: Each focus area can be researched separately
2. **Coverage**: Together, focus areas comprehensively cover the topic
3. **Specificity**: Each area is concrete enough to guide research
4. **Complexity Assessment**: Simple/medium/high based on topic difficulty
5. **Balanced Effort**: Not all sub-queries need maximum resources

### Multi-Model Fanout

Test the same query across different models:

```yaml
input:
  from:
    - query: "What are best practices for agent error handling?"
      focus_area: "Recovery strategies"
      complexity: "high"
      tool_budget: 10
      model: "gpt-4"
    - query: "What are best practices for agent error handling?"
      focus_area: "Recovery strategies"
      complexity: "high"
      tool_budget: 10
      model: "claude-opus-4"

map:
  model: "{{model}}"  # Dynamic model per item
```

## Configuration

### Adjust Parallelism

```yaml
map:
  parallel: 3   # Conservative (fewer API calls)
  parallel: 10  # Aggressive (faster, more tokens)
```

### Timeout Control

```yaml
map:
  timeoutMs: 300000   # 5 minutes (simple queries)
  timeoutMs: 900000   # 15 minutes (complex research)
```

### Model Selection

| Use Case | Subagents (Map) | Lead Agent (Reduce) |
|----------|----------------|---------------------|
| **Cost-optimized** | `claude-sonnet-4` | `claude-sonnet-4` |
| **Balanced** | `claude-sonnet-4` | `claude-opus-4` |
| **Maximum quality** | `claude-opus-4` | `claude-opus-4` |

## Example Use Cases

### 1. Technology Evaluation

```yaml
research_topic: "Vector database options for semantic code search"
project_context: "Building a VSCode extension for semantic code navigation"
```

**AI might decompose into:**
- Performance benchmarks and scalability
- Integration patterns with TypeScript
- Cost and resource requirements
- Community and ecosystem maturity

**Output:**
- Executive summary of vector DB landscape
- Performance comparisons with citations
- Cost-benefit analysis for embedding storage
- Recommended databases for VSCode extensions

### 2. Best Practices Research

```yaml
research_topic: "State-of-the-art in LLM-powered code review automation"
project_context: "Designing production code review system"
```

**AI might decompose into:**
- Static analysis integration patterns
- LLM prompt engineering for code review
- False positive reduction techniques
- Performance and cost optimization
- Production deployment case studies

**Output:**
- Current best practices summary
- 8 key techniques with 15 unique sources
- Confidence: high on techniques, medium on cost optimization
- Gap: "Limited data on false positive rates in production"
- Next step: Follow-up research on production metrics

### 3. Competitive Analysis

```yaml
research_topic: "Comparison of multi-agent frameworks: CrewAI vs AutoGen vs LangGraph"
project_context: "Selecting a framework for production deployment"
```

**AI might decompose into:**
- Architecture and design philosophy differences
- Developer experience and ease of use
- Performance and scalability characteristics
- Community support and ecosystem maturity
- Production readiness and stability

**Output:**
- Feature comparison matrix across frameworks
- Strengths/weaknesses for each framework
- Source quality ratings (documentation, case studies, papers)
- Recommendation: Which framework for which scenario

### 4. Problem Space Exploration

```yaml
research_topic: "Unsolved challenges in AI code generation for production systems"
project_context: "Research project on AI-assisted software engineering"
```

**AI might decompose into:**
- Correctness and verification challenges
- Context window limitations and workarounds
- Testing and quality assurance approaches
- Security and sandboxing concerns
- Developer workflow integration issues

**Output:**
- Known limitations in current systems
- Research frontiers (academic + industry)
- Academic vs industry perspectives comparison
- Actionable research directions with priority rankings

## Comparison with Other Approaches

### vs Single-Agent RAG
- **RAG**: Static retrieval → Single response
- **Multi-Agent**: Dynamic exploration → Parallel investigation → Synthesis

### vs Sequential Agent Chains
- **Sequential**: Agent 1 → Agent 2 → Agent 3 (linear)
- **Multi-Agent**: Agents 1-5 run in parallel → Lead synthesizes

### vs Human Research
- **Human**: Serial browsing, limited context windows
- **Multi-Agent**: Parallel exploration, separate context per agent, AI synthesis

## Evaluation Metrics

The pipeline tracks:

1. **Coverage**: How many focus areas were successfully explored?
2. **Source Quality**: Ratio of high-quality to low-quality sources
3. **Confidence**: Lead agent's confidence in findings
4. **Efficiency**: Findings per tool call
5. **Redundancy**: Duplicate findings across agents (should be low)

## Limitations

1. **Token Cost**: 15× more tokens than single chat (Anthropic's data)
2. **Coordination**: Not ideal for tasks requiring shared context
3. **Dependencies**: Works best for parallelizable research
4. **API Limits**: May hit rate limits with high parallelism

## Best Practices

### DO:
✅ Decompose queries into truly independent focus areas
✅ Set realistic tool budgets based on complexity
✅ Use high-quality models for synthesis (reduce phase)
✅ Start with 3-5 subagents, scale up for complex queries
✅ Review source quality in results

### DON'T:
❌ Use for tasks requiring agent-to-agent coordination
❌ Run without setting parallel limits (API overload)
❌ Expect deterministic results (agents are adaptive)
❌ Use for simple lookup tasks (overkill)

## Extending the Pipeline

### Add Custom Research Guidelines

```yaml
parameters:
  - name: domain_guidelines
    value: "For legal research: cite primary sources (statutes, cases). For tech: prefer official documentation."
```

### Add Citation Verification

Create a follow-up pipeline that:
1. Takes `all_sources` from research output
2. Validates each URL is accessible
3. Extracts quotes to verify claims

### Add Iterative Research

Chain pipelines:
1. **Pipeline 1**: Initial broad research
2. **Pipeline 2**: Deep-dive into `research_gaps` from Pipeline 1
3. **Pipeline 3**: Final synthesis

## References

- [Anthropic's Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Claude Research Capabilities](https://www.anthropic.com/news/research)
- [BrowseComp Evaluation](https://openai.com/index/browsecomp/)

## License

Part of Workspace Shortcuts VSCode extension.

## Configuration Options

### Adjust Number of Subagents

The AI decides based on topic complexity, but you can influence it:

```yaml
generate:
  prompt: |
    ... decompose into 5-7 focused sub-queries ...
    # Change from default 3-8 to narrow the range
```

### Control Parallelism

```yaml
map:
  parallel: 3   # Conservative (3 at a time)
  parallel: 10  # Aggressive (10 at a time)
```

**Recommendation:**
- Start with 5 for balanced speed/cost
- Use 3 for rate-limited APIs
- Use 10 for fast exploration

### Adjust Timeouts

```yaml
map:
  timeoutMs: 300000   # 5 minutes (quick research)
  timeoutMs: 600000   # 10 minutes (standard)
  timeoutMs: 900000   # 15 minutes (deep research)
```

### Model Selection

```yaml
input:
  generate:
    model: "claude-opus-4"    # Best decomposition

map:
  model: "claude-sonnet-4"    # Cost-effective subagents

reduce:
  model: "claude-opus-4"      # Best synthesis
```

**Cost vs Quality:**

| Configuration | Cost | Quality | Use Case |
|---------------|------|---------|----------|
| All Sonnet | Low | Good | Exploration, frequent use |
| Mixed (shown above) | Medium | Excellent | **Recommended** |
| All Opus | High | Best | Critical research |

## Advanced Usage

### Override AI Decomposition

If you want manual control, skip AI generation and provide direct CSV input:

```yaml
input:
  # Replace generate: with from:
  from:
    type: csv
    path: "manual-decomposition.csv"
```

**manual-decomposition.csv:**
```csv
focus_area,complexity,tool_budget,rationale
"Specific area 1","medium",8,"Why this matters"
"Specific area 2","high",12,"Why this matters"
```

### Multi-Model Fanout

Test the same query across different models:

```yaml
input:
  from:
    - focus_area: "Recovery strategies"
      complexity: "high"
      tool_budget: 10
      model: "gpt-4"
    - focus_area: "Recovery strategies"
      complexity: "high"
      tool_budget: 10
      model: "claude-opus-4"

map:
  model: "{{model}}"  # Dynamic model per item
```

### Iterative Research Pattern

**Pattern 1: Initial → Deep-Dive**

1. Run initial research with broad topic
2. Review `research_gaps` in output
3. Create second pipeline focusing on gaps

```yaml
# pipeline-deep-dive.yaml
input:
  parameters:
    - name: research_topic
      value: "Deep-dive into {{gap_from_initial}}"
```

**Pattern 2: Multi-Level Hierarchy**

```
Level 1: Broad overview (5 subagents)
   ↓ Export promising areas
Level 2: Deep analysis (3 subagents per area)
   ↓ Export specific findings
Level 3: Verification (1 subagent per claim)
```

Implement as 3 separate pipelines.

## Best Practices

### DO:
✅ **Be specific in research_topic**: "Best practices for X in 2025" not "X info"
✅ **Provide project_context**: Helps AI tailor decomposition
✅ **Review AI decomposition**: Edit if focus areas overlap
✅ **Start with 5 subagents**: Scale up after seeing results
✅ **Check source quality**: Prioritize high-quality sources in results

### DON'T:
❌ **Make topic too broad**: "AI" → "Multi-agent AI for code review"
❌ **Skip preview step**: Always review AI decomposition first
❌ **Ignore research_gaps**: They guide next iteration
❌ **Over-parallelize initially**: Start with 5, not 20
❌ **Use for simple lookups**: This is for complex research tasks

## Troubleshooting

### Issue: AI generates too many/few sub-queries

**Solution:** Adjust the prompt:
```yaml
generate:
  prompt: |
    ... decompose into exactly 5 sub-queries ...
```

### Issue: Focus areas overlap

**Solution:** In preview, edit the generated decomposition to ensure independence

### Issue: Subagents exceed tool budget

**Solution:** Increase `tool_budget` in decomposition or adjust prompt guidance

### Issue: Too expensive

**Solution:**
- Reduce `map.parallel` (fewer concurrent agents)
- Use Sonnet instead of Opus for map phase
- Reduce decomposition to 3-4 focus areas

### Issue: Results lack depth

**Solution:**
- Increase `tool_budget` per focus area
- Use "high" complexity for more areas
- Increase `timeoutMs` to allow more thinking time

## Technical Architecture

### Mapping Anthropic's Design to Pipeline Framework

| Anthropic Component | Pipeline Component | Implementation |
|---------------------|-------------------|----------------|
| Lead Agent Planning | AI Input Generation | `input.generate` with decomposition prompt |
| Subagents (Workers) | Map Phase | Parallel execution with specialized prompts |
| Query Decomposition | Generated CSV | AI produces focus_area, complexity, budget |
| Parallel Execution | `map.parallel` | Concurrent subagent execution (3-10 agents) |
| Result Synthesis | AI Reduce | `reduce.type: ai` with synthesis prompt |
| Token Budget | `map.timeoutMs` | Per-agent timeout prevents runaway costs |

### Anthropic's Key Learnings Applied

Based on their [engineering blog post](https://www.anthropic.com/engineering/multi-agent-research-system):

1. ✅ **Scale effort to complexity**: Tool budgets vary by complexity level
2. ✅ **Start wide, then narrow**: Prompts explicitly instruct this approach
3. ✅ **Source quality heuristics**: Track academic vs blog vs forum sources
4. ✅ **Parallel execution**: Built-in with `map.parallel`
5. ✅ **Separation of concerns**: Independent focus areas with clear boundaries
6. ✅ **AI-powered synthesis**: Lead agent deduplicates and resolves conflicts
7. ✅ **Let agents improve themselves**: Can iterate on decomposition

### Performance Expectations

From Anthropic's data:
- **90.2% improvement** over single-agent Opus 4 (on their eval)
- **15× token usage** vs single chat interaction
- **4× token usage** vs single agent
- **80% of performance** explained by token budget
- **90% time reduction** with parallelization (vs sequential)

## Extensions

### Add Custom Research Guidelines

```yaml
parameters:
  - name: domain_guidelines
    value: "For legal research: cite primary sources (statutes, cases). For tech: prefer official documentation."
```

### Citation Verification Pipeline

Create a follow-up pipeline:
1. Takes `all_sources` from research output
2. Validates each URL is accessible
3. Extracts quotes to verify claims

```yaml
name: "Citation Verification"
input:
  from:
    type: csv
    path: "sources-to-verify.csv"  # Generated from research output

map:
  prompt: |
    Verify this source:
    URL: {{url}}
    Claimed fact: {{claimed_fact}}
    
    Check if URL is accessible and contains the claimed information.
  
  output:
    - is_accessible
    - contains_claim
    - excerpt
```

## Comparison with Other Approaches

### vs Single-Agent RAG
- **RAG**: Static retrieval → Single response
- **Multi-Agent**: Dynamic exploration → Parallel investigation → Synthesis
- **Winner**: Multi-agent for complex, exploratory research

### vs Sequential Agent Chains
- **Sequential**: Agent 1 → Agent 2 → Agent 3 (linear, slow)
- **Multi-Agent**: Agents 1-5 run in parallel → Lead synthesizes
- **Winner**: Multi-agent for speed (90% faster) and breadth

### vs Human Research
- **Human**: Serial browsing, limited context windows, cognitive load
- **Multi-Agent**: Parallel exploration, separate context per agent, AI synthesis
- **Winner**: Multi-agent for breadth and speed; human for nuanced judgment

## Limitations

1. **Token Cost**: 15× more tokens than single chat (Anthropic's data)
   - **Mitigation**: Use for high-value research only
   
2. **No Real-Time Tool Use**: Simulated research vs actual search APIs
   - **Mitigation**: Prompts describe tool usage; works for most cases
   
3. **Fixed Decomposition**: AI decides upfront, not adaptive mid-execution
   - **Mitigation**: Use iterative research pattern for follow-ups
   
4. **No Inter-Agent Communication**: Pure map-reduce (agents don't talk)
   - **Mitigation**: Design independent focus areas
   
5. **API Rate Limits**: High parallelism may hit rate limits
   - **Mitigation**: Start with `parallel: 5`, adjust as needed

## Evaluation Metrics

The pipeline tracks:

1. **Coverage**: How many focus areas were successfully explored?
2. **Source Quality**: Ratio of high-quality to low-quality sources
3. **Confidence**: Lead agent's confidence in findings (high/medium/low)
4. **Efficiency**: Findings per tool call (higher is better)
5. **Redundancy**: Duplicate findings across agents (lower is better)

## References

- [Anthropic's Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) - Original architecture blog post
- [Claude Research Capabilities](https://www.anthropic.com/news/research) - Product announcement
- [BrowseComp Evaluation](https://openai.com/index/browsecomp/) - Multi-agent evaluation benchmark

## License

Part of Workspace Shortcuts VSCode extension.

---

**Happy Researching! 🔬**

For questions or issues, see the main extension documentation.
