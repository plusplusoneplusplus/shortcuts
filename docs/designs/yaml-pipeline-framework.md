# YAML Pipeline Framework Design (MVP)

## Summary

A simple YAML-based configuration for running AI MapReduce workflows. Start with CSV input, a prompt template for map, and list output.

## Goals

- Define a workflow in a single YAML file
- CSV file as input (each row becomes an item)
- Simple prompt template with `{{column}}` variable substitution
- Schema-light output definition (just field names)
- Deterministic list/table output

## Non-Goals (for now)

- Git integration, file globs, shell commands
- AI-powered reduce phase
- Complex reduce operations (group-by, stats, etc.)
- Caching, retries, streaming
- Multiple output destinations

---

## YAML Schema

```yaml
name: "Pipeline Name"

input:
  type: csv
  path: "./data.csv"

map:
  prompt: |
    Analyze this item:
    Title: {{title}}
    Description: {{description}}
  
  output: [severity, category, summary]

reduce:
  type: list
```

---

## Input: CSV

Read a CSV file. First row is headers. Each row becomes an item.

```yaml
input:
  type: csv
  path: "./bugs.csv"          # Required: path to CSV file
  delimiter: ","               # Optional: default ","
```

**Example CSV:**
```csv
id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
```

**Produces items:**
```json
{ "id": "1", "title": "Login broken", "description": "Users can't login", "priority": "high" }
{ "id": "2", "title": "Slow search", "description": "Search takes 10s", "priority": "medium" }
```

---

## Map: Prompt Template

Run a prompt for each item. Use `{{column_name}}` to insert values.

```yaml
map:
  prompt: |
    Analyze this bug report:
    
    ID: {{id}}
    Title: {{title}}
    Description: {{description}}
    Priority: {{priority}}
    
    Classify this bug and provide your assessment.
  
  output: [severity, category, effort_hours, needs_more_info]
  
  parallel: 3                  # Optional: max concurrent calls (default: 5)
```

**How it works:**

1. The `prompt` is sent to AI with each row's values substituted
2. The `output` field names are appended to the prompt automatically:
   > "Return JSON with these fields: severity, category, effort_hours, needs_more_info"
3. The AI response is parsed as JSON and stored as `output` for each item
4. If AI returns extra fields, they are ignored. If fields are missing, they become `null`.

---

## Reduce: List Output

Show all results as a formatted list (no AI call, deterministic).

```yaml
reduce:
  type: list
```

**Output:**
```
## Results (3 items)

### Item 1
**Input:** id=1, title=Login broken, priority=high
**Output:** severity=critical, category=backend, effort_hours=4, needs_more_info=false

### Item 2
**Input:** id=2, title=Slow search, priority=medium
**Output:** severity=medium, category=database, effort_hours=8, needs_more_info=false

...
```

The list shows both input (CSV row) and output (AI response) for each item.

---

## Complete Example

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
    
    Classify the severity (critical/high/medium/low), 
    category (ui/backend/database/infra),
    estimate effort in hours,
    and note if more info is needed.
  
  output: [severity, category, effort_hours, needs_more_info]
  
  parallel: 3

reduce:
  type: list
```

---

## Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Read CSV   │ ──▶ │  Map: AI    │ ──▶ │   Reduce    │ ──▶ │   Output    │
│  (N rows)   │     │  (N calls)  │     │  (1 call or │     │  (panel)    │
│             │     │             │     │   format)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

1. **Read CSV** - Parse file, create N items
2. **Map** - For each item, run prompt with substituted values (parallel with limit)
3. **Reduce** - Either AI summarize, or format as list/table
4. **Output** - Show in AI Processes panel

---

## Implementation

### Files

```
src/shortcuts/yaml-pipeline/
├── types.ts              # PipelineConfig interface
├── csv-reader.ts         # Parse CSV to items
├── template.ts           # Simple {{var}} substitution
├── executor.ts           # Run the pipeline
└── commands.ts           # VSCode command registration
```

### Key Types

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
    output: string[];      // Field names expected from AI
    parallel?: number;
  };
  reduce: {
    type: 'list';
  };
}

interface PipelineItem {
  [key: string]: string;  // CSV columns
}

interface MapResult {
  item: PipelineItem;
  output: Record<string, unknown>;  // AI response with declared fields
}
```

### Template Engine

Simple implementation - just replace `{{var}}` with values:

```typescript
function substituteTemplate(template: string, item: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => item[key] ?? '');
}
```

### Prompt Generation

Append output schema to the user's prompt:

```typescript
function buildFullPrompt(userPrompt: string, outputFields: string[]): string {
  const fieldsStr = outputFields.join(', ');
  return `${userPrompt}

Return JSON with these fields: ${fieldsStr}`;
}
```

---

## VSCode Integration

### Command

```typescript
vscode.commands.registerCommand('shortcuts.runPipeline', async (uri: vscode.Uri) => {
  const yamlContent = await vscode.workspace.fs.readFile(uri);
  const config = yaml.parse(yamlContent.toString());
  
  await executePipeline(config);
});
```

### Context Menu

Add to `package.json`:
```json
{
  "menus": {
    "explorer/context": [
      {
        "command": "shortcuts.runPipeline",
        "when": "resourceExtname == .yaml || resourceExtname == .yml",
        "group": "shortcuts"
      }
    ]
  }
}
```

### Output

Results appear in the existing AI Processes panel as a grouped process.

---

## Future Extensions

Once MVP works, consider adding:

1. **More input types**: git commits, file glob, shell command output
2. **AI reduce**: Summarize results with another AI call
3. **Table reduce**: Format output as markdown table
4. **More reduce operations**: group-by, filter, sort
5. **Output options**: file, clipboard, notification
6. **Settings**: model selection, temperature, retries

---

## Open Questions

1. **Error handling**: Skip failed items or abort entire pipeline?
2. **Large CSVs**: Stream or load all at once? Limit rows?
3. **JSON parse failures**: Retry with correction prompt, or skip item?
