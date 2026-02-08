# YAML Pipeline Module - Developer Reference

This module provides a YAML-based configuration layer on top of the map-reduce framework. It enables easy configuration of AI MapReduce workflows via YAML files.

**Package Structure (2026-01):**
- `pipeline-core` - Core pipeline engine (executor, CSV reader, template engine, filters, resolvers)
- `src/shortcuts/yaml-pipeline/` - VS Code UI layer (PipelineManager, tree provider, result viewer)

The core execution functionality has been extracted to `packages/pipeline-core/src/pipeline/` for use in CLI tools and other Node.js environments.

## Pipeline Package Structure

Pipelines are organized as **packages** - directories containing a `pipeline.yaml` file and related resources:

```
.vscode/pipelines/
├── run-tests/                  # Pipeline package
│   ├── pipeline.yaml           # Standard entry point (required)
│   ├── input.csv               # Data file referenced in pipeline
│   └── data/
│       └── test-cases.csv      # Nested resources supported
├── analyze-code/               # Another pipeline package
│   ├── pipeline.yaml
│   ├── data/
│   │   ├── files.csv
│   │   └── rules.csv
│   └── templates/
│       └── prompt-template.txt
└── shared/                     # Shared resources (not a pipeline)
    ├── common-mappings.csv
    └── reference-data.json
```

### Key Concepts

1. **Package Directory**: Each subdirectory in `.vscode/pipelines/` with a `pipeline.yaml` or `pipeline.yml` is a pipeline package
2. **Entry Point**: Only `pipeline.yaml` or `pipeline.yml` is recognized as the pipeline definition
3. **Relative Paths**: All paths in `pipeline.yaml` are resolved relative to the package directory
4. **Shared Resources**: Use `../shared/file.csv` to reference shared resources across packages

### Path Resolution Examples

Given package at `.vscode/pipelines/run-tests/`:
- `path: "input.csv"` → `.vscode/pipelines/run-tests/input.csv`
- `path: "data/files.csv"` → `.vscode/pipelines/run-tests/data/files.csv`
- `path: "../shared/common.csv"` → `.vscode/pipelines/shared/common.csv`

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  Pipeline Package Directory                     │
│  (package-name/pipeline.yaml + resource files)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Parse
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   YAML Pipeline Module                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              parsePipelineYAML                              ││
│  │  - Parses YAML config                                       ││
│  │  - Validates structure                                      ││
│  │  - Resolves paths relative to package                       ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  CSV Reader     │  │ Template Engine │  │   Executor      │ │
│  │ (Data loading)  │  │ (Var substitut) │  │(Run pipeline)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Creates job
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Map-Reduce Framework                           │
│             (Executor, Splitters, Reducers)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Module Files

This section lists all files in the module's UI layer:

### Core Module Files
- `index.ts` - Module exports
- `bundled/index.ts` - Bundled pipelines registry

### UI Module Files
- `ui/index.ts` - UI module exports
- `ui/types.ts` - Type definitions (PipelineInfo, PipelineSource, PipelineTemplateType, etc.)
- `ui/pipeline-manager.ts` - Pipeline CRUD, discovery, validation, bundled pipelines
- `ui/tree-data-provider.ts` - PipelinesTreeDataProvider (extends FilterableTreeDataProvider)
- `ui/pipeline-item.ts` - Tree items: PipelineCategoryItem, PipelineItem, ResourceItem
- `ui/commands.ts` - PipelineCommands class, VS Code command handlers
- `ui/pipeline-executor-service.ts` - VS Code pipeline execution, progress, process tracking
- `ui/preview-provider.ts` - CustomTextEditorProvider for pipeline.yaml preview
- `ui/preview-content.ts` - Preview HTML with interactive Mermaid diagrams
- `ui/preview-mermaid.ts` - Mermaid flowchart diagram generation
- `ui/result-viewer-provider.ts` - Enhanced result display with retry/export
- `ui/result-viewer-content.ts` - Result viewer HTML generation
- `ui/result-viewer-types.ts` - Result viewer type definitions
- `ui/bundled-readonly-provider.ts` - Read-only bundled pipeline provider

## Key Components

### Pipeline Executor

Main API for executing YAML-configured pipelines.

```typescript
import { executePipeline, parsePipelineYAML } from '../yaml-pipeline';

// Execute pipeline from a package
// pipelineDirectory is the package folder containing pipeline.yaml
const pipelineDir = '/workspace/.vscode/pipelines/run-tests';
const yamlContent = fs.readFileSync(path.join(pipelineDir, 'pipeline.yaml'), 'utf8');
const config = await parsePipelineYAML(yamlContent);

const result = await executePipeline(config, {
    aiInvoker: copilotInvoker,
    pipelineDirectory: pipelineDir,  // All paths resolved relative to this
    onProgress: (progress) => {
        console.log(`${progress.phase}: ${progress.percentage}%`);
    }
});

if (result.success) {
    console.log('Output:', result.output);
    console.log('Stats:', result.executionStats);
}
```

