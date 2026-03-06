---
status: pending
---

# 001: JSON Schema for pipeline.yaml

## Summary
Create `resources/pipeline.schema.json` that fully models `PipelineConfig` from `pipeline-core`, and register it in `package.json` via `contributes.yamlValidation`. This gives users IDE autocomplete, hover docs, and validation when editing `pipeline.yaml` files with the Red Hat YAML extension installed.

## Motivation
This is a pure configuration change — one new JSON file and two lines in `package.json` — with no TypeScript, no runtime behavior change, and no tests required. Keeping it isolated makes it independently reviewable, deployable, and revertable without touching any logic commits.

## Changes

### Files to Create
- `resources/pipeline.schema.json` — JSON Schema (draft-07) modeling the full `PipelineConfig` hierarchy derived from `packages/pipeline-core/src/pipeline/types.ts`. Includes `$defs` for all sub-types, `oneOf` constraints, and `description` annotations for hover docs.

### Files to Modify
- `package.json` — Add `contributes.yamlValidation` array entry associating `**/pipeline.yaml` and `**/pipeline.yml` glob patterns with `./resources/pipeline.schema.json`. Add `redhat.vscode-yaml` to a new `extensionSuggestions` array (preferred over `extensionDependencies` since YAML validation is a convenience, not a hard requirement).

### Files to Delete
_None_

## Implementation Notes

### Schema Structure
Use JSON Schema draft-07 (`"$schema": "http://json-schema.org/draft-07/schema#"`). All reusable types go in `$defs`; `PipelineConfig` is the root object.

