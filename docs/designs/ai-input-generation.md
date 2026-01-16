# AI Input Generation with Approval Flow

## Summary

Allow users to generate pipeline input items using AI based on a natural language prompt, with an interactive approval step integrated into the existing Pipeline Preview UI before execution.

## Goals

- Generate input items from a prompt + schema definition
- Integrate approval UI into the existing Pipeline Preview webview
- Keep configuration minimal (just `prompt` and `schema`)
- Ephemeral generation (no automatic saving)

## Non-Goals

- Persisting generated inputs automatically
- Augmenting existing CSV data with AI
- Complex parameter collection UI
- Generation history tracking

---

## YAML Schema

```yaml
name: "Test Case Generator"

input:
  generate:
    prompt: "Generate 10 test cases for user login validation including edge cases"
    schema:
      - testName
      - input
      - expected

map:
  prompt: |
    Run test: {{testName}}
    Input: {{input}}
    Expected: {{expected}}
  output:
    - actual
    - passed

reduce:
  type: table
```

### Generate Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Natural language description of items to generate. Include count in the prompt (e.g., "Generate 10...") |
| `schema` | string[] | Yes | Field names for each generated item |

---

## UI Integration

The approval flow is integrated into the existing Pipeline Preview webview (`preview-content.ts`).

### Pipeline Preview States

```
┌─────────────────────────────────────────────────────────────────────┐
│  STATE 1: Initial Preview (input.generate detected)                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Edit] [▶ Generate & Review] [Validate] [Refresh]                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Pipeline Flow (Mermaid)                   │    │
│  │       [GENERATE] ──▶ [INPUT] ──▶ [MAP] ──▶ [REDUCE]         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ INPUT Configuration ───────────────────────────────────────┐    │
│  │  Type: AI-GENERATED                                          │    │
│  │  Schema: testName, input, expected                           │    │
│  │                                                              │    │
│  │  Prompt:                                                     │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │ Generate 10 test cases for user login validation     │   │    │
│  │  │ including edge cases                                 │   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  │                                                              │    │
│  │  Status: Not generated yet                                   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────┐
│  STATE 2: Generating                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Edit] [⏳ Generating...] [Validate] [Refresh]                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Pipeline Flow (Mermaid)                   │    │
│  │       [GENERATE] ──▶ [INPUT] ──▶ [MAP] ──▶ [REDUCE]         │    │
│  │          ⏳                                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Generating Inputs ─────────────────────────────────────────┐    │
│  │                                                              │    │
│  │     Generating items from AI...                              │    │
│  │                                                              │    │
│  │     ████████████░░░░░░░░░░░░░░░░                             │    │
│  │                                                              │    │
│  │                                         [Cancel]             │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────┐
│  STATE 3: Review & Approve                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Edit] [🔄 Regenerate] [Validate] [Refresh]                        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Pipeline Flow (Mermaid)                   │    │
│  │       [GENERATE] ──▶ [INPUT] ──▶ [MAP] ──▶ [REDUCE]         │    │
│  │          ✓           10 items                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Review Generated Inputs ───────────────────────────────────┐    │
│  │                                                              │    │
│  │  [+ Add]  [Delete Selected]                                  │    │
│  │                                                              │    │
│  │  ┌───┬──────────────────┬─────────────────┬───────────────┐ │    │
│  │  │   │ testName         │ input           │ expected      │ │    │
│  │  ├───┼──────────────────┼─────────────────┼───────────────┤ │    │
│  │  │ ☑ │ Valid login      │ user@test.com   │ Success       │ │    │
│  │  │ ☑ │ Empty email      │                 │ Error         │ │    │
│  │  │ ☑ │ Invalid format   │ not-an-email    │ Error         │ │    │
│  │  │ ☑ │ SQL injection    │ '; DROP--       │ Error         │ │    │
│  │  │ ☐ │ Long email       │ aaa...@test.com │ Error         │ │    │
│  │  └───┴──────────────────┴─────────────────┴───────────────┘ │    │
│  │                                                              │    │
│  │  ☑ Select All (4/5 selected)                                 │    │
│  │                                                              │    │
│  │                         [Cancel]  [▶ Run Pipeline (4 items)] │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Toolbar Button Changes

When `input.generate` is detected, the toolbar changes:

| State | Execute Button | Behavior |
|-------|---------------|----------|
| Initial | `▶ Generate & Review` | Triggers AI generation |
| Generating | `⏳ Generating...` (disabled) | Shows progress |
| Review | `🔄 Regenerate` | Replaces all items with fresh generation |

The "Run Pipeline" action moves to the details panel after generation.

### Details Panel Behavior

The details panel (`#detailsContent`) shows different content based on state:

