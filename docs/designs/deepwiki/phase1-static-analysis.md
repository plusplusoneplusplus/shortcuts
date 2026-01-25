# Phase 1: Static Analysis

## Overview

Build dependency graphs and discover structural clusters by analyzing source code imports, build configurations, and module boundaries across multiple languages.

---

## Goals

1. Parse source files to extract import/export relationships
2. Build directed dependency graph (file → dependencies)
3. Identify entry points, shared modules, and feature boundaries
4. Cluster files into unnamed structural groups
5. Support TypeScript/JavaScript, Python, and C++

---

## Language-Specific Analysis

### TypeScript/JavaScript

#### Import Extraction

| Import Type | Example | Handling |
|-------------|---------|----------|
| ES6 named import | `import { foo } from './bar'` | Resolve relative path |
| ES6 default import | `import Bar from './bar'` | Resolve relative path |
| ES6 namespace | `import * as bar from './bar'` | Resolve relative path |
| Dynamic import | `import('./bar')` | Resolve, mark as lazy |
| CommonJS require | `const bar = require('./bar')` | Resolve relative path |
| Package import | `import lodash from 'lodash'` | Mark as external |
| Path alias | `import foo from '@/utils'` | Resolve via tsconfig paths |

#### Entry Point Detection

| Source | Entry Point Type |
|--------|------------------|
| `package.json` main/module | Package entry |
| `webpack.config.js` entry | Bundle entry |
| `tsconfig.json` files/include | Project root |
| Files with no importers | Potential entry |
| Command handlers, activation | VSCode extension entry |

#### Public API Detection

- Files exported from `index.ts` (barrel exports)
- Named exports in `package.json` exports field
- Files with highest fan-in from outside their directory

### Python

#### Import Extraction

| Import Type | Example | Handling |
|-------------|---------|----------|
| Absolute import | `import os` | Mark as stdlib/external |
| Relative import | `from . import utils` | Resolve relative |
| From import | `from mypackage.utils import foo` | Resolve package path |
| Conditional import | `if TYPE_CHECKING: import x` | Include, mark optional |
| Dynamic import | `importlib.import_module('x')` | Best effort resolution |

#### Entry Point Detection

| Source | Entry Point Type |
|--------|------------------|
| `if __name__ == '__main__'` | Script entry |
| `setup.py` entry_points | Package entry |
| `pyproject.toml` scripts | CLI entry |
| Files with no importers | Potential entry |

#### Package Detection

- Directories with `__init__.py` are packages
- `__init__.py` content defines public API
- `__all__` list indicates exported names

### C++

#### Include Extraction

| Include Type | Example | Handling |
|--------------|---------|----------|
| System include | `#include <vector>` | Mark as stdlib |
| Local include | `#include "myheader.h"` | Resolve relative |
| Quoted with path | `#include "subdir/foo.h"` | Resolve path |

#### Entry Point Detection

| Pattern | Entry Point Type |
|---------|------------------|
| `int main(` | Executable entry |
| `WinMain(` | Windows GUI entry |
| `DllMain(` | DLL entry |
| `ServiceMain(` | Windows service entry |

#### Build System Integration

| Build System | Dependency Source |
|--------------|-------------------|
| CMake | `target_link_libraries`, `add_subdirectory` |
| MSBuild | `.vcxproj` project references, `binlog` |
| Makefile | Target dependencies (limited) |

---

## Dependency Graph Structure

### Node Types

| Type | Description | Example |
|------|-------------|---------|
| `source` | Source code file | `src/utils.ts` |
| `entry` | Entry point file | `src/extension.ts` |
| `index` | Barrel/package index | `src/index.ts`, `__init__.py` |
| `external` | External package | `lodash`, `numpy` |
| `stdlib` | Standard library | `os`, `<vector>` |

### Edge Types

| Type | Description |
|------|-------------|
| `import` | Direct import dependency |
| `reexport` | Re-exports from another module |
| `type-only` | TypeScript type-only import |
| `lazy` | Dynamic/conditional import |
| `build` | Build system dependency (CMake, MSBuild) |

### Graph Metrics

| Metric | Description | Use |
|--------|-------------|-----|
| Fan-in | Incoming edges count | Identify shared modules |
| Fan-out | Outgoing edges count | Identify orchestrators |
| Betweenness | Path centrality | Identify critical modules |
| Clustering coefficient | Local density | Identify cohesive groups |

---

## Clustering Algorithm

### Approach: Directory-Based with Dependency Refinement

1. **Initial Clusters**: Each top-level directory = potential cluster
2. **Cohesion Check**: Measure internal vs external dependencies
3. **Split**: If internal cohesion is low, split into subclusters
4. **Merge**: If directories have high mutual dependency, merge
5. **Isolate Shared**: High fan-in files form "shared" cluster

### Cohesion Score

```
Cohesion = Internal Dependencies / Total Dependencies
```

- Cohesion > 0.7: Keep as cluster
- Cohesion < 0.5: Consider splitting
- Two clusters with > 50% mutual deps: Consider merging

### Cluster Output

