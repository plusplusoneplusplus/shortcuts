# Diff Module — Unified Diff Provider

Unified abstraction for retrieving diffs from five source types, all behind a single `IDiffProvider` interface.

## Source Types

| Kind | Factory | Backend |
|------|---------|---------|
| `commit` | `createCommitDiffProvider(repoRoot, commitHash)` | Local git CLI |
| `range` | `createRangeDiffProvider(repoRoot, baseRef, headRef)` | Local git CLI |
| `working-tree` | `createWorkingTreeDiffProvider(repoRoot, scope)` | Local git CLI |
| `pr` | `createPullRequestDiffProvider(source, service)` | Remote provider (ADO/GitHub) via `IPullRequestsService` |
| `pr-iteration` | `createPullRequestIterationDiffProvider(source, fetchDiff)` | Remote provider via callback |

Convenience `*FromParams` variants accept flat parameters instead of a pre-built `DiffSource` object.

## IDiffProvider Interface

```typescript
interface IDiffProvider {
  readonly source: DiffSource;

  /** Eager — file list with status, additions/deletions, binary flag. */
  listFiles(): Promise<DiffFileEntry[]>;

  /** Lazy — unified diff for a single file. */
  getFileDiff(filePath: string, options?: GetFileDiffOptions): Promise<DiffContent>;

  /** Combined diff for all files. */
  getFullDiff(): Promise<DiffContent>;

  /** Batch-fetch all per-file diffs (faster than N individual calls). */
  prefetchAll(): Promise<Map<string, DiffContent>>;

  /** Aggregate stats (files changed, additions, deletions). */
  getSummary(): Promise<DiffSummary>;
}
```

### Loading Strategy

- **Hybrid:** `listFiles()` is cheap metadata; `getFileDiff()` fetches content on demand.
- **Prefetch:** `prefetchAll()` loads everything in one git call (local) or batched parse (remote) for AI review scenarios.
- **Truncation:** Pass `maxLines` in `GetFileDiffOptions` to cap diff output. `DiffContent.truncated` indicates if truncation occurred.

## Utilities (`diff-utils.ts`)

| Function | Purpose |
|----------|---------|
| `parseFullDiff(raw)` | Parse a full unified diff string into `DiffFileEntry[]` + per-file `DiffContent` map |
| `splitDiffByFile(raw)` | Split combined diff into per-file chunks |
| `makeDiffContent(raw)` | Wrap a raw diff string into `DiffContent` |
| `computeSummary(files)` | Aggregate `DiffSummary` from file entries |
| `truncateDiffContent(content, maxLines)` | Truncate a `DiffContent` to N lines |
| `splitIntoChunks(diffChunk)` | Split a file diff into individual hunks |
| `extractAPath(chunk)` / `extractBPath(chunk)` | Extract `a/` or `b/` path from diff header |
| `inferStatusFromDiffChunk(chunk)` | Infer add/modify/delete from hunk content |
| `countAdditionsDeletions(chunk)` | Count `+`/`-` lines in a chunk |

## Usage

```typescript
import {
  createCommitDiffProvider,
  createRangeDiffProvider,
  createWorkingTreeDiffProvider,
} from '@plusplusoneplusplus/forge';

// Single commit diff
const provider = createCommitDiffProvider('/path/to/repo', 'abc1234');
const files = await provider.listFiles();
const diff = await provider.getFileDiff(files[0].path, { maxLines: 500 });

// Branch comparison
const rangeProvider = createRangeDiffProvider('/path/to/repo', 'origin/main', 'HEAD');
const allDiffs = await rangeProvider.prefetchAll();

// Working tree changes (staged + unstaged)
const wtProvider = createWorkingTreeDiffProvider('/path/to/repo', 'all');
const summary = await wtProvider.getSummary();
```

## Architecture

```
diff/
├── types.ts              # IDiffProvider, DiffSource union, DiffFileEntry, DiffContent
├── git-diff-provider.ts  # commit, range, working-tree factories (local git CLI)
├── pr-diff-provider.ts   # PR, PR-iteration factories (remote providers)
├── diff-utils.ts         # Shared parsing/splitting/truncation utilities
└── index.ts              # Barrel re-exports
```

The diff module depends only on `../git/exec` (for `execGitAsync`) and `../providers/interfaces` (for `IPullRequestsService`). It has no editor-specific runtime dependencies.
