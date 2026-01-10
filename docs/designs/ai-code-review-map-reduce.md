# AI Code Review: Map-Reduce Architecture

## Overview

This document describes a map-reduce architecture for AI-powered code review where:
- **Map Phase**: Each coding rule reviews the full diff independently and in parallel
- **Reduce Phase**: A single AI call synthesizes all findings into a coherent report

This approach provides better scalability, prompt specialization, and cleaner output than monolithic review.

## Motivation

### Problems with Single-Pass Review

Traditional AI code review sends the entire diff with all rules to one LLM call:

```
[All Rules] + [Full Diff] → LLM → [Review Report]
```

Issues:
1. **Prompt bloat**: Many rules = long prompt = degraded performance
2. **No specialization**: Generic prompt tries to do everything
3. **Hard to iterate**: Changing one rule requires re-testing everything
4. **No parallelism**: Single blocking call, latency = f(diff size × rule count)

### Map-Reduce Solution

```
                              ┌─────────────┐
                              │  Full Diff  │
                              └──────┬──────┘
                                     │
           ┌───────────┬─────────────┼─────────────┬───────────┐
           ▼           ▼             ▼             ▼           ▼
      ┌─────────┐ ┌─────────┐  ┌─────────┐  ┌─────────┐ ┌─────────┐
 MAP  │ Rule 1  │ │ Rule 2  │  │ Rule 3  │  │ Rule 4  │ │ Rule N  │
      │         │ │         │  │         │  │         │ │         │
      └────┬────┘ └────┬────┘  └────┬────┘  └────┬────┘ └────┬────┘
           │           │             │             │           │
           └───────────┴─────────────┼─────────────┴───────────┘
                                     ▼
                         ┌───────────────────────┐
                  REDUCE │   AI Synthesis Agent  │
                         │  - Deduplicate        │
                         │  - Resolve conflicts  │
                         │  - Prioritize         │
                         │  - Generate report    │
                         └───────────────────────┘
                                     │
                                     ▼
                            ┌───────────────┐
                            │ Final Report  │
                            └───────────────┘
```

