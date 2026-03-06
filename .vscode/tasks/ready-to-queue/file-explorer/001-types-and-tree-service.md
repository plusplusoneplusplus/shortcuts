---
status: pending
---

# 001: Types & Repo Tree Service

## Summary

Define shared TypeScript interfaces (`RepoInfo`, `TreeEntry`) and implement `RepoTreeService` — a stateless service that lists directory contents for a given repo path, with dirs-first sorting, `.gitignore` awareness, and size guards. This commit introduces the data types and core logic only; no HTTP route wiring.

## Motivation

Separating types and the service layer into their own commit:

1. **Reviewability** — types + pure logic are easy to review in isolation, without HTTP noise.
2. **Testability** — `RepoTreeService` can be tested directly against temp directories without spinning up the HTTP server.
3. **Reuse** — the same interfaces will be consumed by the HTTP handler (commit 002), the WebSocket file-subscribe feature, and the SPA React components.

## Changes

### Files to Create

#### `packages/coc-server/src/repos/types.ts`

Shared type definitions for the file-explorer feature. Follows the same module-local `types.ts` pattern used by `packages/coc-server/src/wiki/types.ts`.

```typescript
/** Metadata about a registered workspace/repo, derived from WorkspaceInfo in pipeline-core. */
export interface RepoInfo {
  /** Stable ID — the WorkspaceInfo.id (hash of rootPath). */
  id: string;
  /** Human-readable name (folder basename). */
  name: string;
  /** Absolute path to the repo root on disk. */
  localPath: string;
  /** Current HEAD commit SHA (short, 7 chars). Empty string if not a git repo. */
  headSha: string;
  /** ISO timestamp of when the workspace was registered. */
  clonedAt: string;
  /** Git remote URL (origin), if available. */
  remoteUrl?: string;
}

/** A single entry in a directory listing. */
export interface TreeEntry {
  /** File or directory name (basename only, no path separators). */
  name: string;
  /** Entry type. */
  type: 'file' | 'dir';
  /** Size in bytes (files only; undefined for directories). */
  size?: number;
  /** Path relative to the repo root, e.g. "src/index.ts". */
  path: string;
}

/** Result of listing a single directory inside a repo. */
export interface TreeListResult {
  /** Directory entries, dirs-first then alphabetical. */
  entries: TreeEntry[];
  /** True when the directory has more entries than the size guard allows. */
  truncated: boolean;
}
```

#### `packages/coc-server/src/repos/tree-service.ts`

Stateless service class that performs directory listing. Modelled after `FileMemoryStore` (constructor receives config, pure-logic methods, no HTTP concerns).

```typescript
export interface RepoTreeServiceOptions {
  /**
   * Maximum entries returned per directory listing.
   * Listings exceeding this are truncated and `truncated: true` is set.
   * Default: 5000.
   */
  maxEntries?: number;
}

export class RepoTreeService {
  private readonly maxEntries: number;
  private readonly dataDir: string;

  constructor(dataDir: string, options?: RepoTreeServiceOptions) {
    this.dataDir = dataDir;
    this.maxEntries = options?.maxEntries ?? 5000;
  }

  /**
   * List all registered repos from workspaces.json.
   * @returns Array of RepoInfo with headSha resolved from git.
   */
  async listRepos(): Promise<RepoInfo[]>;

  /**
   * Resolve a repo by ID. Returns undefined if not found.
   */
  resolveRepo(repoId: string): RepoInfo | undefined;

  /**
   * List the contents of `relativePath` inside the repo identified by `repoId`.
   *
   * @param repoId       Stable workspace ID.
   * @param relativePath Path relative to repo root ('.' or '' = root).
   * @returns TreeListResult with entries (dirs-first, alpha-sorted), or throws if
   *          path is outside repo root (traversal guard) or does not exist.
   */
  async listDirectory(repoId: string, relativePath: string): Promise<TreeListResult>;

  /**
   * Read file content.
   * @returns content (text or base64), encoding, and mimeType.
   * @throws if file not found or path traversal detected.
   */
  async readBlob(repoId: string, relativePath: string): Promise<{
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
  }>;

  /**
   * Build a RepoInfo from a WorkspaceInfo.
   * Pure mapping + git HEAD resolution.
   */
  static toRepoInfo(workspace: WorkspaceInfo): RepoInfo;
}
```

**Key implementation details:**

