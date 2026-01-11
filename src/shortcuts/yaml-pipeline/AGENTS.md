# YAML Pipeline Module - Developer Reference

This module provides a YAML-based configuration layer on top of the map-reduce framework. It enables easy configuration of AI MapReduce workflows via YAML files.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    YAML Pipeline File                           │
│  (pipeline.yaml - Human-readable configuration)                 │
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
│  │  - Resolves file paths                                      ││
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

// Execute pipeline from YAML file
const result = await executePipeline({
    pipelineFile: './pipeline.yaml',
    aiInvoker: copilotInvoker,
    workspaceRoot: '/path/to/workspace',
    onProgress: (progress) => {
        console.log(`${progress.phase}: ${progress.percentage}%`);
    }
});

if (result.success) {
    console.log('Output:', result.output);
    console.log('Stats:', result.stats);
}

// Or parse and execute separately
const config = await parsePipelineYAML('./pipeline.yaml', workspaceRoot);
const result = await executePipeline({
    config,
    aiInvoker,
    workspaceRoot
});
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
# pipeline.yaml
name: "Code Analysis Pipeline"
description: "Analyze code files for issues"

input:
  type: csv
  file: ./data.csv
  options:
    delimiter: ","
    hasHeader: true

map:
  template: |
    Analyze this code:
    File: {{filename}}
    Content: {{content}}
    
    Focus on: {{focus_areas}}
  
  systemPrompt: "You are an expert code reviewer."
  
  parallelLimit: 5
  
  output:
    format: json
    schema:
      type: object
      properties:
        issues: { type: array }
        score: { type: number }

reduce:
  mode: deterministic
  options:
    deduplicateBy: file
    sortBy: severity
```

### Advanced Configuration

```yaml
name: "Multi-stage Review Pipeline"

input:
  type: csv
  file: ./rules.csv

map:
  template: |
    Review {{code_file}} against rule: {{rule_name}}
    
    Rule description: {{rule_description}}
    
    Respond with JSON: { "violations": [...], "passed": boolean }
  
  systemPrompt: |
    You are a code compliance checker.
    Be thorough but avoid false positives.
  
  parallelLimit: 3
  timeout: 60000
  retryOnFailure: true
  retryAttempts: 2
  
  output:
    format: json

reduce:
  mode: hybrid
  deterministicOptions:
    deduplicateBy: violation_id
    sortBy: severity
    aggregations:
      - field: violations
        operation: flatten
  aiOptions:
    enabled: true
    template: |
      Summarize these findings:
      {{results}}
      
      Provide:
      1. Executive summary
      2. Top 5 critical issues
      3. Recommendations
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
    /** Reduce mode */
    mode: 'deterministic' | 'ai' | 'hybrid' | 'none';
    /** Deterministic options */
    deterministicOptions?: {
        deduplicateBy?: string;
        sortBy?: string;
        aggregations?: Array<{
            field: string;
            operation: 'flatten' | 'sum' | 'count' | 'collect';
        }>;
    };
    /** AI reduce options */
    aiOptions?: {
        enabled: boolean;
        template?: string;
    };
}
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

## Best Practices

1. **Validate templates**: Use `extractVariables` to ensure CSV has required columns.

2. **Set reasonable limits**: Use `parallelLimit` to avoid API rate limits.

3. **Handle failures**: Enable `retryOnFailure` for resilience.

4. **Use appropriate reduce**: 
   - `deterministic` for aggregation
   - `ai` for synthesis
   - `hybrid` for both

5. **Preview CSV data**: Use `getCSVPreview` before running pipeline.

6. **Test incrementally**: Start with small datasets.

## See Also

- `src/shortcuts/map-reduce/AGENTS.md` - Underlying map-reduce framework
- `docs/designs/yaml-pipeline-framework.md` - Design documentation
- `src/shortcuts/code-review/AGENTS.md` - Example pipeline usage
