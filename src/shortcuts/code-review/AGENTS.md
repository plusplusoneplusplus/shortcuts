# Code Review Module - Developer Reference

This module provides code review capabilities that analyze Git diffs against custom coding rules using AI (Copilot CLI). It uses the map-reduce framework for parallel execution across multiple rules.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Interface                             │
│  (Context menus on Git commits, staged/pending changes)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Commands trigger review
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Code Review Module                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │CodeReviewService│  │ ProcessAdapter  │  │ ResponseParser  │ │
│  │ (Configuration) │  │ (AI Integration)│  │(Result Parsing) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  RulesLoader    │  │ PromptBuilder   │  │ ResultViewer    │ │
│  │ (.github/cr-*)  │  │ (Single-rule)   │  │  (WebView)      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│           ai-service (Process Tracking) & map-reduce            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### CodeReviewService

The core service that handles configuration, rule loading, and prompt construction.

```typescript
import { CodeReviewService } from '../code-review';

const service = new CodeReviewService();

// Get configuration
const config = service.getConfig();

// Validate configuration
const validation = service.validateConfig(workspaceRoot);
if (!validation.valid) {
    console.error(validation.error);
}

// Load rules from .github/cr-rules/
const rules = service.loadRulesSync(workspaceRoot);

// Build prompt for a single rule
const prompt = service.buildSingleRulePrompt(rule, metadata);
```

### ProcessAdapter

Bridges between the code review feature and the generic AI process tracking system.

```typescript
import { CodeReviewProcessAdapter, CodeReviewMetadata } from '../code-review';

const adapter = new CodeReviewProcessAdapter(processManager);

// Register a review process
const processId = adapter.registerReviewProcess('Review commit abc123', metadata);

// Update on completion
adapter.completeProcess(processId, reviewResult);

// Register a group for parallel rule reviews
const groupId = adapter.registerReviewGroup(
    'Review commit abc123 against 5 rules',
    groupMetadata
);
```

### ResponseParser

Parses AI responses to extract structured review findings.

```typescript
import { ResponseParser, ReviewResponse } from '../code-review';

// Parse AI response
const response: ReviewResponse = ResponseParser.parse(aiOutput);

// Access findings
for (const finding of response.findings) {
    console.log(`[${finding.severity}] ${finding.rule}: ${finding.description}`);
    console.log(`  File: ${finding.file}:${finding.line}`);
    console.log(`  Suggestion: ${finding.suggestion}`);
}
```

## Configuration

The module reads configuration from VSCode settings:

```json
{
  "workspaceShortcuts.codeReview.rulesFolder": ".github/cr-rules",
  "workspaceShortcuts.codeReview.rulesPattern": "*.md",
  "workspaceShortcuts.codeReview.outputMode": "panel",
  "workspaceShortcuts.codeReview.maxConcurrency": 3,
  "workspaceShortcuts.codeReview.reduceMode": "deterministic"
}
```

## Rule Files

Rule files are markdown documents in the configured folder (default: `.github/cr-rules/`).

### Basic Rule Structure

```markdown
# Rule Name

Description of the coding standard.

## Examples

### Good
```typescript
// correct pattern
```

### Bad
```typescript
// incorrect pattern
```
```

### Front Matter Support

Rules can include YAML front matter for metadata:

```markdown
---
priority: high
category: security
enabled: true
---

# Security: Input Validation

Always validate user input...
```

## Usage Examples

### Example 1: Review a Commit

```typescript
import { CodeReviewService, CodeReviewProcessAdapter, CodeReviewMetadata } from '../code-review';

const service = new CodeReviewService();
const adapter = new CodeReviewProcessAdapter(processManager);

// Load rules
const { rules } = service.loadRulesSync(workspaceRoot);

// Create metadata for commit review
const metadata: CodeReviewMetadata = {
    type: 'commit',
    commitSha: 'abc123def',
    commitMessage: 'Add user authentication',
    repositoryRoot: workspaceRoot
};

// Review against each rule in parallel
for (const rule of rules) {
    const prompt = service.buildSingleRulePrompt(rule, metadata);
    const processId = adapter.registerReviewProcess(
        service.createProcessTitle(metadata, rule.filename),
        { rule: rule.filename, ...metadata }
    );
    
    // Send to AI and handle response...
}
```

### Example 2: Review Pending Changes

```typescript
const metadata: CodeReviewMetadata = {
    type: 'pending',
    repositoryRoot: workspaceRoot
};

// Same workflow as commit review
```

### Example 3: Custom Rule Selection

```typescript
// Show quick pick for rule selection
const selectedRules = await service.showRuleSelection(workspaceRoot);

if (selectedRules) {
    const { rules } = service.loadSpecificRules(workspaceRoot, selectedRules);
    // Continue with selected rules only
}
```

## Integration with Map-Reduce

For parallel review across multiple rules, use the map-reduce framework:

```typescript
import { createCodeReviewJob } from '../map-reduce';
import { CodeReviewInput, CodeReviewOutput } from '../map-reduce/jobs';

// Create the job
const job = createCodeReviewJob({
    rules: loadedRules,
    metadata: reviewMetadata,
    aiInvoker: copilotInvoker
});

// Execute with the map-reduce executor
const result = await executor.execute(job, input);

// Process results
if (result.success && result.output) {
    const findings = result.output.summary.totalFindings;
    console.log(`Found ${findings} issues`);
}
```

## Types

### CodeReviewMetadata

```typescript
interface CodeReviewMetadata {
    /** Type of review: 'commit', 'pending', or 'staged' */
    type: 'commit' | 'pending' | 'staged';
    /** Commit SHA for commit reviews */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** Repository root path */
    repositoryRoot?: string;
}
```

### CodeRule

```typescript
interface CodeRule {
    /** Rule filename (e.g., '001-naming.md') */
    filename: string;
    /** Full path to the rule file */
    path: string;
    /** Rule content (without front matter) */
    content: string;
    /** Raw file content (with front matter) */
    rawContent: string;
    /** Parsed front matter metadata */
    frontMatter?: Record<string, unknown>;
}
```

### ReviewFinding

```typescript
interface ReviewFinding {
    /** Rule that was violated */
    rule: string;
    /** Severity: error, warning, info */
    severity: 'error' | 'warning' | 'info';
    /** Description of the finding */
    description: string;
    /** Affected file path */
    file?: string;
    /** Line number */
    line?: number;
    /** Suggested fix */
    suggestion?: string;
}
```

## Best Practices

1. **Organize rules by priority**: Prefix rule filenames with numbers (e.g., `001-`, `002-`) for consistent ordering.

2. **Keep rules focused**: Each rule file should cover one specific coding standard.

3. **Use front matter**: Add metadata like `priority`, `category`, and `enabled` for better organization.

4. **Handle large diffs**: The service includes `isDiffLarge()` and `confirmLargeDiff()` for warning users about token limits.

5. **Use parallel execution**: For multiple rules, leverage the map-reduce framework to review in parallel.

## See Also

- `src/shortcuts/ai-service/AGENTS.md` - AI process tracking
- `src/shortcuts/map-reduce/` - Map-reduce framework for parallel execution
- `.github/cr-rules/` - Example rule files in this repository