| Concern | Approach |
|---------|----------|
| **Directory reading** | `fs.promises.readdir(absPath, { withFileTypes: true })` — async version of the pattern in the existing `browseDirectory()` helper at `api-handler.ts:1840`. |
| **Path-traversal guard** | `path.resolve(repoRoot, relPath)` must start with `path.resolve(repoRoot)` (+ path.sep or exact match). Throw an error on violation. |
| **Sorting** | Dirs first, then alphabetical (`a.name.localeCompare(b.name)`). Same comparator as `browseDirectory()`. |
| **Size guard** | If `rawEntries.length > this.maxEntries`, slice to `maxEntries` and set `truncated: true`. |
| **File size** | `(await fs.promises.stat(fullPath)).size` for files; omitted for directories. Wrap in try/catch — broken symlinks get `size: undefined`. |
| **Symlink detection** | Symlinks are resolved to their target type (file or dir). If the target doesn't exist, the entry is skipped. |
| **`.gitignore` awareness** | Shell out to `git check-ignore --stdin` with a newline-delimited list of absolute paths. This avoids adding a new npm dependency (the `ignore` package is not used anywhere in the repo today). Falls back gracefully — if git is not installed or the directory is not inside a git work-tree, all entries are included. Ignored entries are filtered out by default; pass `showIgnored: true` option to include them. |
| **Hidden files** | Always included in results (the caller/UI can filter). This differs from `browseDirectory()` which hides dotfiles by default, because the file explorer is for code navigation inside a known repo, not filesystem browsing. |
| **`toRepoInfo()` static** | Maps `WorkspaceInfo` fields (`id`, `name`, `rootPath` → `localPath`) directly. Resolves `headSha` via `git rev-parse --short HEAD`. Sets `clonedAt` from workspace registration timestamp. |

#### `packages/coc-server/src/repos/index.ts`

Barrel re-export:

```typescript
export { RepoInfo, TreeEntry, TreeListResult } from './types';
export { RepoTreeService, RepoTreeServiceOptions } from './tree-service';
```

### Files to Modify

- **`packages/coc-server/src/index.ts`** — Add `export * from './repos'` to the public surface. Follows the existing pattern where `export * from './wiki'` and `export * from './memory/memory-store'` are already present.

### Files to Delete

- (none)

## Implementation Notes

### Why `git check-ignore --stdin` instead of the `ignore` npm package

The `ignore` npm package is not a dependency of any package in this monorepo. Introducing it would require adding a new production dependency. `git check-ignore --stdin` is zero-dependency, correct by definition (it uses the same logic git uses), and handles nested `.gitignore` files, global gitignore, and `.git/info/exclude` automatically.

**Invocation:** `child_process.execSync('git check-ignore --stdin', { input, cwd: repoRoot })`. Parse stdout lines to build a `Set<string>` of ignored absolute paths, then check membership when building `TreeEntry[]`.

**Fallback:** If `execSync` throws (no git, not a repo, empty input), treat all entries as `gitignored: false`. This makes the service work for non-git directories too.

### Repo ID derivation

The `repoId` parameter is the `WorkspaceInfo.id` field from `pipeline-core/src/process-store.ts:59`, which is already a stable hash of `rootPath`. The service does NOT compute its own IDs — it receives them from the caller. The `listRepos()` method reads `workspaces.json` from `dataDir` and maps each entry via `toRepoInfo()`. The `resolveRepo()` method does a lookup by ID from the same source.

### `readBlob()` implementation

Uses `fs.promises.readFile`. Detects binary vs text via a byte-scan of the first 8 KB (check for null bytes). Returns `encoding: 'utf-8'` for text, `'base64'` for binary. MIME type inferred from file extension (use a simple extension→MIME map covering common types: `.js`→`application/javascript`, `.md`→`text/markdown`, `.png`→`image/png`, etc.). Size cap: refuse files > 1 MB (throw an error).

### Size guard threshold

5000 entries is generous for any reasonable project directory. Monorepos with enormous `node_modules` or `vendor` directories may hit this, but those are typically gitignored and the UI can deprioritise them. The threshold is configurable via `RepoTreeServiceOptions.maxEntries`.

### Async API

All methods are async (`fs.promises.readdir`, `fs.promises.stat`, `child_process.execFile` with promisify). This follows modern Node.js conventions and avoids blocking the event loop for large directories.

## Tests

#### `packages/coc-server/test/repo-tree-service.test.ts`

Follows the exact patterns from `memory-store.test.ts`: `beforeEach` creates a temp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tree-test-'))`, `afterEach` removes it with `fs.rmSync(tmpDir, { recursive: true, force: true })`.

