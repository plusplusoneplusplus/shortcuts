# Code Review Against Rules

## Overview

Review Git commits or pending changes against custom coding rules defined in markdown files. Each rule is evaluated in parallel by a separate AI process, and results are aggregated into a unified report.

## Usage

1. Create rule files in `.github/cr-rules/*.md`
2. Right-click a commit → "Review Against Rules"
3. Or use "Review Pending/Staged Changes Against Rules"
4. View aggregated results in the Code Review panel

## Rule Files

Rules are markdown files that describe coding standards:

```
.github/cr-rules/
├── 01-naming.md        # Naming conventions
├── 02-security.md      # Security guidelines
├── 03-performance.md   # Performance best practices
└── 04-testing.md       # Test coverage requirements
```

Files are loaded alphabetically. Prefix with numbers to control order.

Example rule file:
```markdown
# Naming Conventions

## Variables
- Use camelCase for variables and functions
- Use PascalCase for classes and types
- Use SCREAMING_SNAKE_CASE for constants

## Functions
- Use verbs for function names (get, set, create, update, delete)
- Boolean functions should start with is, has, can, should

## Files
- Use kebab-case for file names
- Test files should end with .test.ts or .spec.ts
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Triggers Review                      │
│              (commit, pending changes, or staged)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Load Rule Files                             │
│                                                                  │
│  .github/cr-rules/                                              │
│    ├── 01-naming.md                                             │
│    ├── 02-security.md                                           │
│    └── 03-performance.md                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Parallel AI Processes                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Process #1   │  │ Process #2   │  │ Process #3   │          │
│  │ 01-naming.md │  │ 02-security  │  │ 03-perf.md   │          │
│  │              │  │              │  │              │          │
│  │ Single rule  │  │ Single rule  │  │ Single rule  │          │
│  │ + diff ref   │  │ + diff ref   │  │ + diff ref   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Findings     │  │ Findings     │  │ Findings     │          │
│  │ Assessment   │  │ Assessment   │  │ Assessment   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Aggregate Results                             │
│                                                                  │
│  • Combine findings from all rules                              │
│  • Tag each finding with source rule                            │
│  • Determine overall assessment (fail > warning > pass)         │
│  • Track execution stats                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Display Results                               │
│                                                                  │
│  # Code Review Results                                          │
│                                                                  │
│  **Commit:** abc1234                                            │
│  **Rules Processed:** 3 (3 passed, 0 failed)                    │
│  **Total Time:** 8.5s                                           │
│                                                                  │
│  ## Findings                                                     │
│                                                                  │
│  ### 01-naming.md (2 issues)                                    │
│  🔴 ERROR: Variable 'x' doesn't follow camelCase                │
│  🟠 WARNING: Function name too short                            │
│                                                                  │
│  ### 03-performance.md (1 issue)                                │
│  🟠 WARNING: Consider using Map instead of object               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

```json
{
  "workspaceShortcuts.codeReview.rulesFolder": ".github/cr-rules",
  "workspaceShortcuts.codeReview.rulesPattern": "**/*.md",
  "workspaceShortcuts.codeReview.outputMode": "aiProcess"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `rulesFolder` | `.github/cr-rules` | Path to rules directory |
| `rulesPattern` | `**/*.md` | Glob pattern for rule files |
| `outputMode` | `aiProcess` | Where to show results: `aiProcess`, `editor`, or `clipboard` |

## Output Modes

| Mode | Behavior |
|------|----------|
| `aiProcess` | Show results in Code Review Viewer panel |
| `editor` | Open aggregated markdown in new editor tab |
| `clipboard` | Copy all prompts to clipboard (for manual use) |

---

## Types

### Review Metadata

```typescript
interface CodeReviewMetadata {
    type: 'commit' | 'pending' | 'staged';
    commitSha?: string;
    commitMessage?: string;
    rulesUsed: string[];
    diffStats?: { files: number; additions: number; deletions: number };
    repositoryRoot?: string;
}
```

### Single Rule Result

```typescript
interface SingleRuleReviewResult {
    rule: CodeRule;
    processId: string;
    success: boolean;
    error?: string;
    findings: ReviewFinding[];
    rawResponse?: string;
    assessment?: 'pass' | 'needs-attention' | 'fail';
}
```

### Aggregated Result

```typescript
interface AggregatedCodeReviewResult {
    metadata: CodeReviewMetadata;
    summary: ReviewSummary;
    findings: ReviewFinding[];
    ruleResults: SingleRuleReviewResult[];
    rawResponse: string;
    timestamp: Date;
    executionStats: {
        totalRules: number;
        successfulRules: number;
        failedRules: number;
        totalTimeMs: number;
    };
}
```

### Review Finding

```typescript
interface ReviewFinding {
    id: string;
    severity: 'error' | 'warning' | 'info' | 'suggestion';
    rule: string;           // Source rule filename
    file?: string;          // Affected file path
    line?: number;          // Line number
    description: string;    // Issue description
    codeSnippet?: string;   // Problematic code
    suggestion?: string;    // How to fix
    explanation?: string;   // Why it matters
}
```

---

## AI Prompt Structure

Each rule gets a focused prompt:

```
Review the following code changes against the specific coding rule provided below.
Focus ONLY on violations of this single rule.

---

# Coding Rule

**Rule File:** naming-conventions.md
**Path:** `/repo/.github/cr-rules/naming-conventions.md`

Please read and apply this rule file to the code changes.

---

# Code Changes

Repository: `/path/to/repo`
Commit: abc1234567890
Message: feat: add user authentication

Please retrieve the commit diff using the commit hash above.

---

Please provide your response in the following structured format:

## Summary
Provide a brief overall assessment (1-2 sentences).
Overall: [PASS | NEEDS_ATTENTION | FAIL]

## Findings

For each issue found, use this format:

### [SEVERITY] Rule: [Rule Name]
- **File:** [filename or "N/A"]
- **Line:** [line number or "N/A"]
- **Issue:** [Description of the problem]
- **Code:** `[problematic code snippet]`
- **Suggestion:** [How to fix it]
- **Explanation:** [Why this matters]

Where SEVERITY is one of: ERROR, WARNING, INFO, SUGGESTION

If no issues are found, state "No violations found." under Findings.
```

---

## Aggregation Logic

### Combining Findings

All findings from successful rule reviews are merged into a single list. Each finding is tagged with its source rule filename.

### Overall Assessment

The worst-case assessment across all rules determines the overall result:

```
fail > needs-attention > pass
```

- If any rule returns `fail` → overall is `fail`
- If any rule returns `needs-attention` (and none fail) → overall is `needs-attention`
- If all rules return `pass` → overall is `pass`

### Execution Statistics

Tracked for visibility:
- Total rules processed
- Successful rule count
- Failed rule count (AI errors, timeouts)
- Total execution time

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Rule file not found | Skip with warning |
| AI process timeout | Mark rule as failed, continue others |
| AI returns invalid response | Mark rule as failed, preserve error message |
| All rules fail | Show error summary, no findings |
| Partial failure | Show successful results + failure summary |

Failed rules appear in the Rule Results table with error details.

---

## Commands

| Command | Description |
|---------|-------------|
| `shortcuts.codeReview.reviewCommit` | Review a specific commit |
| `shortcuts.codeReview.reviewPending` | Review all pending changes |
| `shortcuts.codeReview.reviewStaged` | Review staged changes only |
| `shortcuts.codeReview.selectRules` | Choose which rules to apply |

---

## File Structure

```
src/shortcuts/code-review/
├── code-review-service.ts      # Core service, prompt building
├── code-review-commands.ts     # Command handlers, parallel execution
├── code-review-viewer.ts       # Result display panel
├── response-parser.ts          # Parse AI responses, aggregation
└── types.ts                    # Type definitions
```