**Abbreviated representative structure:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Pipeline Configuration",
  "description": "YAML pipeline definition for the CoC AI pipeline runner.",
  "type": "object",
  "required": ["name"],
  "additionalProperties": false,
  "properties": {
    "name": { "type": "string", "description": "Human-readable pipeline name." },
    "workingDirectory": { "type": "string", "description": "Working dir for AI SDK sessions. Absolute or relative to the pipeline directory." },
    "input": { "$ref": "#/$defs/InputConfig" },
    "filter": { "$ref": "#/$defs/FilterConfig" },
    "map": { "$ref": "#/$defs/MapConfig" },
    "reduce": { "$ref": "#/$defs/ReduceConfig" },
    "job": { "$ref": "#/$defs/JobConfig" },
    "parameters": { "type": "array", "items": { "$ref": "#/$defs/PipelineParameter" } }
  },
  "$defs": {
    "PipelineParameter": {
      "type": "object",
      "required": ["name", "value"],
      "additionalProperties": false,
      "properties": {
        "name":  { "type": "string", "description": "Parameter name, referenced as {{name}} in prompt templates." },
        "value": { "type": "string", "description": "Parameter value." }
      }
    },
    "CSVSource": {
      "type": "object",
      "required": ["type", "path"],
      "additionalProperties": false,
      "properties": {
        "type":      { "type": "string", "const": "csv" },
        "path":      { "type": "string", "description": "Path to CSV file, relative to pipeline directory or absolute." },
        "delimiter": { "type": "string", "default": ",", "description": "CSV delimiter character." }
      }
    },
    "GenerateInputConfig": {
      "type": "object",
      "required": ["prompt", "schema"],
      "additionalProperties": false,
      "properties": {
        "prompt": { "type": "string", "description": "Natural language prompt describing items to generate. Include count (e.g., 'Generate 10 test cases for...')." },
        "schema": { "type": "array", "items": { "type": "string" }, "description": "Field names for each generated item." },
        "model":  { "type": "string", "description": "Optional model override for generation." }
      }
    },
    "InputConfig": {
      "type": "object",
      "additionalProperties": false,
      "description": "Must have exactly one of: items, from, or generate.",
      "oneOf": [
        { "required": ["items"],    "not": { "required": ["from"] },     "not": { "required": ["generate"] } },
        { "required": ["from"],     "not": { "required": ["items"] },    "not": { "required": ["generate"] } },
        { "required": ["generate"], "not": { "required": ["items"] },    "not": { "required": ["from"] } }
      ],
      "properties": {
        "items":      { "type": "array",   "items": { "type": "object", "additionalProperties": { "type": "string" } }, "description": "Inline list of items (key/value string maps)." },
        "from":       { "oneOf": [{ "$ref": "#/$defs/CSVSource" }, { "type": "array", "items": { "type": "object", "additionalProperties": { "type": "string" } } }], "description": "Load items from a CSV file or provide an inline list (useful for multi-model fanout)." },
        "generate":   { "$ref": "#/$defs/GenerateInputConfig" },
        "limit":      { "type": "integer", "minimum": 1, "description": "Maximum number of items to process." },
        "parameters": { "type": "array",   "items": { "$ref": "#/$defs/PipelineParameter" }, "description": "Static parameters available to all items in the map template." }
      }
    },
    "MapConfig": {
      "type": "object",
      "additionalProperties": false,
      "description": "Map phase: runs one AI call per input item (or batch). Exactly one of prompt or promptFile is required.",
      "oneOf": [
        { "required": ["prompt"],     "not": { "required": ["promptFile"] } },
        { "required": ["promptFile"], "not": { "required": ["prompt"] } }
      ],
      "properties": {
        "prompt":     { "type": "string", "description": "Inline prompt template with {{column}} placeholders. Use {{ITEMS}} for batch mode." },
        "promptFile": { "type": "string", "description": "Path to a .prompt.md file. Bare filename, relative, or absolute." },
        "skill":      { "type": "string", "description": "Skill name from .github/skills/{name}/SKILL.md to prepend as guidance." },
        "output":     { "type": "array",  "items": { "type": "string" }, "description": "Expected AI output field names. Omit for raw text (text mode)." },
        "parallel":   { "type": "integer","minimum": 1, "default": 5,   "description": "Maximum concurrent AI calls." },
        "model":      { "type": "string", "description": "Model for AI calls. Supports {{variable}} syntax for per-item model selection." },
        "timeoutMs":  { "type": "integer","minimum": 0, "default": 1800000, "description": "Timeout per AI call in milliseconds. Retried once with doubled timeout on expiry." },
        "batchSize":  { "type": "integer","minimum": 1, "default": 1,   "description": "Items per AI call. Use {{ITEMS}} in prompt when > 1." }
      }
    },
    "ReduceConfig": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type":       { "type": "string", "enum": ["list","table","json","csv","ai","text"], "description": "Output format. 'ai' requires prompt or promptFile." },
        "prompt":     { "type": "string", "description": "AI reduce prompt (required when type is 'ai', unless promptFile is set)." },
        "promptFile": { "type": "string", "description": "Path to AI reduce prompt file." },
        "skill":      { "type": "string", "description": "Skill name to prepend as guidance for AI reduce." },
        "output":     { "type": "array",  "items": { "type": "string" }, "description": "AI output field names. Omit for raw text." },
        "model":      { "type": "string", "description": "Model for AI reduce." }
      }
    },
    "FilterRule": {
      "type": "object",
      "required": ["field", "operator"],
      "additionalProperties": false,
      "properties": {
        "field":    { "type": "string" },
        "operator": { "type": "string", "enum": ["equals","not_equals","in","not_in","contains","not_contains","greater_than","less_than","gte","lte","matches"] },
        "value":    { "description": "Single comparison value (for equals, greater_than, etc.)." },
        "values":   { "type": "array", "description": "Multiple values (for in, not_in)." },
        "pattern":  { "type": "string", "description": "Regex pattern (for matches operator)." }
      }
    },
    "RuleFilterConfig": {
      "type": "object",
      "required": ["rules"],
      "additionalProperties": false,
      "properties": {
        "rules": { "type": "array", "items": { "$ref": "#/$defs/FilterRule" } },
        "mode":  { "type": "string", "enum": ["all","any"], "default": "all", "description": "How to combine multiple rules." }
      }
    },
    "AIFilterConfig": {
      "type": "object",
      "required": ["prompt"],
      "additionalProperties": false,
      "properties": {
        "prompt":    { "type": "string", "description": "Prompt template with {{field}} placeholders. AI must return an 'include' boolean field." },
        "output":    { "type": "array",  "items": { "type": "string" }, "description": "Output fields — must include 'include'." },
        "parallel":  { "type": "integer","minimum": 1, "default": 5 },
        "model":     { "type": "string" },
        "timeoutMs": { "type": "integer","minimum": 0, "default": 30000 }
      }
    },
    "FilterConfig": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type":        { "type": "string", "enum": ["rule","ai","hybrid"], "description": "Filter strategy. 'rule' uses FilterRule list; 'ai' calls AI; 'hybrid' combines both." },
        "rule":        { "$ref": "#/$defs/RuleFilterConfig", "description": "Required for type 'rule' or 'hybrid'." },
        "ai":          { "$ref": "#/$defs/AIFilterConfig",   "description": "Required for type 'ai' or 'hybrid'." },
        "combineMode": { "type": "string", "enum": ["and","or"], "default": "and", "description": "How to combine rule and AI results in hybrid mode." }
      }
    },
    "JobConfig": {
      "type": "object",
      "additionalProperties": false,
      "description": "Single AI call (alternative to map-reduce). Exactly one of prompt or promptFile is required.",
      "oneOf": [
        { "required": ["prompt"],     "not": { "required": ["promptFile"] } },
        { "required": ["promptFile"], "not": { "required": ["prompt"] } }
      ],
      "properties": {
        "prompt":     { "type": "string" },
        "promptFile": { "type": "string" },
        "skill":      { "type": "string" },
        "output":     { "type": "array",  "items": { "type": "string" } },
        "model":      { "type": "string" },
        "timeoutMs":  { "type": "integer","minimum": 0 }
      }
    }
  }
}
```

> **Note on `InputConfig` mutual-exclusivity:** JSON Schema draft-07 `oneOf` with `not: required` combinations can be verbose. A cleaner approach if the above is too noisy for editors: use `if/then/else` or rely on `oneOf` at the `from`/`items`/`generate` level with separate sub-schemas. The priority is accurate hover docs; strict exclusivity enforcement is secondary.

### package.json additions

**`contributes.yamlValidation`** (new key under `contributes`):
```json
"yamlValidation": [
  {
    "fileMatch": ["**/pipeline.yaml", "**/pipeline.yml"],
    "url": "./resources/pipeline.schema.json"
  }
]
```

**`extensionSuggestions`** (new top-level key, not `extensionDependencies`):
```json
"extensionSuggestions": ["redhat.vscode-yaml"]
```
Use `extensionSuggestions` rather than `extensionDependencies` — YAML validation is a convenience feature; hard-requiring the Red Hat extension would block installation in environments where it's unavailable.

### Key type mappings from types.ts
| TypeScript type | Schema treatment |
|---|---|
| `MROutputFormat` (`'list'\|'table'\|'json'\|'csv'\|'ai'\|'text'`) | `enum` on `reduce.type` |
| `FilterOperator` (11-value union) | `enum` on `FilterRule.operator` |
| `FilterConfig.type` (`'rule'\|'ai'\|'hybrid'`) | `enum` on `filter.type` |
| `PromptItem` (`{ [key: string]: string }`) | `object` with `additionalProperties: { type: "string" }` |
| `CSVSource \| PromptItem[]` (for `input.from`) | `oneOf: [CSVSource, array of PromptItem]` |
| `MapConfig.prompt \| promptFile` | `oneOf` requiring exactly one |
| `JobConfig.prompt \| promptFile` | `oneOf` requiring exactly one |
| `ReduceConfig.prompt \| promptFile` | conditional — only relevant when `type: 'ai'`; document in descriptions rather than enforce structurally |

### Gotchas
- `resources/` currently contains only subdirectories (`bundled-pipelines/`, `bundled-skills/`, `icons/`). The new `pipeline.schema.json` goes directly under `resources/`, not in a subdirectory.
- `package.json` currently has **no** `extensionDependencies`, `extensionSuggestions`, or `yamlValidation` — all three keys are net-new additions.
- The `pipelinePreviewEditor` custom editor already exists in `contributes.customEditors` for pipeline YAML files. The schema registration is additive and complementary (it provides autocomplete; the custom editor provides the preview UI).
- `url` in `yamlValidation` must be a relative path starting with `./` for the Red Hat YAML extension to resolve it correctly as a workspace-relative resource.
- `map` and `job` are mutually exclusive in `PipelineConfig` per the type doc, but enforcing this via `oneOf` at the root level makes the schema hard to read. Instead, document it in the `description` of both fields and skip the structural constraint.

## Tests
None required — this is a static JSON file with no TypeScript. Manual validation:
1. Open any `pipeline.yaml` in VS Code with `redhat.vscode-yaml` installed and confirm autocomplete appears.
2. Optionally run `npx ajv validate -s resources/pipeline.schema.json -d <sample.yaml>` to confirm schema parses correctly.

## Acceptance Criteria
- [ ] `pipeline.schema.json` validates a correct `pipeline.yaml` without errors
- [ ] `pipeline.schema.json` flags missing required fields (e.g., missing `name`, missing `reduce.type`)
- [ ] VS Code shows autocomplete for `map.output`, `reduce.type`, `filter.type`, `filter.operator`, etc. when Red Hat YAML extension is installed
- [ ] `contributes.yamlValidation` entry present in `package.json` with correct `fileMatch` and `url`
- [ ] `extensionSuggestions` includes `redhat.vscode-yaml` in `package.json`
- [ ] All `$defs` entries have `description` annotations covering key fields

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit. The only assumed infrastructure is:
- `package.json` exists with a `contributes` object (it does — 100+ commands and views are already registered)
- `resources/` directory exists (it does — contains `bundled-pipelines/`, `bundled-skills/`, `icons/`)
- `packages/pipeline-core/src/pipeline/types.ts` exists with the types listed above (it does)