```
describe('RepoTreeService.listDirectory')
  it('lists files and directories in a flat directory')
    — Create tmpDir with files (a.txt, b.ts) and subdirs (src/, lib/).
    — Assert entries have correct name, type ('file'|'dir'), and path fields.

  it('sorts directories before files, then alphabetically')
    — Create: z-file.txt, a-dir/, m-file.ts, b-dir/.
    — Assert order: [a-dir, b-dir, m-file.ts, z-file.txt].

  it('returns correct size for files and undefined for directories')
    — Write a file with known content (e.g., 'hello' → 5 bytes).
    — Assert entry.size === 5 for the file, undefined for directories.

  it('populates path field relative to repo root')
    — Create tmpDir/src/index.ts.
    — List 'src'. Assert entry.path === 'src/index.ts'.

  it('throws for paths outside repo root (traversal guard)')
    — Call listDirectory(id, '../../../etc').
    — Assert throws.

  it('throws for non-existent relative path')
    — Call listDirectory(id, 'no-such-dir').
    — Assert throws.

  it('truncates when entries exceed maxEntries')
    — Create 10 files, instantiate service with maxEntries: 3.
    — Assert entries.length === 3 and truncated === true.

  it('sets truncated to false when entries are within limit')
    — Create 2 files, maxEntries: 5.
    — Assert truncated === false.

  it('includes hidden (dot) files in results')
    — Create .env, .gitignore, src/.
    — Assert all three appear in entries.

describe('RepoTreeService.listRepos')
  it('returns repos from workspaces.json')
    — Seed workspaces.json with one entry pointing to a temp git repo.
    — Assert returns array with one RepoInfo with id, name, localPath, headSha.

  it('returns empty array when workspaces.json is missing')
    — No workspaces.json.
    — Assert returns [].

describe('RepoTreeService.resolveRepo')
  it('returns RepoInfo for known repoId')
    — Seed workspaces.json, call resolveRepo with the ID.
    — Assert returns matching RepoInfo.

  it('returns undefined for unknown repoId')
    — Call with 'nonexistent'.
    — Assert returns undefined.

describe('RepoTreeService.readBlob')
  it('reads text file as utf-8')
    — Write a .ts file, call readBlob.
    — Assert encoding === 'utf-8', content matches.

  it('reads binary file as base64')
    — Write a file with null bytes.
    — Assert encoding === 'base64'.

  it('throws for files exceeding 1 MB')
    — Write a large file. Assert throws.

  it('throws for path traversal')
    — Call readBlob(id, '../outside'). Assert throws.

describe('RepoTreeService.listDirectory — gitignore integration')
  it('filters gitignored entries by default')
    — (skip if git not available)
    — git init tmpDir, write .gitignore with 'dist/', create dist/ and src/.
    — Assert dist/ is NOT in entries, src/ IS.

  it('includes all entries when showIgnored is true')
    — Same setup. Pass showIgnored: true.
    — Assert dist/ IS in entries.

describe('RepoTreeService.toRepoInfo')
  it('maps WorkspaceInfo fields to RepoInfo')
    — Call with a mock WorkspaceInfo.
    — Assert returned RepoInfo has localPath, headSha, clonedAt fields.
```

## Acceptance Criteria

- [ ] `RepoInfo`, `TreeEntry`, and `TreeListResult` interfaces are exported from `packages/coc-server/src/repos/types.ts`
- [ ] `RepoTreeService` class is exported from `packages/coc-server/src/repos/tree-service.ts`
- [ ] `RepoInfo` has `id`, `name`, `localPath`, `headSha`, `clonedAt`, and optional `remoteUrl` fields
- [ ] `TreeEntry` has `name`, `type` (`'file'|'dir'`), optional `size`, and `path` fields
- [ ] `listRepos()` reads `workspaces.json` and returns `RepoInfo[]` with resolved `headSha`
- [ ] `resolveRepo()` returns `RepoInfo` or `undefined` for unknown IDs
- [ ] `listDirectory()` returns dirs-first + alphabetical entries with correct `type`, `size`, and `path` fields
- [ ] `readBlob()` returns `{ content, encoding, mimeType }` for text and binary files
- [ ] Path-traversal attempts (e.g., `../../..`) throw an error
- [ ] Non-existent paths throw an error
- [ ] Listings exceeding `maxEntries` are truncated with `truncated: true`
- [ ] `.gitignore` awareness: ignored entries are filtered by default; `showIgnored` option includes them
- [ ] `toRepoInfo()` correctly maps `WorkspaceInfo` → `RepoInfo`
- [ ] All tests pass: `cd packages/coc-server && npx vitest run test/repo-tree-service.test.ts`
- [ ] `npm run build` succeeds with no new TypeScript errors
- [ ] Cross-platform: no POSIX-only APIs

## Dependencies

- Depends on: None

## Assumed Prior State

None — first commit in the file-explorer feature. The `packages/coc-server/src/repos/` directory does not yet exist.