### CSV Reader

Utilities for reading CSV data as pipeline input.

```typescript
import {
    readCSVFile,
    parseCSVContent,
    validateCSVHeaders,
    getCSVPreview
} from '../yaml-pipeline';

// Read CSV file
const data = await readCSVFile('./data.csv', {
    delimiter: ',',
    hasHeader: true,
    encoding: 'utf-8'
});

// Parse CSV content
const parsed = parseCSVContent(csvString, {
    delimiter: ',',
    hasHeader: true
});

// Validate headers match template variables
const validation = validateCSVHeaders(
    parsed.headers,
    ['name', 'description', 'category']
);

if (!validation.valid) {
    console.error('Missing headers:', validation.missing);
}

// Preview CSV data
const preview = getCSVPreview('./data.csv', { rows: 5 });
```

### Template Engine

Variable substitution and prompt building.

```typescript
import {
    substituteTemplate,
    extractVariables,
    validateItemForTemplate,
    buildPromptFromTemplate,
    parseAIResponse,
    extractJSON
} from '../yaml-pipeline';

// Substitute variables in template
const prompt = substituteTemplate(
    'Analyze {{name}} in {{category}}',
    { name: 'Feature X', category: 'Performance' }
);

// Extract variable names from template
const vars = extractVariables('Hello {{name}}, your score is {{score}}');
// ['name', 'score']

// Validate item has required variables
const valid = validateItemForTemplate(
    { name: 'Test', score: 95 },
    ['name', 'score', 'grade']
);
// { valid: false, missing: ['grade'] }

// Build full prompt with system context
const fullPrompt = buildPromptFromTemplate({
    template: 'Analyze: {{item}}',
    systemPrompt: 'You are a code reviewer.',
    item: { item: 'function foo()' }
});

// Parse AI response
const parsed = parseAIResponse(aiOutput, 'json');

// Extract JSON from mixed content
const json = extractJSON('Some text {"result": true} more text');
// { result: true }
```

## YAML Pipeline Format

### Basic Structure

```yaml
# pipeline.yaml (in package directory)
name: "Code Analysis Pipeline"
description: "Analyze code files for issues"
# Optional: Working directory for AI SDK sessions (not for CSV/prompt resolution)
# workingDirectory: "../../../frontend" # Relative to pipeline package dir, or absolute

input:
  type: csv
  # Path is relative to this pipeline's package directory
  path: "input.csv"
  delimiter: ","

map:
  prompt: |
    Analyze this code:
    File: {{filename}}
    Content: {{content}}
    
    Focus on: {{focus_areas}}
    
    Return JSON with your analysis.
  
  output:
    - issues
    - score
  
  parallel: 5

reduce:
  type: json
```

### Map Phase Template Variables

In the map phase, you can use template variables in your prompt:

#### Item Variables (from CSV/input)
CSV columns become directly accessible as template variables:

```yaml
# CSV: id, title, priority
map:
  prompt: "Analyze {{title}} (priority: {{priority}})"
```

- Each row becomes a PromptItem object: `{id: "123", title: "Bug", priority: "high"}`
- Column headers are trimmed but not transformed (original case preserved)
- Empty cells become empty strings `""`
- No nested/complex types (flat string key-value pairs only)

#### Special Variable: {{ITEMS}}

The `{{ITEMS}}` variable provides access to **all input items** as a JSON array. This enables context-aware processing where each item can reference the full batch:

```yaml
map:
  prompt: |
    Analyze bug {{id}}: {{title}}
    
    For context, here are all bugs in this batch:
    {{ITEMS}}
    
    Determine if this bug is related to any others.
  output:
    - analysis
    - related_bugs
```

**Use cases for {{ITEMS}}:**
- Cross-referencing items to find relationships or duplicates
- Providing batch context for more informed analysis
- Comparative analysis (e.g., "rank this item relative to others")
- Deduplication detection during map phase

**Example output of {{ITEMS}}:**
```json
[
  {"id": "1", "title": "Login fails", "priority": "high"},
  {"id": "2", "title": "Auth token expired", "priority": "medium"},
  {"id": "3", "title": "Session timeout", "priority": "low"}
]
```

**Note:** `{{ITEMS}}` is a special system variable and is automatically excluded from validation. You don't need to have an "ITEMS" column in your CSV.

### Batch Mapping (batchSize)

By default, each input item is processed with a separate AI call (batchSize: 1). For efficiency, you can group items into batches:

```yaml
map:
  prompt: |
    Analyze these items:
    {{ITEMS}}
    
    Return JSON array with results for each.
  batchSize: 10  # Process 10 items per AI call
  output:
    - severity
    - category
```

**How it works:**
- Items are grouped into batches of the specified size
- Each batch is sent to AI as a single call with `{{ITEMS}}` containing the batch
- AI must return a JSON array with one result per input item
- Results are flattened back into individual results

