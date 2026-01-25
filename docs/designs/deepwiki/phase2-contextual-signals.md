# Phase 2: Contextual Signals

## Overview

Enrich structural clusters with contextual information from git history, test files, documentation, and configuration to better understand how code is actually used and related.

---

## Goals

1. Analyze git history to find co-change patterns
2. Map test files to the source files they test
3. Map documentation to source code
4. Detect configuration and runtime wiring patterns
5. Combine signals to enrich cluster metadata

---

## Git Co-Change Analysis

### Concept

Files that frequently change together in the same commits likely belong to the same logical unit, even if they don't have direct import relationships.

### Analysis Approach

1. **Collect Commits**: Get commits from last N days (configurable)
2. **Build Co-Change Matrix**: For each file pair, count co-occurrences
3. **Calculate Correlation**: Normalize by total changes
4. **Identify Groups**: Cluster files by co-change similarity

### Co-Change Metrics

| Metric | Formula | Use |
|--------|---------|-----|
| Co-occurrence | Count of commits with both files | Raw signal |
| Jaccard similarity | Intersection / Union | Normalized similarity |
| Conditional probability | P(B changes \| A changes) | Directional dependency |

### Filtering

- Exclude commits touching > 50 files (likely refactors/renames)
- Exclude generated files, lock files, configs
- Weight recent commits higher than old ones
- Minimum 3 co-occurrences to be significant

### Output

For each file:
- Top 10 co-change partners with similarity scores
- Co-change cluster ID (files that always change together)
- Change frequency (commits per month)

---

## Test-to-Source Mapping

### Mapping Strategies

| Strategy | Description | Confidence |
|----------|-------------|------------|
| Naming convention | `foo.test.ts` → `foo.ts` | High |
| Directory structure | `test/foo.test.ts` → `src/foo.ts` | High |
| Import analysis | Test imports source file | High |
| Path similarity | Fuzzy match on path components | Medium |
| Co-change | Test and source always change together | Medium |

### Language-Specific Conventions

#### TypeScript/JavaScript
- `*.test.ts`, `*.spec.ts` → `*.ts`
- `__tests__/foo.test.ts` → `foo.ts`
- Jest/Mocha describe blocks may name source file

#### Python
- `test_*.py` → `*.py`
- `*_test.py` → `*.py`
- `tests/test_foo.py` → `foo.py`
- pytest fixtures may indicate tested module

#### C++
- `*_test.cpp` → `*.cpp`
- `test/*.cpp` → `src/*.cpp`
- GoogleTest TEST() macro may name class

### Coverage Metrics

| Metric | Description |
|--------|-------------|
| Test coverage ratio | Files with tests / Total source files |
| Test file count | Number of test files per source file |
| Unmapped tests | Tests with no clear source target |

---

## Documentation Mapping

### Documentation Sources

| Source | Description | Example |
|--------|-------------|---------|
| Inline comments | JSDoc, docstrings, Doxygen | `/** @description ... */` |
| README files | Directory-level docs | `src/ai-service/README.md` |
| AGENTS.md | Module guidance files | Per-module AI instructions |
| Design docs | Linked via path or mentions | `docs/designs/*.md` |
| API docs | Generated documentation | TypeDoc, Sphinx output |

### Mapping Strategies

| Strategy | Description |
|----------|-------------|
| Path proximity | README in same directory as source |
| Name matching | `ai-service.md` → `ai-service/` |
| Content analysis | Doc mentions file/class names |
| Link extraction | Doc contains links to source files |

### Extracted Information

From documentation, extract:
- Summary/description of module purpose
- Key concepts and terminology
- Usage examples
- Author/owner information
- Related modules/dependencies mentioned

---

## Configuration & Runtime Wiring

### Wiring Patterns

How modules connect at runtime, beyond static imports:

| Pattern | Example | Detection |
|---------|---------|-----------|
| Command registration | `registerCommand('foo', handler)` | Grep for register calls |
| Provider registration | `registerTreeDataProvider()` | VSCode API patterns |
| Event subscription | `onDidChange*` handlers | Event emitter patterns |
| Dependency injection | Constructor parameters | Class constructor analysis |
| Plugin loading | Dynamic module loading | Import patterns |

### Configuration Files

| File Type | Information Extracted |
|-----------|----------------------|
| `package.json` contributes | VSCode extension contributions |
| YAML configs | Feature flags, settings |
| Environment files | Runtime configuration |
| Build configs | Conditional compilation |

### Registration Graph

Build a "registration graph" showing:
- Which files register which commands/providers
- Which files handle which events
- How configuration flows to modules

---

## Signal Combination

### Enriched Cluster Structure

For each cluster from Phase 1, add:

| Field | Source | Description |
|-------|--------|-------------|
| `gitCoChangeGroups` | Git analysis | Files that change together |
| `relatedTests` | Test mapping | Test files for this cluster |
| `testCoverage` | Test mapping | Percentage of files with tests |
| `relatedDocs` | Doc mapping | Documentation for this cluster |
| `humanDescriptions` | Docs, comments | Extracted descriptions |
| `configBindings` | Wiring analysis | How cluster is wired into system |
| `changeFrequency` | Git analysis | How often cluster changes |
| `lastModified` | Git analysis | Most recent change date |