Benefits:
1. **Parallel execution**: All rule checks run simultaneously
2. **Specialized prompts**: Each rule has optimized prompt and examples
3. **Independent iteration**: Tune one rule without affecting others
4. **Cost optimization**: Use cheaper models for map, best model for reduce
5. **Clean output**: AI reduce eliminates duplicates and conflicts

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                          RuleRegistry                               │
│  - Loads rules from .github/cr-rules/*.md                          │
│  - Parses rule metadata (severity, category, applies-to)           │
│  - Provides rule selection based on diff content                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MapReduceReviewer                          │
│  - Orchestrates the review pipeline                                │
│  - Manages parallel rule execution                                 │
│  - Invokes AI reduce                                               │
└─────────────────────────────────────────────────────────────────────┘
                          │                   │
                          ▼                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│          RuleMapper             │ │         AIReducer               │
│  - Executes single rule review  │ │  - Deduplicates findings        │
│  - Formats rule-specific prompt │ │  - Resolves conflicts           │
│  - Parses rule violations       │ │  - Synthesizes final report     │
└─────────────────────────────────┘ └─────────────────────────────────┘
```

### Data Flow

```typescript
// Input
interface ReviewRequest {
  diff: string;
  commitSha?: string;
  baseBranch?: string;
  metadata?: {
    author: string;
    files: string[];
    isHotfix: boolean;
  };
}

// Map Phase Output
interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'major' | 'minor' | 'nitpick';
  file: string;
  line: number;
  endLine?: number;
  snippet: string;
  issue: string;
  suggestion?: string;
}

// Reduce Phase Output
interface ReviewReport {
  summary: string;
  overallSeverity: 'clean' | 'minor-issues' | 'needs-work' | 'critical';
  findings: Finding[];
  stats: {
    totalIssues: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

interface Finding {
  id: string;
  severity: 'critical' | 'major' | 'minor' | 'nitpick';
  category: string;
  file: string;
  line: number;
  issue: string;
  suggestion: string;
  fromRules: string[];  // Which rules contributed to this finding
}
```

## Map Phase

### Rule Definition

Rules are defined as markdown files in `.github/cr-rules/`:

```markdown
<!-- .github/cr-rules/error-handling.md -->
---
id: error-handling
name: Proper Error Handling
severity: major
category: reliability
applies-to: ["*.ts", "*.js"]
model: haiku  # optional: override model for this rule
---

# Error Handling Rule

## Description
All errors must be properly handled. Empty catch blocks, swallowed errors,
and unhandled promise rejections are not allowed.

## What to Look For
- Empty catch blocks: `catch (e) {}`
- Catch with only console.log: `catch (e) { console.log(e); }`
- Missing .catch() on promises
- Async functions without try-catch around await
- Re-throwing without adding context

## Good Examples
```typescript
try {
  await saveUser(user);
} catch (error) {
  logger.error('Failed to save user', { userId: user.id, error });
  throw new UserSaveError('Could not save user', { cause: error });
}
```

## Bad Examples
```typescript
try {
  await saveUser(user);
} catch (e) {
  // TODO: handle this
}
```
```

### Rule Mapper Implementation

```typescript
class RuleMapper {
  constructor(
    private aiService: AIService,
    private config: MapConfig
  ) {}

  async applyRule(rule: Rule, diff: string): Promise<RuleViolation[]> {
    const prompt = this.buildPrompt(rule, diff);

    const response = await this.aiService.invoke({
      model: rule.model || this.config.defaultMapModel,
      prompt,
      temperature: 0.2,  // Low temperature for consistent detection
      maxTokens: this.config.maxTokensPerRule,
    });

    return this.parseViolations(response, rule);
  }

  private buildPrompt(rule: Rule, diff: string): string {
    return `You are a code reviewer checking for ONE specific rule.

## Rule: ${rule.name}
${rule.description}

## What to Look For
${rule.whatToLookFor}

${rule.examples ? `## Examples\n${rule.examples}` : ''}

## Instructions
1. Review the diff below for violations of THIS RULE ONLY
2. For each violation, provide:
   - file: the file path
   - line: the line number in the new version
   - snippet: the problematic code (max 3 lines)
   - issue: what's wrong (one sentence)
   - suggestion: how to fix it (one sentence)
3. If no violations found, return empty array
4. Be precise - only flag clear violations, not style preferences

## Diff to Review
\`\`\`diff
${diff}
\`\`\`

## Output Format
Return a JSON array of violations:
[
  {
    "file": "path/to/file.ts",
    "line": 42,
    "snippet": "code here",
    "issue": "description of problem",
    "suggestion": "how to fix"
  }
]

If no violations, return: []`;
  }

  private parseViolations(response: string, rule: Rule): RuleViolation[] {
    const json = this.extractJSON(response);
    return json.map(v => ({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      ...v
    }));
  }
}
```

### Concurrency Control

To avoid overwhelming the AI service with too many parallel requests, we use a concurrency limiter that caps the number of simultaneous rule executions.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Concurrency Limiter (max=5)                     │
│                                                                     │
│   Active: [Rule1] [Rule2] [Rule3] [Rule4] [Rule5]                  │
│   Queue:  [Rule6] [Rule7] [Rule8] ... [RuleN]                      │
│                                                                     │
│   As each rule completes, next queued rule starts                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### ConcurrencyLimiter Implementation

```typescript
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a slot to be available
    await this.acquire();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return Promise.resolve();
    }

    // Queue the request and wait
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.running--;

    // Start next queued task if any
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  /**
   * Execute multiple tasks with concurrency limit.
   * Similar to Promise.all but respects maxConcurrency.
   */
  async all<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(tasks.map(task => this.run(task)));
  }
}
```

### Parallel Execution with Concurrency Limit

```typescript
class MapReduceReviewer {
  private limiter: ConcurrencyLimiter;

  constructor(
    private ruleRegistry: RuleRegistry,
    private ruleMapper: RuleMapper,
    private aiReducer: AIReducer,
    private config: MapReduceReviewConfig,
    private logger: Logger
  ) {
    this.limiter = new ConcurrencyLimiter(config.map.maxConcurrency);
  }