**Example with 95 items and batchSize: 10:**
- 10 AI calls instead of 95 (9 batches of 10, 1 batch of 5)
- Progress shows "Processing batch 3/10..."

**Configuration:**
```yaml
map:
  prompt: |
    Analyze these bugs:
    {{ITEMS}}
    
    For each bug, determine severity and category.
    Return a JSON array with one object per bug.
  batchSize: 10      # Items per AI call (default: 1)
  output:
    - severity
    - category
  parallel: 5        # Concurrent batch calls (default: 5)
  timeoutMs: 1800000  # Timeout per batch (default: 30 min)
```

**Error Handling:**

| Scenario | Behavior |
|----------|----------|
| AI returns wrong count | Error the batch, report mismatch |
| Batch timeout | Retry once with 2× timeout |
| AI failure | All items in batch marked as failed |
| Invalid JSON | All items in batch marked as failed |

**Best Practices:**
1. Use `{{ITEMS}}` in your prompt when batchSize > 1
2. Instruct AI to return a JSON array with one result per item
3. Keep batchSize reasonable (10-20) to balance efficiency vs. context length
4. Use with structured output fields (not text mode) for reliable parsing

**Backward Compatibility:**
- Default batchSize is 1 (current behavior)
- Existing pipelines without batchSize work unchanged
- Parameters are available via template variables (e.g., `{{project}}`)

### Using Prompt Files

Instead of inline prompts, you can store prompts in separate `.md` files for better organization, version control, and reuse.

#### Prompt File Structure

```
.vscode/pipelines/
├── run-tests/                    # Pipeline package
│   ├── pipeline.yaml             # Pipeline definition
│   ├── test-suite.csv            # Input data
│   ├── analyze.prompt.md         # Prompt file (same folder)
│   └── prompts/                  # Optional prompts subfolder
│       ├── map.prompt.md
│       └── reduce.prompt.md
├── shared/                       # Shared across pipelines
│   └── prompts/
│       └── common-analysis.prompt.md
└── prompts/                      # Shared prompts folder at root
    └── global.prompt.md
```

#### Path Resolution Rules

| promptFile Value | Resolved Path |
|------------------|---------------|
| `"analyze.prompt.md"` | `{pipelineDir}/analyze.prompt.md` |
| `"prompts/map.prompt.md"` | `{pipelineDir}/prompts/map.prompt.md` |
| `"../shared/prompts/common.prompt.md"` | `{pipelinesRoot}/shared/prompts/common.prompt.md` |
| `"/absolute/path/prompt.md"` | `/absolute/path/prompt.md` |

#### Search Order for Bare Filenames

When `promptFile` is just a filename (no path separators):

1. **Pipeline package directory** - `{pipelineDir}/analyze.prompt.md`
2. **prompts/ subfolder** - `{pipelineDir}/prompts/analyze.prompt.md`
3. **Shared prompts folder** - `{pipelinesRoot}/prompts/analyze.prompt.md`

First match wins. If not found anywhere, throws a clear error listing searched paths.

#### YAML Examples with promptFile

**Simple (prompt in same folder):**
```yaml
name: "Run Tests Pipeline"
input:
  from:
    type: csv
    path: "test-suite.csv"

map:
  promptFile: "run-test.prompt.md"  # Searches pipeline folder
  output: [status, passed, failed]

reduce:
  type: list
```

**With prompts subfolder:**
```yaml
map:
  promptFile: "prompts/analyze.prompt.md"  # Explicit path

reduce:
  type: ai
  promptFile: "prompts/summarize.prompt.md"
  output:
    - summary
```

**Using shared prompts:**
```yaml
map:
  promptFile: "../shared/prompts/code-review.prompt.md"
```

#### Prompt File Format

Prompt files support both plain text and markdown with optional frontmatter:

**Simple (analyze.prompt.md):**
```markdown
Analyze this bug report:

Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Return JSON with severity and category.
```

**With metadata (optional, for future use):**
```markdown
---
version: 1.0
description: Bug analysis prompt
variables: [title, description, priority]
---

Analyze this bug report:

Title: {{title}}
Description: {{description}}
...
```

The frontmatter (if present) is automatically stripped when loading the prompt.

#### Validation Rules

1. **Mutual exclusion**: Error if both `prompt` and `promptFile` are specified
2. **Required**: Map phase must have either `prompt` or `promptFile`
3. **AI reduce**: If `reduce.type` is `"ai"`, must have either `prompt` or `promptFile`
4. **File exists**: Error with searched paths if file not found
5. **Non-empty**: Error if file is empty after stripping frontmatter

### Using Skills

Skills provide reusable guidance/context that can be attached to pipeline prompts. Skills are stored in `.github/skills/` at the workspace root.

**Key Concept:** Skills are **additional context**, not a replacement for prompts. You must still provide either `prompt` or `promptFile`, and optionally attach a `skill` for guidance.

#### Skill Directory Structure

