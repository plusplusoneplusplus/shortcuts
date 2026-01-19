# YAML Pipeline Module - Developer Reference

This module provides a YAML-based configuration layer on top of the map-reduce framework. It enables easy configuration of AI MapReduce workflows via YAML files.

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

### PipelinesTreeDataProvider

Tree data provider for the Pipelines Viewer. Extends `FilterableTreeDataProvider` for built-in search and filtering capabilities.

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

// Tree data provider extends FilterableTreeDataProvider
// Provides built-in filter management, EventEmitter, and error handling
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

- `src/shortcuts/map-reduce/AGENTS.md` - Underlying map-reduce framework
- `docs/designs/yaml-pipeline-framework.md` - Design documentation
- `src/shortcuts/code-review/AGENTS.md` - Example pipeline usage