  async review(request: ReviewRequest): Promise<ReviewReport> {
    // 1. Load and filter applicable rules
    const allRules = await this.ruleRegistry.loadRules();
    const applicableRules = this.filterRules(allRules, request);

    this.logger.info(
      `Starting review with ${applicableRules.length} rules ` +
      `(max ${this.config.map.maxConcurrency} concurrent)`
    );

    // 2. MAP: Execute rules with concurrency limit
    const tasks = applicableRules.map(rule => () =>
      this.ruleMapper.applyRule(rule, request.diff)
        .catch(err => {
          this.logger.warn(`Rule ${rule.id} failed: ${err.message}`);
          return []; // Don't fail entire review if one rule fails
        })
    );

    const mapResults = await this.limiter.all(tasks);

    // 3. Flatten results
    const allViolations = mapResults.flat();

    // 4. REDUCE: Synthesize with AI
    if (allViolations.length === 0) {
      return this.emptyReport();
    }

    return this.aiReducer.reduce(allViolations, request);
  }

  private filterRules(rules: Rule[], request: ReviewRequest): Rule[] {
    return rules.filter(rule => {
      // Filter by file patterns
      if (rule.appliesTo) {
        const hasMatchingFile = request.metadata?.files.some(
          file => rule.appliesTo.some(pattern => minimatch(file, pattern))
        );
        if (!hasMatchingFile) return false;
      }

      // Skip style rules for hotfixes
      if (request.metadata?.isHotfix && rule.category === 'style') {
        return false;
      }

      return true;
    });
  }
}
```

### Why Concurrency Limiting Matters

| Scenario | Without Limit | With Limit (5) |
|----------|---------------|----------------|
| 20 rules | 20 simultaneous API calls | 5 at a time, 4 batches |
| Rate limiting | Likely to hit API limits | Stays under limits |
| Memory usage | 20 responses buffered | Max 5 buffered at once |
| Error recovery | Thundering herd on retry | Gradual recovery |
| Observability | Hard to track progress | Clear batch progression |

## Reduce Phase

### Single-Pass AI Reduce

The reduce phase uses a single AI call to:
1. Deduplicate semantically similar findings
2. Resolve conflicting suggestions
3. Prioritize by severity and impact
4. Generate a coherent, actionable report

```typescript
class AIReducer {
  constructor(
    private aiService: AIService,
    private config: ReduceConfig
  ) {}

  async reduce(
    violations: RuleViolation[],
    context: ReviewRequest
  ): Promise<ReviewReport> {
    const prompt = this.buildReducePrompt(violations, context);

    const response = await this.aiService.invoke({
      model: this.config.reduceModel,  // Use best model for synthesis
      prompt,
      temperature: 0.3,
      maxTokens: this.config.maxReduceTokens,
    });

    return this.parseReport(response);
  }

  private buildReducePrompt(
    violations: RuleViolation[],
    context: ReviewRequest
  ): string {
    return `You are synthesizing a code review from multiple specialized reviewers.

## Context
- Files changed: ${context.metadata?.files.length || 'unknown'}
- Review type: ${context.metadata?.isHotfix ? 'hotfix' : 'standard'}

## Raw Findings
${violations.length} findings from ${this.countUniqueRules(violations)} rules:

${this.formatViolations(violations)}

## Your Tasks

### 1. Deduplicate
Multiple rules may flag the same underlying issue differently. Merge findings that:
- Point to the same code location AND describe the same problem
- Are redundant (one finding is a subset of another)

Keep the clearest, most actionable description.

### 2. Resolve Conflicts
When rules disagree:
- Security > Correctness > Performance > Maintainability > Style
- Consider the context (hot path vs. cold path, public API vs. internal)
- Pick the better suggestion, explain briefly why

### 3. Prioritize
Order findings by:
1. Critical: Bugs, security issues, data loss risks
2. Major: Logic errors, missing error handling, breaking changes
3. Minor: Performance improvements, better patterns
4. Nitpick: Style, naming, minor cleanup

### 4. Synthesize Report
Create a clean, actionable review that a developer can work through.

## Output Format
Return JSON:
{
  "summary": "2-3 sentence overall assessment",
  "overallSeverity": "clean|minor-issues|needs-work|critical",
  "mustFix": [
    "Brief description of blocking issues (if any)"
  ],
  "findings": [
    {
      "id": "f1",
      "severity": "critical|major|minor|nitpick",
      "category": "security|reliability|performance|maintainability|style",
      "file": "path/to/file.ts",
      "line": 42,
      "issue": "Clear description of the problem",
      "suggestion": "Specific fix recommendation",
      "fromRules": ["rule-id-1", "rule-id-2"]
    }
  ],
  "stats": {
    "totalIssues": 5,
    "deduplicated": 2,
    "byCategory": {"reliability": 3, "style": 2},
    "bySeverity": {"major": 2, "minor": 3}
  }
}`;
  }