```
.github/skills/
├── go-deep/
│   └── SKILL.md              # The skill guidance content (required)
├── summarizer/
│   └── SKILL.md
└── code-reviewer/
    └── SKILL.md
```

#### How Skills Work

When you specify `skill: "go-deep"`, the system:
1. Loads the skill content from `.github/skills/go-deep/SKILL.md`
2. Prepends it to your main prompt as guidance:

```
[Skill Guidance: go-deep]
{skill prompt content}

[Task]
{your main prompt}
```

#### YAML Examples with Skills

**Attaching a skill to a prompt:**
```yaml
name: "Deep Research Pipeline"

input:
  items:
    - topic: "AI Safety"

map:
  prompt: "Research the topic: {{topic}}"  # Main prompt (required)
  skill: "go-deep"                          # Optional skill guidance
  output: [findings, sources, confidence]
  parallel: 3

reduce:
  type: ai
  prompt: "Summarize {{COUNT}} results:\n{{RESULTS}}"
  skill: "summarizer"                       # Optional skill for reduce
  output: [summary, key_insights]
```

**Skill with promptFile:**
```yaml
name: "Analysis Pipeline"

input:
  items:
    - topic: "Machine Learning"

map:
  promptFile: "analyze.prompt.md"  # Main prompt from file
  skill: "analyzer"                 # Attach skill guidance
  output: [findings, recommendations]

reduce:
  type: json
```

**Without skill (skill is optional):**
```yaml
name: "Simple Pipeline"

input:
  items:
    - name: "Test"

map:
  prompt: "Process: {{name}}"  # Just the prompt, no skill
  output: [result]

reduce:
  type: list
```

#### Skill Metadata (SKILL.md)

The optional `SKILL.md` file can contain metadata in YAML frontmatter:

```markdown
---
name: Deep Research Skill
description: Performs deep research on a given topic
version: 1.0.0
variables: [topic, depth, focus_areas]
output: [findings, sources, confidence]
---

# Deep Research Skill

This skill performs comprehensive research on any topic.

## Usage

Provide a topic and optional depth/focus parameters.

## Expected Output

Returns findings, sources, and confidence scores.
```

#### Programmatic API

```typescript
import {
    resolveSkill,
    resolveSkillSync,
    resolveSkillWithDetails,
    skillExists,
    listSkills,
    validateSkill,
    getSkillsDirectory,
    SkillResolverError
} from '../yaml-pipeline';

// Resolve and load a skill prompt
const prompt = await resolveSkill('go-deep', workspaceRoot);

// Synchronous version
const promptSync = resolveSkillSync('go-deep', workspaceRoot);

// Get full details including metadata
const details = await resolveSkillWithDetails('go-deep', workspaceRoot);
console.log(details.content);        // The prompt content
console.log(details.resolvedPath);   // Path to SKILL.md
console.log(details.metadata);       // Parsed SKILL.md frontmatter metadata

// Check if skill exists
if (skillExists('go-deep', workspaceRoot)) {
    // Skill found
}

// List all available skills
const skills = listSkills(workspaceRoot);
// Returns: ['analyzer', 'go-deep', 'summarizer']

// Validate skill for config validation
const validation = validateSkill('go-deep', workspaceRoot);
if (!validation.valid) {
    console.error(validation.error);
}
```

#### Custom Skills Directory

By default, skills are loaded from `.github/skills/`. You can specify a custom path:

```typescript
// Use custom skills directory
const prompt = await resolveSkill('my-skill', workspaceRoot, 'custom/skills/path');
```

#### Programmatic API

```typescript
import {
    resolvePromptFile,
    resolvePromptFileSync,
    resolvePromptPath,
    getSearchPaths,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    PromptResolverError
} from '../yaml-pipeline';

// Resolve and load a prompt file
const prompt = await resolvePromptFile('analyze.prompt.md', pipelineDirectory);

// Synchronous version
const promptSync = resolvePromptFileSync('analyze.prompt.md', pipelineDirectory);

// Just resolve the path without loading
const resolvedPath = resolvePromptPath('analyze.prompt.md', pipelineDirectory);

// Get search paths for a bare filename
const paths = getSearchPaths('analyze.prompt.md', pipelineDirectory);
// Returns: ['{pipelineDir}/analyze.prompt.md', '{pipelineDir}/prompts/analyze.prompt.md', '{pipelinesRoot}/prompts/analyze.prompt.md']

// Check if prompt file exists
if (promptFileExists('analyze.prompt.md', pipelineDirectory)) {
    // File found
}

// Validate prompt file for config validation
const validation = validatePromptFile('analyze.prompt.md', pipelineDirectory);
if (!validation.valid) {
    console.error(validation.error);
    console.error('Searched:', validation.searchedPaths);
}

// Extract content from file with frontmatter
const { content, hadFrontmatter } = extractPromptContent(fileContent);
```

### Advanced Configuration with Shared Resources

