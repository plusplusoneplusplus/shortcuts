# Phase 3: AI Layer

## Overview

Use AI to name clusters, generate human-readable explanations, suggest boundary adjustments, and create documentation that reflects how engineers think about the system.

---

## Goals

1. Name clusters at the right abstraction level (concepts, not files)
2. Generate explanations suitable for developer onboarding
3. Suggest cluster splits/merges when boundaries are unclear
4. Create architecture diagrams with source links
5. Ensure every topic is grounded in structural evidence

---

## Topic Naming

### Naming Principles

| Principle | Good Example | Bad Example |
|-----------|--------------|-------------|
| Concept over implementation | "Session Management" | "session-pool.ts" |
| Engineer terminology | "Tree View Infrastructure" | "BaseTreeDataProvider classes" |
| Role in system | "AI-Powered Code Review" | "code-review module" |
| Appropriate abstraction | "Application Bootstrap" | "extension.ts activation" |

### Naming Categories

| Category | Description | Examples |
|----------|-------------|----------|
| Core Infrastructure | Foundation components used by many features | Tree Views, Configuration, Theming |
| Feature Module | User-facing functionality | Markdown Review, Code Review |
| UI Components | Visual/interactive elements | Webviews, Panels, Editors |
| Data Layer | Persistence, state management | Comments Storage, Settings |
| External Integration | Third-party service connections | AI Service, Git Integration |
| Build & Tooling | Build, test, deployment | Webpack Config, CI |
| Testing Infrastructure | Test utilities, fixtures | Test Helpers, Mocks |

### Naming Input

For each cluster, provide to AI:
- Root path and file list
- Top exports and imports
- Fan-in and fan-out scores
- Related tests and documentation
- Human descriptions from docs/comments
- Role in dependency graph (leaf, hub, bridge)

### Naming Output

| Field | Description |
|-------|-------------|
| `name` | Primary topic name (3-6 words) |
| `shortName` | Brief name for navigation (1-3 words) |
| `category` | One of the defined categories |
| `confidence` | AI confidence in naming (0-1) |
| `reasoning` | Why this name fits |
| `alternativeNames` | Other valid names |

### Naming Validation

| Check | Action if Failed |
|-------|------------------|
| Name too generic ("Utilities") | Request more specific name |
| Name is file/folder name | Request conceptual name |
| Name doesn't match category | Request alignment |
| Low confidence (< 0.6) | Flag for human review |

---

## Topic Explanation

### Explanation Structure

Each topic explanation includes:

| Section | Content |
|---------|---------|
| Summary | 2-3 sentence overview |
| Purpose | What problem it solves, why it exists |
| Architecture | How it's structured, key patterns |
| Key Components | Important classes/functions with file links |
| Data Flow | How data moves through the component |
| Dependencies | What this topic relies on |
| Dependents | What relies on this topic |
| Usage Examples | Code snippets with explanations |

### Explanation Input

For each named topic, provide to AI:
- Topic name and category
- Full file list with brief summaries
- Key code patterns (class definitions, exports)
- Dependency information (in and out)
- Related tests and their descriptions
- Existing documentation content
- Git change frequency and recency

### Explanation Guidelines

| Guideline | Description |
|-----------|-------------|
| Audience | Mid-level developer joining the team |
| Tone | Technical but approachable |
| Length | 500-1500 words per topic |
| Code examples | 2-4 key snippets with explanations |
| Links | File:line format for source references |

### Diagram Generation

For each topic, optionally generate:
- Component diagram (Mermaid)
- Data flow diagram
- Dependency graph (subset)

Diagram criteria:
- Include if > 5 files in cluster
- Include if complex internal structure
- Skip for simple utility clusters

---

## Boundary Adjustment

### When to Adjust

| Signal | Potential Adjustment |
|--------|---------------------|
| Cluster has low cohesion (< 0.5) | Consider splitting |
| Two clusters with high mutual deps | Consider merging |
| Files with very different fan-in/out | Consider separating |
| Test coverage varies significantly | Consider splitting by coverage |
| Co-change groups don't match cluster | Consider regrouping |

### Adjustment Input

For boundary suggestions, provide to AI:
- All clusters with their metrics
- Cross-cluster dependencies
- Co-change groups that span clusters
- Existing documentation boundaries

### Adjustment Output

| Field | Description |
|-------|-------------|
| `type` | `split`, `merge`, or `none` |
| `clusters` | Affected cluster IDs |
| `reason` | Why adjustment is suggested |
| `confidence` | Confidence in suggestion (0-1) |
| `newBoundaries` | Proposed new cluster definitions |

### Adjustment Validation

- Must have structural evidence (deps, co-change)
- Cannot create single-file clusters
- Cannot merge unrelated areas
- Human review required for significant changes

---

## AI Prompt Design

### Prompt Principles

| Principle | Implementation |
|-----------|----------------|
| Structured output | Request JSON response |
| Few-shot examples | Include 2-3 good/bad examples |
| Grounded | Reference specific files and metrics |
| Constrained | Limit categories, length, format |

### Naming Prompt Structure

1. Context: What is a DeepWiki topic
2. Cluster information: Files, metrics, role
3. Good/bad examples: 3 each
4. Output format: JSON schema
5. Constraints: Categories, length, avoid generic

### Explanation Prompt Structure

