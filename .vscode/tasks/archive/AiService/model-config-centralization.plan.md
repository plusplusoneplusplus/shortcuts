# Refactor: Centralize AI Model Configuration

## Description

The recent commit `chore: upgrade claude-opus-4.5 to claude-opus-4.6` revealed a significant maintenance burden: updating a single model required changes across **11 files** and **16+ references**. This scattered configuration creates:

- High risk of missing updates during model changes
- Duplicated model metadata (names, labels, descriptions)
- Test files that hardcode specific model values
- Inconsistent model references across the codebase

This task proposes a refactoring to centralize model configuration and reduce the change radius when adding, updating, or removing AI models.

## Current Pain Points

| Location | What's Duplicated |
|----------|-------------------|
| `package.json` | Model enum values + descriptions |
| `pipeline-core/src/ai/types.ts` | Model type definitions |
| `ai-config-helpers.ts` | Model label mappings |
| Bundled pipeline YAMLs | Hardcoded model strings |
| Test files (6+) | Model assertions and test data |
| Documentation | Model lists |

## Acceptance Criteria

- [x] Single source of truth for all model definitions (id, label, description, tier)
- [x] Model enum in `package.json` generated or validated from central config
- [x] Type definitions derived from central model registry
- [x] Test files use model constants/helpers instead of hardcoded strings
- [x] Adding a new model requires changes to at most 1-2 files
- [x] Removing a model produces compile-time errors in all affected locations
- [x] All existing tests continue to pass
- [x] Documentation explains the model configuration system

## Subtasks

### Phase 1: Create Central Model Registry
- [x] Create `packages/pipeline-core/src/ai/model-registry.ts` with all model definitions
- [x] Define `ModelDefinition` interface with: id, label, description, tier, deprecated flag
- [x] Export typed constants: `VALID_MODELS`, `DEFAULT_MODEL_ID`, `MODEL_REGISTRY`
- [x] Export helper functions: `getModelLabel()`, `getModelDescription()`, `getAllModels()`, `isValidModelId()`, etc.

### Phase 2: Migrate Existing Code
- [x] Update `ai-config-helpers.ts` to use model registry (removed `MODEL_DISPLAY_NAMES`)
- [x] Update `pipeline-core/src/ai/types.ts` to derive types from registry
- [x] Update 7 test files to import model constants instead of hardcoding strings
- [x] Added `npm run validate:models` script to validate `package.json` enum against registry

### Phase 3: Handle YAML References
- [x] Evaluate options for bundled pipeline YAMLs:
  - Selected Option B+C: YAML keeps string values (runtime config), validated by build script
  - Build-time validation checks all bundled pipeline YAML model references

### Phase 4: Documentation & Validation
- [x] Add build-time validation script (`scripts/validate-model-registry.js`)
- [x] Registry file contains inline documentation for adding new models
- [x] Comprehensive tests (47 pipeline-core + extension integration tests)

## Design Considerations

### Proposed Model Registry Structure

```typescript
// src/shortcuts/ai-service/models/model-registry.ts

export interface ModelDefinition {
  id: string;           // e.g., 'claude-opus-4.6'
  label: string;        // e.g., 'Claude Opus 4.6'
  description: string;  // e.g., 'Premium model with highest capability'
  tier: 'fast' | 'standard' | 'premium';
  deprecated?: boolean;
}

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'claude-opus-4.6': {
    id: 'claude-opus-4.6',
    label: 'Claude Opus 4.6',
    description: 'Premium model with highest capability',
    tier: 'premium',
  },
  // ... other models
};

export const ModelIds = Object.keys(MODEL_REGISTRY) as const;
export type ModelId = typeof ModelIds[number];
```

### Alternative Approaches

1. **Code Generation**: Generate TypeScript from a JSON/YAML source of truth
2. **Validation Only**: Keep distributed definitions but add build-time cross-validation
3. **Runtime Registry**: Load models dynamically from a config file

## Notes

- The `package.json` enum is consumed by VS Code settings UI, so changes there affect user experience
- Some models may be deprecated but kept for backward compatibility
- Pipeline YAMLs in `resources/bundled-pipelines/` are shipped with the extension
- Test mocks may legitimately use fake model IDs that shouldn't be validated

## References

- Triggering commit: `a55a63f20eeb58367c84bd314d000ce6fca4d29b`
- Files affected: 11 files, 16+ references
- Related: AI Service configuration system in `src/shortcuts/ai-service/`