### Boundary Suggestions

Use signals to suggest cluster adjustments:

| Signal | Suggestion |
|--------|------------|
| High co-change across clusters | Consider merging |
| Low co-change within cluster | Consider splitting |
| Shared test file | Files may belong together |
| Shared documentation | Files may belong together |
| No tests for cluster | Flag for review |

---

## Required Changes

### New Modules

| Module | Purpose |
|--------|---------|
| `contextual-analyzer/index.ts` | Main analyzer orchestration |
| `contextual-analyzer/git-analyzer.ts` | Git co-change analysis |
| `contextual-analyzer/test-mapper.ts` | Test → source mapping |
| `contextual-analyzer/doc-mapper.ts` | Documentation → source mapping |
| `contextual-analyzer/wiring-analyzer.ts` | Configuration/registration analysis |
| `contextual-analyzer/signal-combiner.ts` | Combine signals with clusters |

### External Dependencies

| Package | Purpose |
|---------|---------|
| Git CLI (via Bash) | Git log, git show commands |
| Existing file utils | File reading, glob patterns |

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `gitLookbackDays` | Days of git history to analyze | `90` |
| `maxCommitFiles` | Max files per commit to include | `50` |
| `minCoOccurrence` | Minimum co-changes for significance | `3` |
| `testPatterns` | Glob patterns for test files | `['**/*.test.*', '**/test_*']` |
| `docPatterns` | Glob patterns for doc files | `['**/README.md', '**/AGENTS.md']` |

---

## Testing Strategy

### Unit Tests

| Test | Description |
|------|-------------|
| Git log parsing | Parse various commit formats |
| Co-change calculation | Jaccard similarity correctness |
| Test name matching | Various naming conventions |
| Doc path matching | README, AGENTS.md detection |
| Wiring pattern detection | Command registration patterns |

### Integration Tests

| Test | Description |
|------|-------------|
| Full git analysis | Analyze this extension's git history |
| Test mapping | Map tests to sources in this extension |
| Doc mapping | Find related docs for clusters |
| Signal combination | Enrich clusters with all signals |

### Validation Tests

| Test | Description |
|------|-------------|
| Co-change accuracy | Known related files have high similarity |
| Test coverage | Expected test files mapped correctly |
| Doc coverage | README files associated with right clusters |
| No orphan tests | All tests mapped to some source |

### Test Fixtures

Extend existing test fixtures with:
- Git history (create commits programmatically)
- Test files with various naming conventions
- Documentation files at various levels
- Configuration files with registration patterns

### Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| No git history | Skip git analysis, proceed with other signals |
| No test files | Report 0% coverage, no test mapping |
| No documentation | Empty doc mapping |
| Massive commits (1000+ files) | Exclude from co-change |
| Renamed files | Track across renames if possible |

---

## Output Format

### Enriched Cluster JSON

```json
{
  "clusters": [
    {
      "id": "cluster_001",
      "rootPath": "src/shortcuts/ai-service",
      "files": ["..."],

      "contextual": {
        "gitCoChangeGroups": [
          ["session-pool.ts", "types.ts", "index.ts"]
        ],
        "relatedTests": [
          {
            "testFile": "src/test/suite/ai-service/session-pool.test.ts",
            "sourceFiles": ["session-pool.ts"],
            "confidence": "high"
          }
        ],
        "testCoverage": 0.85,
        "relatedDocs": [
          {
            "docFile": "docs/ai-session-resume.md",
            "relevance": 0.9
          }
        ],
        "humanDescriptions": [
          "Manages AI session lifecycle and pooling",
          "Integrates with GitHub Copilot SDK"
        ],
        "configBindings": [
          {
            "type": "setting",
            "key": "workspaceShortcuts.aiService.enabled",
            "file": "extension.ts"
          }
        ],
        "changeFrequency": 12,
        "lastModified": "2026-01-20"
      },

      "boundarySuggestions": [
        {
          "type": "none",
          "reason": "High cohesion, good test coverage"
        }
      ]
    }
  ]
}
```

---

## Scope Handling

When analyzing scoped subfolders:

| Signal | Scoped Behavior |
|--------|-----------------|
| Git co-change | Filter to commits touching scoped files |
| Test mapping | Only map tests within scope or explicitly included |
| Doc mapping | Include docs in scope and parent directories |
| Wiring analysis | Focus on registrations involving scoped files |

---

## Performance Considerations

| Operation | Optimization |
|-----------|-------------|
| Git log parsing | Use `git log --name-only` for efficiency |
| Co-change matrix | Sparse matrix for large repos |
| Test mapping | Index by naming convention first |
| Doc mapping | Cache extracted content |

### Performance Targets

| Operation | Target |
|-----------|--------|
| Git analysis (1000 commits) | < 30 seconds |
| Test mapping (500 test files) | < 5 seconds |
| Doc mapping (100 docs) | < 10 seconds |
| Signal combination | < 2 seconds |

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Co-change detection | Known related files have similarity > 0.5 |
| Test mapping accuracy | > 95% of tests correctly mapped |
| Doc mapping coverage | > 80% of clusters have related docs |
| Boundary suggestions | Suggestions validated by manual review |
| Performance | Full analysis < 60 seconds for this extension |
