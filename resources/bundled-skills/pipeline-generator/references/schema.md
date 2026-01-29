# Pipeline Configuration Schema Reference

Complete specification for pipeline YAML configuration.

## Root Configuration

```yaml
name: string                    # Required: Pipeline identifier
input: InputConfig              # Required: Data source
filter?: FilterConfig           # Optional: Pre-processing phase
map: MapConfig                  # Required: Processing phase
reduce: ReduceConfig            # Required: Aggregation phase
```

---

## Input Configuration

**Must have exactly ONE of:**

### Option 1: Inline Items
```yaml
input:
  items:
    - field1: value1
      field2: value2
    - field1: value3
      field2: value4
```

### Option 2: CSV Source
```yaml
input:
  from:
    type: csv
    path: "data/file.csv"       # Relative to pipeline directory
    delimiter: ","              # Optional, default: ","
```

### Option 3: Multi-Model Fanout
```yaml
input:
  from:
    - model: gpt-4
    - model: claude-sonnet-4
```

### Option 4: AI-Generated
```yaml
input:
  generate:
    prompt: string              # Generation instruction
    schema: string[]            # Field names (valid identifiers)
    model?: string              # Optional, defaults to system default
```

### Common Options (All Types)
```yaml
input:
  # ... (one of above)
  
  parameters?:                  # Optional: Shared values
    - name: string              # Parameter name
      value: any                # Parameter value (available as {{name}})
  
  limit?: number                # Optional: Max items to process (for testing)
```

---

## Map Configuration

```yaml
map:
  # Exactly ONE of:
  prompt: string                # Inline prompt with {{templates}}
  promptFile: string            # Path to .md file (relative/absolute/bare name)
  
  # Optional fields:
  skill?: string                # Prepend skill from .github/skills/{skill}/SKILL.md
  
  output?: string[]             # Field names for JSON parsing (omit for text mode)
  
  model?: string                # AI model (static or {{templateVar}})
  
  parallel?: number             # Concurrency (default: 5)
  
  timeoutMs?: number            # Timeout per item (default: 600000ms = 10 min)
  
  batchSize?: number            # Items per AI call (default: 1)
                                # Requires {{ITEMS}} in prompt if > 1
```

### Template Variables (Map Phase)
- `{{fieldName}}` - Item fields from input
- `{{ITEMS}}` - JSON array of all batch items (when batchSize > 1)
- `{{parameterName}}` - Values from input.parameters

---

## Reduce Configuration

```yaml
reduce:
  type: 'list' | 'table' | 'json' | 'csv' | 'text' | 'ai'
  
  # For type='ai' only:
  prompt?: string               # Inline (mutually exclusive with promptFile)
  promptFile?: string           # Path to .md file
  skill?: string                # Prepend skill guidance
  output?: string[]             # Fields for JSON parsing (omit for text mode)
  model?: string                # AI model (defaults to map model)
```

### Template Variables (Reduce Phase)
- `{{RESULTS}}` - JSON array of all successful map outputs
- `{{RESULTS_FILE}}` - Path to temp file containing results (large datasets)
- `{{COUNT}}` - Total items processed
- `{{SUCCESS_COUNT}}` - Successful items
- `{{FAILURE_COUNT}}` - Failed items
- `{{parameterName}}` - Values from input.parameters

---

## Filter Configuration (Optional)

### Rule-Based Filter
```yaml
filter:
  type: rule
  rule:
    mode: 'all' | 'any'         # AND / OR logic
    rules:
      - field: string           # Field name (supports nested: "user.role")
        operator: string        # See operators below
        value?: any             # Single value
        values?: any[]          # Multiple values (for in/not_in)
        pattern?: string        # Regex pattern (for matches)
```

### AI-Based Filter
```yaml
filter:
  type: ai
  ai:
    prompt: string              # Filter decision prompt
    output: ['include']         # MUST include 'include' boolean field
    parallel?: number           # Default: 5
    timeoutMs?: number          # Default: 30000 (30s)
    model?: string              # Optional model override
```

### Hybrid Filter (Rule + AI)
```yaml
filter:
  type: hybrid
  combineMode?: 'and' | 'or'    # Default: 'and'
  
  rule:
    # ... (same as rule-based filter)
  
  ai:
    # ... (same as ai-based filter)
```

**Combine Modes:**
- `and` (default): Item must pass BOTH rule AND AI filters
- `or`: Item passes if EITHER rule OR AI filter accepts it

### Filter Operators

| Operator | Value Type | Description |
|----------|------------|-------------|
| `equals` | single | Exact match |
| `not_equals` | single | Not equal |
| `in` | array (`values`) | Value in list |
| `not_in` | array (`values`) | Value not in list |
| `contains` | single | Case-insensitive substring |
| `not_contains` | single | Substring not present |
| `matches` | regex (`pattern`) | Regex pattern match |
| `greater_than` | number | Numeric > |
| `less_than` | number | Numeric < |
| `gte` | number | Numeric >= |
| `lte` | number | Numeric <= |

---

## Validation Rules

### Required Fields
- ✓ `name` must be non-empty string
- ✓ `input` must have exactly ONE of: items, from, generate
- ✓ `map` must exist
- ✓ `map` must have exactly ONE of: prompt, promptFile
- ✓ `reduce` must exist
- ✓ `reduce.type` must be valid type
- ✓ If `reduce.type='ai'`, must have prompt or promptFile

### Field Constraints
- `name`: any non-empty string
- `input.parameters[].name`: string
- `input.parameters[].value`: non-null
- `input.limit`: positive integer
- `map.output`: array of strings (valid identifiers)
- `map.parallel`: positive integer (recommended: 3-5)
- `map.timeoutMs`: positive integer (recommended: 300000-900000)
- `map.batchSize`: integer >= 1
- `reduce.output`: array of strings if provided
- `filter.rule.rules`: non-empty array
- `filter.ai.output`: must include 'include' field

