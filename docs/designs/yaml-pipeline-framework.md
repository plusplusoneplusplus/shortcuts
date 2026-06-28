# YAML Pipeline Framework Design

## Summary

The YAML pipeline framework lets users define AI workflows in a single YAML file and run them through CoC. The MVP centers on CSV input, a prompt template for each row, and deterministic list output. The same configuration compiles into the shared workflow engine used by the CoC CLI, server queue, dashboard, and package consumers.

## Goals

- Define a workflow in one YAML file.
- Read CSV input where each row becomes an item.
- Substitute `{{column}}` values into a prompt template.
- Ask AI to return a small JSON object with declared fields.
- Produce deterministic list or table output.
- Run from `coc run`, the CoC dashboard Workflows tab, or direct package APIs.

## Non-Goals

- Git input, file globs, shell commands, or HTTP sources.
- AI-powered reduce.
- Complex reduce operations such as grouping and statistics.
- Caching, retries, or streaming.
- Multiple output destinations.

## YAML Schema

```yaml
name: "Bug Triage"

input:
  type: csv
  path: "./bugs.csv"

map:
  prompt: |
    Analyze this bug:

    Title: {{title}}
    Description: {{description}}
    Reporter Priority: {{priority}}

    Classify the severity, category, effort, and whether more info is needed.
  output: [severity, category, effort_hours, needs_more_info]
  parallel: 3

reduce:
  type: list
```

Pipeline files can live anywhere a user can pass to `coc run`. Repository-scoped workflow examples often use `.vscode/workflows/` or `.vscode/pipelines/` as configuration directories.

## Input: CSV

The CSV reader treats the first row as headers and turns each following row into a string-valued item.

```yaml
input:
  type: csv
  path: "./bugs.csv"
  delimiter: ","
```

Example CSV:

```csv
id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
```

Produced items:

```json
{ "id": "1", "title": "Login broken", "description": "Users can't login", "priority": "high" }
{ "id": "2", "title": "Slow search", "description": "Search takes 10s", "priority": "medium" }
```

## Map Phase

For each item, the engine substitutes item fields into the prompt and invokes AI with a concurrency limit.

```yaml
map:
  prompt: |
    Analyze this bug report:
    ID: {{id}}
    Title: {{title}}
    Description: {{description}}
    Priority: {{priority}}
  output: [severity, category, effort_hours, needs_more_info]
  parallel: 3
```

Execution rules:

1. `{{field}}` placeholders are replaced with matching item values.
2. The declared output fields are added to the AI instruction.
3. The AI response is parsed as JSON.
4. Missing declared fields become `null`.
5. Extra response fields are ignored.

## Reduce Phase

The MVP reduce phase is deterministic and formats mapped outputs without another AI call.

```yaml
reduce:
  type: list
```

Example output:

```text
## Results (2 items)

### Item 1
Input: id=1, title=Login broken, priority=high
Output: severity=critical, category=backend, effort_hours=4, needs_more_info=false

### Item 2
Input: id=2, title=Slow search, priority=medium
Output: severity=medium, category=database, effort_hours=8, needs_more_info=false
```

## Execution Flow

```text
Read CSV -> Map with AI -> Reduce deterministically -> Store and display result
```

1. Parse the YAML file.
2. Resolve relative paths against the workflow directory.
3. Load CSV rows.
4. Run the map prompt over each item with a concurrency limit.
5. Parse AI JSON responses into declared output fields.
6. Format the final result.
7. Return output to the CLI, dashboard task/process view, or package caller.

## Package Boundaries

```text
packages/coc-workflow/src/workflow/
  compiler.ts          # YAML to WorkflowConfig
  executor.ts          # DAG execution lifecycle
  nodes/               # load/map/ai/reduce/filter/script/merge/transform executors
  pipeline-compat.ts   # Legacy pipeline YAML compatibility
  types.ts             # Public workflow contracts

packages/coc/src/
  commands/run.ts      # coc run
  commands/validate.ts # YAML validation
  server/executors/    # Queue-backed workflow execution
  server/spa/client/   # Dashboard workflow surfaces
```

`@plusplusoneplusplus/coc-workflow` owns the pure compile and execute path. `@plusplusoneplusplus/forge` keeps compatibility exports and utility surfaces. CoC owns CLI/server/dashboard integration.

## Key Types

```typescript
interface PipelineConfig {
  name: string;
  input: {
    type: 'csv';
    path: string;
    delimiter?: string;
  };
  map: {
    prompt: string;
    output: string[];
    parallel?: number;
  };
  reduce: {
    type: 'list';
  };
}

interface PipelineItem {
  [key: string]: string;
}

interface MapResult {
  item: PipelineItem;
  output: Record<string, unknown>;
}
```

## Template Substitution

```typescript
function substituteTemplate(template: string, item: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => item[key] ?? '');
}
```

## Prompt Generation

```typescript
function buildFullPrompt(userPrompt: string, outputFields: string[]): string {
  return `${userPrompt}

Return JSON with these fields: ${outputFields.join(', ')}`;
}
```

## Execution Surfaces

CLI:

```bash
coc run path/to/pipeline.yaml
```

Validation:

```bash
coc validate path/to/pipeline.yaml
```

Package API:

```typescript
import { compileToWorkflow, executeWorkflow } from '@plusplusoneplusplus/coc-workflow';

const config = compileToWorkflow(yamlContent);
const result = await executeWorkflow(config, { aiInvoker });
```

Dashboard:

- Workflows tab for saved workspace workflows.
- Process/task detail for progress, output, comments, and follow-up AI work.

## Error Handling

| Error | Behavior |
|-------|----------|
| YAML parse failure | Return validation error with line context when available. |
| Missing CSV file | Fail before starting map execution. |
| Missing CSV column | Substitute an empty string. |
| AI JSON parse failure | Mark the item failed and apply the configured workflow error policy. |
| Map item failure | Abort or warn according to workflow settings. |

## Future Extensions

1. More input types: file glob, git commits, shell command output, HTTP.
2. AI reduce: summarize or synthesize mapped outputs.
3. Table reduce and JSON reduce.
4. Filtering, grouping, and sorting.
5. Output destinations: file, notes, clipboard, work item, or webhook.
6. Runtime settings: model selection, timeouts, retries, and cancellation.

## Open Questions

1. Should large CSVs stream by default or load all rows first?
2. Should invalid AI JSON retry with a correction prompt?
3. Should item-level failures be resumable from a persisted checkpoint?