```yaml
# Package: .vscode/pipelines/code-review/pipeline.yaml
name: "Multi-stage Review Pipeline"

input:
  type: csv
  # Reference shared rules from sibling directory
  path: "../shared/rules.csv"

map:
  prompt: |
    Review {{code_file}} against rule: {{rule_name}}
    
    Rule description: {{rule_description}}
    
    Respond with JSON: { "violations": [...], "passed": boolean }
  
  output:
    - violations
    - passed
  
  parallel: 3
  model: gpt-4

reduce:
  type: json
```

### AI-Powered Reduce

Use AI to synthesize, deduplicate, or prioritize results from the map phase.

```yaml
# Package: .vscode/pipelines/bug-synthesis/pipeline.yaml
name: "Bug Analysis with AI Synthesis"

input:
  type: csv
  path: "bugs.csv"

map:
  prompt: |
    Analyze this bug report:
    Title: {{title}}
    Description: {{description}}
    
    Categorize and assess severity.
    Return JSON: { "category": "...", "severity": "high|medium|low", "impact": "..." }
  
  output:
    - category
    - severity
    - impact
  
  parallel: 10

reduce:
  type: ai
  prompt: |
    You analyzed {{COUNT}} bug reports with these results:
    
    {{RESULTS}}
    
    Successful: {{SUCCESS_COUNT}}
    Failed: {{FAILURE_COUNT}}
    
    Task:
    1. Identify common patterns across bugs
    2. Prioritize top 5 critical issues
    3. Provide actionable recommendations
    
    Return JSON with: { "summary": "...", "criticalIssues": [...], "recommendations": [...] }
  
  output:
    - summary
    - criticalIssues
    - recommendations
  
  model: gpt-4  # Optional: override default model
```

#### AI Reduce Template Variables

Available in `reduce.prompt`:
- `{{RESULTS}}` - All successful map outputs as JSON array (inline in prompt)
- `{{RESULTS_FILE}}` - Path to temp file containing results JSON (recommended for large results or Windows)
- `{{COUNT}}` - Total number of results
- `{{SUCCESS_COUNT}}` - Number of successful map operations
- `{{FAILURE_COUNT}}` - Number of failed map operations

**When to use `{{RESULTS_FILE}}` vs `{{RESULTS}}`:**

| Use Case | Recommended Variable |
|----------|---------------------|
| Small results (< 10 items) | `{{RESULTS}}` |
| Large results (> 10 items) | `{{RESULTS_FILE}}` |
| Windows platform | `{{RESULTS_FILE}}` |
| Results contain newlines in string values | `{{RESULTS_FILE}}` |
| Need AI to parse JSON programmatically | `{{RESULTS_FILE}}` |

**Why `{{RESULTS_FILE}}` is preferred for Windows:**

On Windows, shell escaping converts newlines in the prompt to literal `\n` characters, which breaks JSON structure. Using `{{RESULTS_FILE}}` writes the JSON to a temp file that the AI can read directly, avoiding shell escaping issues entirely.

**Example using `{{RESULTS_FILE}}`:**
```yaml
reduce:
  type: ai
  prompt: |
    Read the analysis results from: {{RESULTS_FILE}}
    
    Processed {{COUNT}} items ({{SUCCESS_COUNT}} successful, {{FAILURE_COUNT}} failed).
    
    Synthesize the findings into an executive summary.
  output:
    - summary
    - keyFindings
```

#### Common AI Reduce Use Cases

**1. Synthesize into Executive Summary**
```yaml
reduce:
  type: ai
  prompt: |
    Analyzed {{COUNT}} items:
    {{RESULTS}}
    
    Create a 2-3 sentence executive summary highlighting key trends.
  output:
    - summary
```

**2. Deduplicate Similar Findings**
```yaml
reduce:
  type: ai
  prompt: |
    {{COUNT}} code review findings:
    {{RESULTS}}
    
    Deduplicate similar issues. Group by root cause and list affected files.
    Return JSON: { "uniqueFindings": [{ "issue": "...", "files": [...] }] }
  output:
    - uniqueFindings
```

**3. Prioritize and Rank**
```yaml
reduce:
  type: ai
  prompt: |
    {{COUNT}} technical debt items:
    {{RESULTS}}
    
    Rank by ROI (impact/effort). Return top 10 with reasoning.
  output:
    - topItems
```

## Usage Examples

### Example 1: Simple Text Processing

```yaml
# summarize.yaml
name: "Document Summarizer"

input:
  type: csv
  file: ./documents.csv

map:
  template: |
    Summarize this document:
    Title: {{title}}
    Content: {{content}}
    
    Provide a 2-3 sentence summary.
  
  output:
    format: text

reduce:
  mode: deterministic
  options:
    aggregations:
      - field: summary
        operation: collect
```

```typescript
const result = await executePipeline({
    pipelineFile: './summarize.yaml',
    aiInvoker,
    workspaceRoot
});

for (const summary of result.output.summaries) {
    console.log(summary);
}
```

