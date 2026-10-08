# Diff Module — Unified Diff Provider

Unified abstraction for retrieving diffs from five source types, all behind a single `IDiffProvider` interface.

## Source Types

| Kind | Factory | Backend |
|------|---------|---------|
| `commit` | `createCommitDiffProvider(repoRoot, commitHash)` | Rust Git backend / WSL transport |
| `range` | `createRangeDiffProvider(repoRoot, baseRef, headRef)` | Rust Git backend / WSL transport |
| `working-tree` | `createWorkingTreeDiffProvider(repoRoot, scope)` | Rust Git backend / WSL transport |
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

### Processing

All five operations use Rust-owned patch processing. Local requests execute Git
through the native host backend or TypeScript WSL transport using the same Rust
command plan. Remote providers supply authenticated patch data. Operations read
current source data; TypeScript holds no parsed patch-result cache.

Pass `maxLines` in `GetFileDiffOptions` to cap per-file output; Rust returns
`DiffContent.truncated` and the original total line count. Supplied remote hunks
cannot provide additional context.

## Utilities (`diff-utils.ts`)

`parseFullDiffAsync(raw)` parses supplied patch bytes on a native worker and
returns `DiffFileEntry[]` plus a per-file `DiffContent` map. Git quoting, statuses,
binary classification and hunk counts are Rust-owned. `nativePatchToDiff(entries)`
is the internal wire conversion to public maps and locale-sorted file entries.
Native-load failures propagate with rebuild instructions.

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

- `types.ts`: public provider/source/content contracts.
- `git-diff-provider.ts`: commit, range and working-tree factories.
- `local-patch.ts`: shared host/WSL transport and native wire conversion.
- `pr-diff-provider.ts`: authenticated supplied PR and iteration transport.
- `diff-utils.ts`: async native parsing adapter and public wire conversion.
- `index.ts`: public exports.

The module uses `coc-native` for patch processing, Git execution utilities for WSL
transport and `IPullRequestsService` for authenticated remote data. It has no
editor runtime dependencies.