1. Context: Writing developer documentation
2. Topic information: Name, files, dependencies
3. Audience: New team member
4. Sections required: List with guidance
5. Output format: Markdown with specific sections
6. Constraints: Length, link format, no speculation

### Batch Processing

For efficiency:
- Batch similar-sized clusters together
- Process naming in parallel (5-10 concurrent)
- Process explanations sequentially (more context)
- Cache AI responses for re-runs

---

## Required Changes

### New Modules

| Module | Purpose |
|--------|---------|
| `ai-layer/index.ts` | Main AI orchestration |
| `ai-layer/topic-namer.ts` | Cluster naming logic |
| `ai-layer/topic-explainer.ts` | Explanation generation |
| `ai-layer/boundary-adjuster.ts` | Split/merge suggestions |
| `ai-layer/diagram-generator.ts` | Mermaid diagram creation |
| `ai-layer/prompt-templates.ts` | Prompt construction |
| `ai-layer/response-validator.ts` | Validate AI outputs |

### Integration with AI Service

Use existing `ai-service` module:
- `CopilotSDKService` for AI calls
- Session pooling for efficiency
- Timeout and retry handling

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `aiModel` | Model to use for generation | `gpt-4` |
| `maxTokens` | Max response tokens | `2000` |
| `temperature` | Creativity level | `0.3` |
| `parallelism` | Concurrent AI calls | `5` |
| `retryCount` | Retries on failure | `2` |
| `humanReviewThreshold` | Confidence below which to flag | `0.6` |

---

## Testing Strategy

### Unit Tests

| Test | Description |
|------|-------------|
| Prompt construction | Templates produce valid prompts |
| Response parsing | JSON responses parsed correctly |
| Validation logic | Invalid responses rejected |
| Category assignment | Categories match patterns |

### Integration Tests

| Test | Description |
|------|-------------|
| Name single cluster | Generate name for one cluster |
| Name all clusters | Process this extension's clusters |
| Generate explanation | Create explanation for one topic |
| Boundary suggestions | Get adjustment recommendations |
| Diagram generation | Create Mermaid diagram |

### Quality Tests

| Test | Description |
|------|-------------|
| Name uniqueness | No duplicate topic names |
| Name relevance | Names match cluster content |
| Explanation completeness | All sections present |
| Link validity | Source links point to real files |
| Diagram correctness | Mermaid syntax valid |

### Validation Tests

| Test | Description |
|------|-------------|
| Grounding check | Every claim has source file evidence |
| No hallucination | No invented files or relationships |
| Category consistency | Categories used consistently |
| Confidence calibration | Low confidence = actually uncertain |

### Mock AI Responses

For deterministic testing:
- Create mock responses for known clusters
- Test error handling with malformed responses
- Test retry logic with transient failures

---

## Output Format

### Named Topic JSON

```json
{
  "topics": [
    {
      "id": "topic_ai_integration",
      "clusterId": "cluster_001",
      "naming": {
        "name": "AI Service Integration",
        "shortName": "AI Service",
        "category": "External Integration",
        "confidence": 0.92,
        "reasoning": "This cluster wraps GitHub Copilot SDK and manages AI sessions",
        "alternativeNames": ["Copilot Integration", "AI Session Management"]
      },
      "explanation": {
        "summary": "Provides AI capabilities through GitHub Copilot SDK integration...",
        "purpose": "Enable AI-powered features like code review and discovery...",
        "architecture": "Three-layer architecture: SDK wrapper, session pool, process tracking...",
        "keyComponents": [
          {
            "name": "CopilotSDKService",
            "file": "src/shortcuts/ai-service/copilot-sdk-service.ts",
            "line": 45,
            "description": "Main wrapper around @github/copilot-sdk"
          }
        ],
        "dependencies": ["shared/", "configuration-manager.ts"],
        "dependents": ["code-review/", "discovery/"],
        "codeExamples": [
          {
            "title": "Sending a message to AI",
            "file": "src/shortcuts/ai-service/copilot-sdk-service.ts",
            "lines": "120-135",
            "explanation": "Shows how to send a prompt and handle the response"
          }
        ]
      },
      "diagram": "graph TD\n  A[Extension] --> B[AIProcessManager]\n  B --> C[SessionPool]\n  C --> D[CopilotSDK]",
      "boundaryAdjustment": {
        "type": "none",
        "reason": "High cohesion, clear boundaries"
      }
    }
  ]
}
```

---

## Error Handling

| Error | Handling |
|-------|----------|
| AI timeout | Retry with exponential backoff |
| Invalid JSON response | Request regeneration |
| Low confidence | Flag for human review |
| Generic name | Request more specific alternative |
| Missing sections | Request completion |

---

## Performance Considerations

| Operation | Optimization |
|-----------|-------------|
| Naming | Batch similar clusters |
| Explanation | Sequential to avoid conflicts |
| Diagrams | Generate only when needed |
| Caching | Cache responses by cluster hash |

### Performance Targets

| Operation | Target |
|-----------|--------|
| Name one cluster | < 5 seconds |
| Name all clusters (20) | < 30 seconds (parallel) |
| Generate explanation | < 15 seconds |
| Generate diagram | < 5 seconds |

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Naming quality | > 90% of names approved by human review |
| Explanation completeness | All required sections present |
| No hallucination | 0 invented files or relationships |
| Grounding | Every topic linked to source files |
| Performance | Full AI processing < 3 minutes |