### Example 2: Code Review Pipeline

```yaml
# code-review.yaml
name: "PR Code Review"

input:
  type: inline
  items:
    - file: src/auth.ts
      diff: "{{git_diff}}"
      rule: security
    - file: src/api.ts
      diff: "{{git_diff}}"
      rule: performance

map:
  template: |
    Review this code change for {{rule}} issues:
    
    File: {{file}}
    Diff:
    ```
    {{diff}}
    ```
    
    Return JSON: { "issues": [{ "line": N, "severity": "...", "message": "..." }] }
  
  output:
    format: json

reduce:
  mode: deterministic
  options:
    aggregations:
      - field: issues
        operation: flatten
```

### Example 3: Dynamic Input from Code

```typescript
import { executePipeline, PipelineConfig } from '../yaml-pipeline';

// Build config programmatically
const config: PipelineConfig = {
    name: 'Dynamic Pipeline',
    input: {
        type: 'inline',
        items: files.map(f => ({
            filename: f.name,
            content: f.content
        }))
    },
    map: {
        template: 'Analyze {{filename}}: {{content}}',
        parallelLimit: 5,
        output: { format: 'json' }
    },
    reduce: {
        mode: 'deterministic'
    }
};

const result = await executePipeline({
    config,
    aiInvoker,
    workspaceRoot
});
```

### Example 4: With Progress Tracking

```typescript
import { executePipeline } from '../yaml-pipeline';

const result = await executePipeline({
    pipelineFile: './pipeline.yaml',
    aiInvoker,
    workspaceRoot,
    processTracker: {
        registerProcess: (desc) => processManager.register(desc),
        updateProcess: (id, status) => processManager.update(id, status),
        registerGroup: (desc) => processManager.registerGroup(desc),
        completeGroup: (id, summary) => processManager.completeGroup(id, summary)
    },
    onProgress: (progress) => {
        vscode.window.setStatusBarMessage(
            `Pipeline: ${progress.completedItems}/${progress.totalItems}`
        );
    }
});
```

## Types

### PipelineConfig

```typescript
interface PipelineConfig {
    /** Pipeline name */
    name: string;
    /** Description */
    description?: string;
    /** Input configuration */
    input: InputConfig;
    /** Map phase configuration */
    map: MapConfig;
    /** Reduce phase configuration */
    reduce: ReduceConfig;
}
```

### InputConfig

```typescript
interface InputConfig {
    /** Input type: 'csv', 'inline', 'glob' */
    type: 'csv' | 'inline' | 'glob';
    /** File path (for csv/glob) */
    file?: string;
    /** Inline items */
    items?: Record<string, unknown>[];
    /** CSV options */
    options?: CSVParseOptions;
}
```

### MapConfig

```typescript
interface MapConfig {
    /** Prompt template with {{variables}} */
    template: string;
    /** Optional system prompt */
    systemPrompt?: string;
    /** Max parallel executions */
    parallelLimit?: number;
    /** Timeout per item (ms) */
    timeout?: number;
    /** Retry on failure */
    retryOnFailure?: boolean;
    /** Number of retry attempts */
    retryAttempts?: number;
    /** Output configuration */
    output?: {
        format: 'json' | 'text' | 'markdown';
        schema?: object;
    };
    /** 
     * Number of items to process per AI call (default: 1).
     * When > 1, use {{ITEMS}} in prompt to access batch as JSON array.
     * AI must return array with one result per item.
     */
    batchSize?: number;
}
```

### ReduceConfig

```typescript
interface ReduceConfig {
    /** Output format type */
    type: 'list' | 'table' | 'json' | 'csv' | 'ai';
    
    // Required for type: 'ai'
    /** AI prompt template (required if type is 'ai') */
    prompt?: string;
    /** Expected output fields from AI (required if type is 'ai') */
    output?: string[];
    /** Model to use for AI reduce (optional) */
    model?: string;
}
```

**Deterministic Reduce Types:**
- `list` - Bullet-point list format
- `table` - Markdown table format
- `json` - JSON array format
- `csv` - CSV format

**AI Reduce Type:**
- `ai` - AI-powered synthesis with custom prompt
  - Requires `prompt` field with template variables
  - Requires `output` array of expected fields
  - Optional `model` to override default

**AI Reduce Template Variables:**
- `{{RESULTS}}` - All successful map outputs (JSON array)
- `{{COUNT}}` - Total number of results
- `{{SUCCESS_COUNT}}` - Number of successful items
- `{{FAILURE_COUNT}}` - Number of failed items
```

### PipelineExecutionResult

```typescript
interface PipelineExecutionResult<T> {
    /** Success status */
    success: boolean;
    /** Final output */
    output?: T;
    /** Execution statistics */
    stats: {
        totalItems: number;
        successfulItems: number;
        failedItems: number;
        totalTimeMs: number;
    };
    /** Error message */
    error?: string;
}
```

## UI Components

### Result Viewers

#### Enhanced Result Viewer (Current)

The primary result viewer providing detailed individual node inspection.

```typescript
import { PipelineResultViewerProvider } from '../yaml-pipeline/ui/result-viewer-provider';