  private formatViolations(violations: RuleViolation[]): string {
    // Group by file for easier reading
    const byFile = this.groupBy(violations, v => v.file);

    let output = '';
    for (const [file, fileViolations] of Object.entries(byFile)) {
      output += `\n### ${file}\n`;
      for (const v of fileViolations) {
        output += `- [${v.ruleName}] Line ${v.line}: ${v.issue}\n`;
        output += `  Snippet: \`${v.snippet}\`\n`;
        if (v.suggestion) {
          output += `  Suggestion: ${v.suggestion}\n`;
        }
      }
    }
    return output;
  }
}
```

### Handling Edge Cases

#### No Violations
```typescript
private emptyReport(): ReviewReport {
  return {
    summary: 'No issues found. Code looks good!',
    overallSeverity: 'clean',
    findings: [],
    stats: {
      totalIssues: 0,
      byCategory: {},
      bySeverity: {}
    }
  };
}
```

#### Reduce Failure Recovery
```typescript
async reduce(violations: RuleViolation[], context: ReviewRequest): Promise<ReviewReport> {
  try {
    return await this.aiReduce(violations, context);
  } catch (error) {
    this.logger.error('AI reduce failed, falling back to simple aggregation', error);
    return this.fallbackReduce(violations);
  }
}

private fallbackReduce(violations: RuleViolation[]): ReviewReport {
  // Simple programmatic aggregation without AI
  const dedupedByLocation = this.simpleDedup(violations);
  const sorted = this.sortBySeverity(dedupedByLocation);

  return {
    summary: `Found ${sorted.length} issues across ${this.countFiles(sorted)} files.`,
    overallSeverity: this.calculateOverallSeverity(sorted),
    findings: sorted.map(this.toFinding),
    stats: this.calculateStats(sorted)
  };
}
```

## Configuration

### Settings Schema

```typescript
interface MapReduceReviewConfig {
  // Map phase settings
  map: {
    defaultModel: string;        // Default model for rule mappers
    maxConcurrency: number;      // Max concurrent rule executions (default: 5)
    maxTokensPerRule: number;    // Token limit per rule call
    timeoutMs: number;           // Timeout per rule execution
    retryAttempts: number;       // Retry failed rules
  };

  // Reduce phase settings
  reduce: {
    model: string;               // Model for synthesis (use best)
    maxTokens: number;           // Token limit for reduce call
    timeoutMs: number;           // Timeout for reduce
    fallbackEnabled: boolean;    // Use programmatic fallback on failure
  };

