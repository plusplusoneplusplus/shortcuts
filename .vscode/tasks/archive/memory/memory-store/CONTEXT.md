# Context: MemoryStore

## User Story
The CoC memory system needs a persistence layer so AI pipelines can learn from past executions. MemoryStore is the foundational CRUD module — it manages the `~/.coc/memory/` storage layout, handles raw observation files and consolidated memory, and provides the interface that MemoryCapture, MemoryRetriever, and MemoryAggregator will build on.

## Goal
Implement the `MemoryStore` class in `pipeline-core` with full CRUD for raw observations, consolidated memory, index metadata, and repo-info — following existing `FileProcessStore` patterns (atomic writes, write queue, temp-dir tests).

## Commit Sequence
1. Memory types and interfaces
2. MemoryStore core — path resolution, repo hashing, raw observations
3. MemoryStore — consolidated memory, index, and management
4. Pipeline-core exports wiring
5. Update design doc with implementation status

## Key Decisions
- Follows `FileProcessStore` pattern: atomic tmp→rename writes, write queue serialization
- Uses `crypto.createHash('sha256')` for repo path hashing (16-char hex prefix)
- Storage at `~/.coc/memory/` with `system/` and `repos/<hash>/` subdirectories
- Raw observations are markdown files with YAML frontmatter
- Tests use real filesystem with `os.tmpdir()` + `mkdtemp()` isolation

## Conventions
- Types-first: all interfaces defined before implementation
- Module structure: `src/memory/types.ts`, `src/memory/memory-store.ts`, `src/memory/index.ts`
- Subpath export: `@plusplusoneplusplus/pipeline-core/memory`
- No VS Code dependencies — pure Node.js (pipeline-core boundary)