const provider = new PipelineResultViewerProvider(context.extensionUri);

// Show results with detailed node view
await provider.showResults(
    executionResult.result,
    pipelineName,
    packageName
);
```

**Features:**
- Individual item nodes with input/output display
- Success/failure status per item
- Execution time tracking per item
- Interactive webview with filtering (all/success/failed)
- Export capabilities (JSON/CSV/Markdown)
- Raw AI response inspection for debugging

**When to use:**
- Default for all pipeline executions
- When users need to inspect individual items
- For debugging and quality assurance

#### Basic Result Viewer (Deprecated - Fallback Only)

Legacy viewer showing aggregated output only. Located in `pipeline-executor-service.ts`.

```typescript
import { showPipelineResults } from '../yaml-pipeline/ui/pipeline-executor-service';

// Only used as fallback if enhanced viewer fails
await showPipelineResults(result, pipelineName);
```

**Status:** ⚠️ Deprecated - kept as fallback only, no longer in active use.

**Reason:** Basic viewer lacks individual item inspection and detailed result breakdown. The enhanced viewer provides superior user experience with node-level details and interactive features.

### Pipeline Preview Editor

A custom editor (`CustomTextEditorProvider`) that provides a visual preview of pipeline YAML files with interactive Mermaid diagrams.

**Features:**
- Visual flowchart representation of pipeline structure (input → filter → map → reduce)
- CSV data preview showing sample rows and column headers
- AI input generation flow visualization
- Interactive Mermaid diagrams rendered in webview
- Syntax highlighting for YAML content
- Real-time preview updates as pipeline.yaml is edited

**Usage:**
- Right-click `pipeline.yaml` → "Open with Pipeline Preview"
- Or use command: `pipeline.preview`
- Shows visual representation of the pipeline execution flow

**Components:**
- `preview-provider.ts` - CustomTextEditorProvider implementation
- `preview-content.ts` - HTML generation with Mermaid integration
- `preview-mermaid.ts` - Mermaid flowchart diagram generation logic

**Mermaid Diagram Types:**
- Pipeline flow: Shows input → filter → map → reduce phases
- Data flow: Visualizes CSV columns → template variables → AI output
- Execution flow: Shows parallel processing and batch grouping

```typescript
import { registerPipelinePreview, PipelinePreviewEditorProvider } from '../yaml-pipeline';

// Register preview editor provider
registerPipelinePreview(context);

// Preview is automatically available for pipeline.yaml files
// Users can right-click → "Open with Pipeline Preview"
```

### PipelinesTreeDataProvider

Tree data provider for the Pipelines Viewer. **Extends `FilterableTreeDataProvider`** (as of 2026-01 refactoring) for built-in search, filtering, EventEmitter, refresh, dispose, and error handling capabilities.

```typescript
import { PipelineManager } from '../yaml-pipeline';

const manager = new PipelineManager(workspaceRoot);

// Discover all pipeline packages
const pipelines = await manager.getPipelines();
// Returns PipelineInfo[] with packageName, packagePath, resourceFiles, etc.

// Create new pipeline package
const filePath = await manager.createPipeline('my-new-pipeline');
// Creates: .vscode/pipelines/my-new-pipeline/
//          .vscode/pipelines/my-new-pipeline/pipeline.yaml
//          .vscode/pipelines/my-new-pipeline/input.csv

// Rename pipeline package
await manager.renamePipeline(oldFilePath, 'new-name');

// Delete pipeline package (entire directory)
await manager.deletePipeline(filePath);

// Resolve resource path relative to package
const csvPath = manager.resolveResourcePath('data/input.csv', packagePath);
```

### Pipeline Manager

Manages pipeline packages - discovery, CRUD operations, validation.

```typescript
import {
    PipelinesTreeDataProvider,
    PipelineItem,
    ResourceItem
} from '../yaml-pipeline';

// Tree data provider extends FilterableTreeDataProvider (refactored in 2026-01)
// Inherits from BaseTreeDataProvider → FilterableTreeDataProvider
// All common tree provider functionality built-in
const provider = new PipelinesTreeDataProvider(pipelineManager);

// Set filter (inherited from FilterableTreeDataProvider)
provider.setFilter('bug');  // Filter pipelines by name/description

// Clear filter (inherited)
provider.clearFilter();

// Get current filter (inherited)
const currentFilter = provider.getFilter();

