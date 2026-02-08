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

### code-review-viewer.ts

Webview panel for displaying CodeReviewResults with severity filtering, interactive fix selection, and applying selected fixes.

```typescript
import {
    CodeReviewViewerProvider,
    showCodeReviewResults
} from '../code-review/code-review-viewer';

const viewer = new CodeReviewViewerProvider(context.extensionUri);

// Show review results in webview
await viewer.showResults(reviewResults, {
    title: 'Code Review Results',
    severityFilter: ['error', 'warning'], // Filter by severity
    allowFixSelection: true // Enable interactive fix selection
});

// Listen for fix selection
viewer.onDidSelectFixes((selectedFixes) => {
    // Apply selected fixes
    fixApplier.applySelectedFixes(selectedFixes);
});
```

### fix-applier.ts

Applies AI-suggested fixes: preview changes, bottom-to-top editing to maintain line numbers, and `applySelectedFixes` method.

```typescript
import {
    FixApplier,
    previewFix,
    applySelectedFixes,
    applyFix
} from '../code-review/fix-applier';

const applier = new FixApplier();

// Preview a fix before applying
const preview = await previewFix(fix, document);
// Shows diff preview in webview

// Apply a single fix
await applyFix(fix, document);
// Edits are applied bottom-to-top to maintain line numbers

// Apply multiple selected fixes
await applySelectedFixes(selectedFixes, documents);
// Processes fixes in reverse order (bottom-to-top) to preserve line numbers
```

### front-matter-parser.ts

Parse YAML front matter from rule markdown files.

```typescript
import {
    parseFrontMatter,
    extractFrontMatter,
    stripFrontMatter
} from '../code-review/front-matter-parser';

// Parse front matter from rule file
const { frontMatter, content } = parseFrontMatter(ruleFileContent);
// Returns: { frontMatter: { priority: 'high', category: 'security' }, content: '...' }

// Extract just the front matter
const metadata = extractFrontMatter(ruleFileContent);
// Returns: { priority: 'high', category: 'security', enabled: true }

// Strip front matter to get just the content
const ruleContent = stripFrontMatter(ruleFileContent);
// Returns: '# Security: Input Validation\n\nAlways validate user input...'
```

### response-parser.ts

Parse AI text responses into structured CodeReviewResult; aggregate results; format as markdown.

```typescript
import {
    ResponseParser,
    parseReviewResponse,
    aggregateResults,
    formatAsMarkdown
} from '../code-review/response-parser';

// Parse AI text response into structured result
const result = parseReviewResponse(aiOutput, ruleName);
// Returns: CodeReviewResult with findings array

// Aggregate multiple review results
const aggregated = aggregateResults(results);
// Returns: { totalFindings: 10, bySeverity: { error: 3, warning: 7 }, findings: [...] }

// Format results as markdown
const markdown = formatAsMarkdown(results);
// Returns: Formatted markdown report
```

**Note:** Rules loading functionality is implemented in `code-review-service.ts` (there is no separate `rules-loader.ts` file). The `CodeReviewService` class handles loading rules from `.github/cr-rules/` directory.

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

## Module Files

| File | Purpose |
|------|---------|
| `code-review-service.ts` | Core service: config, rule loading from `.github/cr-rules/*.md`, prompt building, diff stats |
| `code-review-commands.ts` | VS Code commands: review commit/pending/staged/range; orchestrates multi-rule review via pipeline-core map-reduce |
| `code-review-viewer.ts` | Webview panel: displays CodeReviewResults, severity filtering, interactive fix selection, apply fixes |
| `fix-applier.ts` | Applies AI-suggested fixes: preview changes, bottom-to-top editing to maintain line numbers |
| `front-matter-parser.ts` | Parse YAML front matter from rule markdown files (extracts model, metadata) |
| `response-parser.ts` | Parse AI responses into structured CodeReviewResult; aggregate results; format as markdown |
| `process-adapter.ts` | Adapter between code-review and generic IAIProcessManager; creates ProcessTracker for map-reduce |
| `concurrency-limiter.ts` | Re-exports ConcurrencyLimiter from pipeline-core |
| `types.ts` | All types: config, rules, findings, review results, prompt templates, severity levels |
| `index.ts` | Module exports |

**Note:** Rule loading logic is in `code-review-service.ts` (no separate `rules-loader.ts` file).

## See Also

- `src/shortcuts/ai-service/AGENTS.md` - AI process tracking
- `packages/pipeline-core/AGENTS.md` - Map-reduce framework for parallel execution
- `.github/cr-rules/` - Example rule files in this repository