Each cluster contains:
- List of files
- Root path (common ancestor directory)
- Internal dependencies (edges within cluster)
- External dependencies (edges to other clusters)
- Fan-in score (how many other clusters depend on this)
- Fan-out score (how many clusters this depends on)

---

## Scope Handling

### Scoped Analysis

When `targetPath` is specified:

1. **File Filtering**: Only parse files within scope + additionalIncludes
2. **Dependency Classification**:
   - In-scope: Fully analyzed, included in clusters
   - Additional-include: Fully analyzed, separate clusters
   - External: Recorded as reference, not clustered
3. **Graph Pruning**: Remove nodes outside scope, keep edges as "external" references

### External Dependency Modes

| Mode | Behavior |
|------|----------|
| `reference` | Record external path, don't analyze internals |
| `include` | Transitively include and analyze dependencies |
| `ignore` | Don't track external dependencies |

---

## Required Changes

### New Modules

| Module | Purpose |
|--------|---------|
| `static-analyzer/index.ts` | Main analyzer orchestration |
| `static-analyzer/typescript-parser.ts` | TS/JS import extraction |
| `static-analyzer/python-parser.ts` | Python import extraction |
| `static-analyzer/cpp-parser.ts` | C++ include extraction |
| `static-analyzer/dependency-graph.ts` | Graph data structure and algorithms |
| `static-analyzer/clusterer.ts` | Clustering algorithm |
| `static-analyzer/scope-filter.ts` | Scope boundary handling |

### External Dependencies

| Package | Purpose | Language |
|---------|---------|----------|
| `typescript` | TS AST parsing | TypeScript |
| `@babel/parser` | JS AST parsing (alternative) | JavaScript |
| Built-in regex | Python import parsing | Python |
| Built-in regex | C++ include parsing | C++ |

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `languages` | Languages to analyze | `['typescript', 'python', 'cpp']` |
| `includePatterns` | File globs to include | `['**/*.ts', '**/*.py', '**/*.cpp']` |
| `excludePatterns` | File globs to exclude | `['**/node_modules/**', '**/__pycache__/**']` |
| `cohesionThreshold` | Minimum cluster cohesion | `0.7` |
| `minClusterSize` | Minimum files per cluster | `3` |

---

## Testing Strategy

### Unit Tests

| Test | Description |
|------|-------------|
| TS import parsing | Various import styles extracted correctly |
| Python import parsing | Absolute, relative, from imports |
| C++ include parsing | System vs local, path resolution |
| Path resolution | Relative paths, aliases, package imports |
| External detection | External packages identified correctly |

### Integration Tests

| Test | Description |
|------|-------------|
| Full graph build (TS) | Build graph for this extension's `src/` |
| Full graph build (Python) | Build graph for sample Python project |
| Full graph build (C++) | Build graph for sample CMake project |
| Mixed language repo | Handle repo with TS + Python |
| Scope filtering | Only include files within targetPath |

### Validation Tests

| Test | Description |
|------|-------------|
| Entry points found | Known entry points in test repos detected |
| Shared modules identified | High fan-in modules correctly flagged |
| Cluster boundaries | Clusters match expected directory groups |
| No orphan files | Every source file in exactly one cluster |

### Test Fixtures

```
test/fixtures/
├── typescript-project/        # TS project with various import styles
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── python-project/            # Python package with imports
│   ├── mypackage/
│   ├── setup.py
│   └── requirements.txt
├── cpp-project/               # CMake C++ project
│   ├── src/
│   ├── include/
│   └── CMakeLists.txt
└── mixed-project/             # TS + Python
    ├── frontend/              # TypeScript
    └── backend/               # Python
```

### Performance Tests

| Test | Target |
|------|--------|
| Parse 1000 TS files | < 10 seconds |
| Build graph 10K nodes | < 5 seconds |
| Clustering 100 clusters | < 2 seconds |

---

## Output Format

### Dependency Graph JSON

```json
{
  "nodes": [
    {
      "id": "src/extension.ts",
      "type": "entry",
      "language": "typescript",
      "exports": ["activate", "deactivate"],
      "metrics": {
        "fanIn": 0,
        "fanOut": 15,
        "lines": 3300
      }
    }
  ],
  "edges": [
    {
      "from": "src/extension.ts",
      "to": "src/shortcuts/configuration-manager.ts",
      "type": "import"
    }
  ]
}
```

### Cluster Output JSON

```json
{
  "clusters": [
    {
      "id": "cluster_001",
      "rootPath": "src/shortcuts/ai-service",
      "files": ["index.ts", "session-pool.ts", "..."],
      "metrics": {
        "fileCount": 23,
        "totalLines": 2500,
        "cohesion": 0.85,
        "fanIn": 3,
        "fanOut": 2
      },
      "internalDeps": ["session-pool.ts → types.ts"],
      "externalDeps": ["→ src/shortcuts/shared"]
    }
  ]
}
```

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Import extraction accuracy | > 99% of imports correctly parsed |
| Entry point detection | All known entry points found |
| Cluster quality | Cohesion > 0.7 for 90% of clusters |
| Performance | 10K file repo analyzed in < 30 seconds |
| Scope correctness | Only scoped files included |
