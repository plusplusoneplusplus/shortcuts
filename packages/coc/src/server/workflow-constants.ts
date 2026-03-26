/**
 * Workflow constants, templates, and schema reference.
 *
 * Extracted from workflows-handler.ts to keep each module focused.
 */

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_WORKFLOWS_FOLDER = '.vscode/workflows';

// ============================================================================
// Workflow Templates
// ============================================================================

export const TEMPLATES: Record<string, string> = {
    custom: `name: "My Workflow"
description: "A custom workflow"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Analyze: {{title}}
    Return JSON with your analysis.
  output:
    - result
  parallel: 5

reduce:
  type: json
`,
    'data-fanout': `name: "Data Fanout Workflow"
description: "Process data items in parallel"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Process this item:
    Title: {{title}}
    Description: {{description}}

    Return JSON with category and summary.
  output:
    - category
    - summary
  parallel: 10

reduce:
  type: table
`,
    'model-fanout': `name: "Model Fanout Workflow"
description: "Run the same prompt across multiple models"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Analyze: {{title}}
    Provide a detailed assessment.
  output:
    - assessment
    - confidence
  parallel: 3

reduce:
  type: json
`,
    'ai-generated': `name: "AI Generated Workflow"
description: "Template for AI-generated workflows"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    {{title}}
    {{description}}

    Analyze and return structured JSON.
  output:
    - analysis
  parallel: 5

reduce:
  type: json
`,
};

// ============================================================================
// Workflow Schema Reference (embedded for AI prompt construction)
// ============================================================================

export const WORKFLOW_SCHEMA_REFERENCE = `# Workflow YAML Schema Reference

## Two Workflow Modes (mutually exclusive)

### Map-Reduce Mode (batch processing)
\`\`\`yaml
name: string                    # Required: Workflow identifier
input: InputConfig              # Required: Data source
map: MapConfig                  # Required: Processing phase
reduce: ReduceConfig            # Required: Aggregation phase
parameters?: WorkflowParameter[] # Optional: Top-level parameters
\`\`\`

### Single-Job Mode (one-shot AI call)
\`\`\`yaml
name: string                    # Required: Workflow identifier
job: JobConfig                  # Required: Single AI job definition
parameters?: WorkflowParameter[] # Optional: Template variable values
\`\`\`

Constraint: job and map are mutually exclusive.

## Input Configuration (exactly ONE of)
- items: inline array of objects
- from: { type: csv, path: "file.csv" } OR array of { model: "model-name" }
- generate: { prompt: string, schema: string[] }

Common options: parameters (shared values), limit (max items)

## Map Configuration
- prompt: string (or promptFile: string) — exactly one required
- output?: string[] — field names for JSON parsing (omit for text mode)
- model?: string — AI model override
- parallel?: number — concurrency (default: 5)
- timeoutMs?: number — timeout per item (default: 600000ms)
- batchSize?: number — items per AI call (default: 1; requires {{ITEMS}} if > 1)

Template variables: {{fieldName}} from input items, {{ITEMS}} for batch, {{paramName}} from parameters

## Reduce Configuration
- type: 'list' | 'table' | 'json' | 'csv' | 'text' | 'ai'
- For type='ai': prompt or promptFile required, optional output, model
- Template variables: {{RESULTS}}, {{COUNT}}, {{SUCCESS_COUNT}}, {{FAILURE_COUNT}}

## Job Configuration
- prompt: string (or promptFile: string) — exactly one required
- output?: string[] — field names for JSON parsing (omit for text mode)
- model?: string — AI model override
- Template variables: {{paramName}} from top-level parameters

## Filter Configuration (optional, pre-processing)
- type: 'rule' — rule-based with mode ('all'|'any') and rules array
- type: 'ai' — AI-based with prompt, output must include 'include' field
- type: 'hybrid' — combines rule + ai with combineMode ('and'|'or')

## Parameters
\`\`\`yaml
parameters:
  - name: string
    value: string
\`\`\`
Available as {{name}} in prompts. CLI override: --param name=value

## Key Rules
- name is always required
- job and map cannot coexist
- input must have exactly ONE source type
- map/job must have exactly ONE of prompt or promptFile
- AI reduce requires a prompt
- batchSize > 1 requires {{ITEMS}} in prompt
- Use parallel: 3-5 for most tasks
- Use reasonable timeouts (300s-900s depending on complexity)
`;

// ============================================================================
// AI Response Helpers
// ============================================================================

/**
 * Extract YAML content from an AI response that may contain markdown fences.
 */
export function extractYamlFromResponse(response: string): string {
    // 1. Try to extract from ```yaml ... ``` code blocks
    const yamlBlockMatch = response.match(/```(?:yaml|yml)\s*\n([\s\S]*?)```/);
    if (yamlBlockMatch) {
        return yamlBlockMatch[1].trim();
    }
    // 2. Try to extract from generic ``` ... ``` code blocks
    const genericBlockMatch = response.match(/```\s*\n([\s\S]*?)```/);
    if (genericBlockMatch) {
        return genericBlockMatch[1].trim();
    }
    // 3. Assume the entire response is YAML (strip leading/trailing whitespace)
    return response.trim();
}

export const GENERATION_TIMEOUT_MS = 120_000; // 2 min — pure text generation, no tool use