### Template Variable Validation
- All `{{variable}}` in prompts must exist in items or parameters
- Special variables exempt: `ITEMS`, `RESULTS`, `RESULTS_FILE`, `COUNT`, `SUCCESS_COUNT`, `FAILURE_COUNT`
- Batch mode (`batchSize > 1`) requires `{{ITEMS}}` in prompt (warning if missing)

---

## Common Validation Errors

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `Pipeline config missing "name"` | No name field | Add name |
| `Pipeline config missing "input"` | No input config | Add input section |
| `Input must have one of "items", "from", or "generate"` | No input source | Choose one source type |
| `Input can only have one of "items", "from", or "generate"` | Multiple sources | Remove extra sources |
| `Items missing required fields: {{field1}}, {{field2}}` | Template vars not in data | Add fields to CSV/items |
| `Pipeline config must have either "map.prompt" or "map.promptFile"` | Both missing | Add one |
| `Pipeline config cannot have both "map.prompt" and "map.promptFile"` | Both specified | Remove one |
| `Unsupported reduce type: {{type}}` | Invalid type | Use list/table/json/csv/text/ai |
| `AI reduce must have either "prompt" or "promptFile"` | Missing for ai type | Add prompt or promptFile |
| `CSV file not found: {{path}}` | File doesn't exist | Create file or fix path |
| `Duplicate header: "{{name}}"` | CSV headers not unique | Remove duplicate column |
| `Schema field "{{field}}" must be a valid identifier` | Invalid field name | Use alphanumeric + underscore only |
| `Schema fields must be unique` | Duplicate in schema | Remove duplicate |
| `batchSize > 1 but prompt does not contain {{ITEMS}}` | Missing template | Add `{{ITEMS}}` to prompt |

---

## Anti-Patterns to Avoid

### ❌ Anti-Pattern 1: Multiple Input Sources
```yaml
input:
  items: [...]      # ERROR: Can't have multiple
  from: [...]
  generate: {...}
```
**Fix:** Choose exactly ONE input source.

---

### ❌ Anti-Pattern 2: Missing Template Variables
```yaml
map:
  prompt: "Analyze {{title}} and {{description}}"
input:
  items:
    - { id: '1', title: 'Bug' }  # Missing 'description'
```
**Fix:** Ensure all items have all template variables.

---

### ❌ Anti-Pattern 3: Batch Mode Without {{ITEMS}}
```yaml
map:
  prompt: "Analyze: {{singleField}}"  # No {{ITEMS}}
  batchSize: 10
```
**Fix:** Add `{{ITEMS}}` placeholder for batch processing.

---

### ❌ Anti-Pattern 4: Both Prompt and PromptFile
```yaml
map:
  prompt: "Inline"          # ERROR: Can't use both
  promptFile: "file.md"
```
**Fix:** Choose ONE - inline or file-based.

---

### ❌ Anti-Pattern 5: AI Reduce Without Prompt
```yaml
reduce:
  type: ai                  # ERROR: Missing prompt
  output: [summary]
```
**Fix:** Add `prompt` or `promptFile` when type='ai'.

---

### ❌ Anti-Pattern 6: Aggressive Timeout
```yaml
map:
  timeoutMs: 5000           # Too short
```
**Fix:** Use reasonable timeouts:
- 300000 (5 min) for classification
- 600000 (10 min) for analysis
- 900000 (15 min) for research

---

### ❌ Anti-Pattern 7: No Limit on Large Dataset
```yaml
input:
  from:
    type: csv
    path: "million-rows.csv"  # No limit
```
**Fix:** Add `limit: 100` for testing, remove for production.

---

### ❌ Anti-Pattern 8: Invalid Generate Schema
```yaml
input:
  generate:
    schema:
      - '123invalid'        # Must start with letter/underscore
      - 'valid_name'
      - 'valid_name'        # Duplicate
```
**Fix:** Schema fields must be valid identifiers, no duplicates.

---

## Best Practices

### ✅ Use Filters to Save Cost
```yaml
filter:
  type: rule
  rule:
    rules:
      - field: status
        operator: equals
        value: open
```
**Benefit:** Reduces map phase AI calls significantly.

---

### ✅ Add Testing Limits
```yaml
input:
  limit: 100  # Process only 100 items for testing
```
**Benefit:** Quick validation before full run.

---

### ✅ Use Batch Mode for Simple Tasks
```yaml
map:
  prompt: "Process these items: {{ITEMS}}\n\nReturn one result per item."
  batchSize: 50
```
**Benefit:** 20x fewer AI calls (1000 items → 20 calls).

---

### ✅ Upgrade Model for Reduce
```yaml
map:
  model: "claude-sonnet-4"    # Cheaper for parallel work
reduce:
  model: "claude-opus-4"      # Better for synthesis
```
**Benefit:** Cost-effective with better quality synthesis.

---

### ✅ Use Parameters for Reusability
```yaml
input:
  parameters:
    - name: focusArea
      value: "security, performance"
map:
  prompt: "Review code focusing on: {{focusArea}}"
```
**Benefit:** Same pipeline, different configurations.

---

## Quick Reference Table

| Task | Input | Map Parallel | Map Timeout | Reduce Type |
|------|-------|--------------|-------------|-------------|
| Bug classification | CSV | 5 | 300s | ai |
| Document extraction | CSV | 5 | 300s | json |
| Code analysis | Inline | 3 | 600s | ai |
| Research | Generate | 5 | 900s | ai |
| Multi-model comparison | Array | 3 | 300s | ai |
| Large batch (1000+) | CSV + filter | 5 | 300s | table |