  // General settings
  rules: {
    folder: string;              // Path to rules folder
    pattern: string;             // Glob pattern for rule files
    enabledRules?: string[];     // Whitelist of rule IDs
    disabledRules?: string[];    // Blacklist of rule IDs
  };
}
```

### Default Configuration

```typescript
const defaultConfig: MapReduceReviewConfig = {
  map: {
    defaultModel: 'haiku',
    maxConcurrency: 5,       // Process 5 rules at a time
    maxTokensPerRule: 4000,
    timeoutMs: 30000,
    retryAttempts: 1,
  },
  reduce: {
    model: 'sonnet',
    maxTokens: 8000,
    timeoutMs: 60000,
    fallbackEnabled: true,
  },
  rules: {
    folder: '.github/cr-rules',
    pattern: '**/*.md',
  },
};
```

## Model Selection Strategy

| Phase | Recommended Model | Reasoning |
|-------|------------------|-----------|
| Map (per rule) | Haiku / GPT-4-mini | Narrow task, pattern matching, cost-effective |
| Reduce | Sonnet / GPT-4 | Judgment, synthesis, conflict resolution |

### Cost Analysis

For a review with 10 rules and 500-line diff:

**Traditional single-pass:**
- 1 call × (all rules + diff) ≈ 8K input tokens
- Model: GPT-4 (need best for complex task)
- Cost: ~$0.24

**Map-reduce:**
- Map: 10 calls × 1K tokens = 10K tokens @ Haiku
- Reduce: 1 call × 3K tokens @ Sonnet
- Cost: ~$0.05 (10 × $0.001 + 1 × $0.04)

**Result: ~80% cost reduction with better quality**

## Error Handling

### Rule Execution Failures

```typescript
async applyRule(rule: Rule, diff: string): Promise<RuleViolation[]> {
  for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
    try {
      return await this.executeRule(rule, diff);
    } catch (error) {
      if (attempt === this.config.retryAttempts) {
        this.logger.warn(`Rule ${rule.id} failed after ${attempt + 1} attempts`);
        this.metrics.recordRuleFailure(rule.id, error);
        return []; // Return empty, don't fail entire review
      }
      await this.delay(1000 * (attempt + 1)); // Exponential backoff
    }
  }
  return [];
}
```

### Partial Results

```typescript
async review(request: ReviewRequest): Promise<ReviewReport> {
  const tasks = rules.map(rule => () =>
    this.ruleMapper.applyRule(rule, request.diff)
  );

  // Use allSettled variant with concurrency limit
  const results = await this.limiter.allSettled(tasks);

  const successful = results
    .filter((r): r is PromiseFulfilledResult<RuleViolation[]> =>
      r.status === 'fulfilled')
    .map(r => r.value);

  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected');

  if (failed.length > 0) {
    this.logger.warn(`${failed.length}/${rules.length} rules failed`);
  }

  const report = await this.aiReducer.reduce(successful.flat(), request);

  // Include warning if some rules failed
  if (failed.length > 0) {
    report.warnings = [`${failed.length} rules failed to execute`];
  }

  return report;
}
```

#### ConcurrencyLimiter.allSettled

```typescript
// Add to ConcurrencyLimiter class
async allSettled<T>(
  tasks: Array<() => Promise<T>>
): Promise<PromiseSettledResult<T>[]> {
  return Promise.all(
    tasks.map(task =>
      this.run(task)
        .then(value => ({ status: 'fulfilled' as const, value }))
        .catch(reason => ({ status: 'rejected' as const, reason }))
    )
  );
}
```

## Extension Points

### Custom Rule Loaders

```typescript
interface RuleLoader {
  loadRules(): Promise<Rule[]>;
}

// Default: Load from markdown files
class FileSystemRuleLoader implements RuleLoader { }

// Alternative: Load from remote config
class RemoteRuleLoader implements RuleLoader { }

// Alternative: Load from package.json
class PackageJsonRuleLoader implements RuleLoader { }
```

### Custom Reducers

```typescript
interface Reducer {
  reduce(violations: RuleViolation[], context: ReviewRequest): Promise<ReviewReport>;
}

// Default: AI-powered reduce
class AIReducer implements Reducer { }

// Alternative: Simple programmatic reduce
class SimpleReducer implements Reducer { }

// Alternative: Hybrid (AI for dedup, programmatic for rest)
class HybridReducer implements Reducer { }
```

### Pre/Post Hooks

```typescript
interface ReviewHooks {
  beforeMap?(rules: Rule[], request: ReviewRequest): Promise<Rule[]>;
  afterMap?(violations: RuleViolation[]): Promise<RuleViolation[]>;
  beforeReduce?(violations: RuleViolation[]): Promise<RuleViolation[]>;
  afterReduce?(report: ReviewReport): Promise<ReviewReport>;
}
```

## Future Considerations

### Caching

- Rule prompts are stable; cache rule+diff hash → violations
- Invalidate cache when rule file changes
- Consider semantic caching for similar diffs

### Streaming

- Stream map phase results as they complete
- Show incremental findings in UI before reduce completes

### Adaptive Model Selection

- Track rule accuracy per model
- Auto-promote rules to better models if accuracy is low
- Auto-demote rules to cheaper models if accuracy is high

### Rule Learning

- Track false positives/negatives
- Auto-tune rule prompts based on user feedback
- Generate new rules from recurring manual review comments