1. **Initial**: Shows generate config (prompt, schema)
2. **Generating**: Shows progress indicator
3. **Review**: Shows editable table with generated items

### Editable Table Interactions

| Action | Behavior |
|--------|----------|
| Click cell | Inline edit (input becomes editable) |
| Checkbox | Include/exclude row from execution |
| + Add | Add empty row at bottom |
| Delete Selected | Remove checked rows |
| Select All | Toggle all checkboxes |
| Run Pipeline | Execute with selected items only |
| Cancel | Discard generated items, return to initial state |

---

## User Journey

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ Open Pipeline  │────▶│ Click Generate │────▶│ Review & Edit  │────▶│ Run Pipeline   │
│ Preview        │     │ & Review       │     │ in Table       │     │                │
└────────────────┘     └────────────────┘     └────────────────┘     └────────────────┘
       │                      │                      │                      │
       ▼                      ▼                      ▼                      ▼
  Shows generate         AI generates          User edits cells,      Executes with
  config in details      items, displays       adds/removes rows,     selected items
  panel                  in editable table     toggles selection
```

---

## Execution Flow

```
┌──────────────────┐
│ User clicks      │
│ "Generate &      │
│ Review"          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Build AI prompt  │
│ from config      │
│ prompt + schema  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Show loading     │
│ state in         │
│ details panel    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ AI generates     │
│ items as JSON    │
│ array            │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Render editable  │◀─────[Regenerate]
│ table in         │
│ details panel    │
└────────┬─────────┘
         │
         ▼ [Run Pipeline]