// Refresh (inherited from BaseTreeDataProvider)
provider.refresh();
```

### Bundled Pipelines

The extension ships with several pre-configured pipelines that users can copy to their workspace for customization. Bundled pipelines are read-only and stored in the extension's resources folder.

**Registry:**
- Bundled pipelines are registered in `bundled/index.ts` via the `BUNDLED_PIPELINES` array
- Each bundled pipeline has a manifest with `id`, `name`, `description`, `category`, `directory`, and optional `resources`
- Examples: `code-review-checklist`, `bug-triage`, `doc-generator`, `multi-agent-research`

**Copy to Workspace:**
- Users can copy bundled pipelines to `.vscode/pipelines/` via the "Copy to Workspace" command
- Copied pipelines become editable workspace pipelines
- Original bundled pipelines remain read-only

**Read-only Provider:**
- `BundledPipelineContentProvider` provides read-only access to bundled pipeline files
- Uses `bundled-pipeline:` URI scheme
- Prevents accidental modification of bundled templates

```typescript
import {
    BUNDLED_PIPELINES,
    getBundledPipelineManifest,
    getBundledPipelineDirectory,
    isValidBundledPipelineId
} from '../yaml-pipeline';

// List all bundled pipelines
const allBundled = BUNDLED_PIPELINES;

// Get specific bundled pipeline manifest
const manifest = getBundledPipelineManifest('bug-triage');

// Check if bundled pipeline ID is valid
if (isValidBundledPipelineId('code-review-checklist')) {
    // Pipeline exists
}

// Get bundled pipeline directory path
const bundledPath = getBundledPipelineDirectory(context, 'bug-triage');
```

### Tree View Components

```typescript
// Tree data provider supports hierarchical display:
// - PipelineItem: Represents a pipeline package (collapsible)
// - ResourceItem: Represents resource files within a package

// Get root items (pipeline packages)
const packages = await provider.getChildren();

// Get resources for a package
const resources = await provider.getChildren(pipelineItem);
```

**Pipeline Categories:**

The tree view organizes pipelines into categories:

```
Pipelines Viewer
├── 📦 Bundled Pipelines (category)
│   ├── Code Review Checklist
│   ├── Bug Triage
│   ├── Documentation Generator
│   └── Multi-Agent Research System
└── 📁 Workspace Pipelines (category)
    ├── my-pipeline/ (package)
    │   ├── pipeline.yaml
    │   ├── input.csv
    │   └── data/
    │       └── test-cases.csv
    └── analyze-code/ (package)
        ├── pipeline.yaml
        └── rules.csv
```

- **Bundled Pipelines** category shows read-only templates shipped with the extension
- **Workspace Pipelines** category shows editable pipelines in `.vscode/pipelines/`
- Each package can be expanded to show its resource files
- Categories use `PipelineCategoryItem` tree items

### PipelineInfo Type

```typescript
interface PipelineInfo {
    /** Package name (directory name) */
    packageName: string;
    /** Absolute path to package directory */
    packagePath: string;
    /** Absolute path to pipeline.yaml */
    filePath: string;
    /** Pipeline name from YAML */
    name: string;
    /** Description from YAML */
    description?: string;
    /** Is pipeline valid */
    isValid: boolean;
    /** Validation errors if invalid */
    validationErrors?: string[];
    /** Resource files in package */
    resourceFiles?: ResourceFileInfo[];
}
```

## Best Practices

1. **Use package structure**: Organize pipelines as packages with `pipeline.yaml` entry point.

2. **Keep resources together**: Store CSV files and templates in the same package directory.

3. **Use relative paths**: Reference files relative to the package directory.

4. **Shared resources**: Place common files in a `shared/` directory and reference with `../shared/`.

5. **Validate templates**: Use `extractVariables` to ensure CSV has required columns.

6. **Set reasonable limits**: Use `parallel` to avoid API rate limits.

7. **Preview CSV data**: Use `getCSVPreview` before running pipeline.

8. **Test incrementally**: Start with small datasets.

## Migration from Flat Structure

If you have existing flat `.yaml` files in `.vscode/pipelines/`:

1. Create a directory for each pipeline (e.g., `my-pipeline/`)
2. Move the `.yaml` file into the directory and rename to `pipeline.yaml`
3. Update CSV paths to be relative to the new package directory
4. Move related CSV files into the package directory

**Before:**
```
.vscode/pipelines/
├── my-pipeline.yaml      # path: "../data/input.csv"
└── other-pipeline.yaml
```

**After:**
```
.vscode/pipelines/
├── my-pipeline/
│   ├── pipeline.yaml     # path: "input.csv"
│   └── input.csv
└── other-pipeline/
    ├── pipeline.yaml
    └── data.csv
```

## See Also

- `packages/pipeline-core/AGENTS.md` - Core pipeline engine documentation (pure Node.js)
- `packages/pipeline-core/src/pipeline/` - Core pipeline engine implementation
- `packages/pipeline-core/test/pipeline/` - Core tests (Vitest)
- `docs/designs/yaml-pipeline-framework.md` - Design documentation
- `docs/designs/pipeline-core-extraction.md` - Package extraction design
- `src/shortcuts/code-review/AGENTS.md` - Example pipeline usage