┌──────────────────┐
│ Filter to        │
│ selected items   │
│ only             │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Execute pipeline │
│ (existing flow)  │
└──────────────────┘
```

---

## AI Prompt Construction

The system constructs a prompt for the AI to generate items:

```
{user's prompt}

Return a JSON array where each object has these fields: {schema fields}

Example format:
[
  { "field1": "value1", "field2": "value2" },
  ...
]
```

**Example constructed prompt:**

```
Generate 10 test cases for user login validation including edge cases

Return a JSON array where each object has these fields: testName, input, expected

Example format:
[
  { "testName": "...", "input": "...", "expected": "..." },
  ...
]
```

---

## Types

```typescript
/**
 * Configuration for AI-generated inputs
 */
interface GenerateInputConfig {
  /** Natural language prompt describing items to generate */
  prompt: string;
  /** Field names for each generated item */
  schema: string[];
}

/**
 * Extended InputConfig with generate option
 */
interface InputConfig {
  /** Direct list of items (inline) */
  items?: PromptItem[];
  /** Load items from source (CSV or inline array) */
  from?: CSVSource | PromptItem[];
  /** Generate items using AI */
  generate?: GenerateInputConfig;
  /** Limit number of items to process */
  limit?: number;
  /** Static parameters available to all items */
  parameters?: PipelineParameter[];
}

/**
 * State for the preview webview when using generate
 */
type GenerateState =
  | { status: 'initial' }
  | { status: 'generating' }
  | { status: 'review'; items: GeneratedItem[] }
  | { status: 'error'; message: string };

/**
 * A generated item with selection state
 */
interface GeneratedItem {
  data: PromptItem;
  selected: boolean;
}
```

**Validation rules:**
- Must have exactly one of: `items`, `from`, or `generate`
- If `generate` is present, both `prompt` and `schema` are required
- `schema` must be a non-empty array of strings

---

## Implementation

### Files to Modify

```
src/shortcuts/yaml-pipeline/
├── types.ts                      # Add GenerateInputConfig
├── executor.ts                   # Handle generate config before execution
└── ui/
    ├── preview-provider.ts       # Handle generate state, AI calls
    ├── preview-content.ts        # Add generate UI states, editable table
    └── preview-mermaid.ts        # Add GENERATE node to diagram
```

### New Files

```
src/shortcuts/yaml-pipeline/
├── input-generator.ts            # AI prompt construction, response parsing
```

### Key Changes to preview-content.ts

1. **New toolbar button**: `Generate & Review` / `Regenerate`
2. **New details content function**: `getGenerateDetails()` for initial state
3. **New details content function**: `getGeneratingState()` for loading
4. **New details content function**: `getReviewTable()` for editable table
5. **New message types**: `generate`, `regenerate`, `updateCell`, `toggleRow`, `runWithItems`

### Webview Messages

```typescript
// Messages from webview to extension
type PreviewMessage =
  | { type: 'nodeClick'; payload: { nodeId: string } }
  | { type: 'execute' }
  | { type: 'validate' }
  | { type: 'edit' }
  | { type: 'refresh' }
  | { type: 'openFile'; payload: { filePath: string } }
  | { type: 'ready' }
  // New messages for generate flow
  | { type: 'generate' }
  | { type: 'regenerate' }
  | { type: 'cancelGenerate' }
  | { type: 'addRow' }
  | { type: 'deleteRows'; payload: { indices: number[] } }
  | { type: 'updateCell'; payload: { index: number; field: string; value: string } }
  | { type: 'toggleRow'; payload: { index: number; selected: boolean } }
  | { type: 'toggleAll'; payload: { selected: boolean } }
  | { type: 'runWithItems'; payload: { items: PromptItem[] } };

// Messages from extension to webview
type PreviewUpdate =
  | { type: 'setGenerateState'; payload: GenerateState };
```

### Mermaid Diagram Update

When `input.generate` is present, show GENERATE node:

```
graph LR
    GENERATE[🤖 GENERATE] --> INPUT[📥 INPUT]
    INPUT --> MAP[🔄 MAP]
    MAP --> REDUCE[📤 REDUCE]
```

---

## Examples

### Basic Test Generation

```yaml
name: "API Test Cases"

input:
  generate:
    prompt: "Generate 15 test cases for a REST API user endpoint covering CRUD operations and error scenarios"
    schema:
      - method
      - endpoint
      - requestBody
      - expectedStatus
      - description

map:
  prompt: |
    Test: {{description}}
    Method: {{method}}
    Endpoint: {{endpoint}}
    Body: {{requestBody}}

    Execute this API test and verify the response.
  output:
    - actualStatus
    - responseBody
    - passed

reduce:
  type: table
```

### Data Analysis

```yaml
name: "Competitor Analysis"

input:
  generate:
    prompt: "List 8 major competitors in the cloud infrastructure market"
    schema:
      - company
      - primaryProduct
      - marketSegment

map:
  prompt: |
    Analyze {{company}} and their {{primaryProduct}} offering.
    Market segment: {{marketSegment}}

    Provide strengths, weaknesses, and market position.
  output:
    - strengths
    - weaknesses
    - marketShare
    - threat_level

reduce:
  type: json
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| AI returns malformed JSON | Show error state with message, allow "Regenerate" |
| AI returns fewer items than expected | Show what was generated, user can add more manually |
| AI returns extra fields | Ignore extra fields, keep only schema fields |
| AI returns missing fields | Set missing fields to empty string |
| User unchecks all items | Disable "Run Pipeline" button |
| User cancels during generation | Abort AI call, return to initial state |
| User clicks away from details panel | Preserve generated items state |
| User clicks Refresh | Preserve generated items state (only refresh YAML config) |

---

## Future Considerations

- **Prompt templates**: Allow `{{variable}}` in generate prompt with parameter input
- **Schema hints**: Add optional `description` per field to guide AI
- **Partial regeneration**: Regenerate only selected rows
- **Import/Export**: Import from CSV to merge, export approved items
