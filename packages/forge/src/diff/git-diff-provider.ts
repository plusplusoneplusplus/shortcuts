/**
 * Git-based diff providers: commit, range, and working-tree.
 *
 * Each factory function returns an `IDiffProvider` backed by the local git CLI
 * (via `execGitAsync` from `../git/exec`).
 */

import { execGitAsync } from '../git/exec';
import type { GitChangeStatus } from '../git/types';
import type {
    CommitDiffSource,
    DiffContent,
    DiffFileEntry,
    DiffSummary,
    GetFileDiffOptions,
    IDiffProvider,
    RangeDiffSource,
    WorkingTreeDiffSource,
} from './types';
import { makeDiffContent, computeSummary, splitDiffByFile, truncateDiffContent } from './diff-utils';

// ── Shared helpers ───────────────────────────────────────────

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function statusCharToGitChangeStatus(char: string): GitChangeStatus {
    switch (char) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'C': return 'copied';
        case 'U': return 'conflict';
        default:  return 'modified';
    }
}

/**
 * Parse `git diff --numstat` output into additions/deletions per file path.
 */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        let filePath = parts[2];
        // Handle renames: {old => new} or old => new
        if (filePath.includes(' => ')) {
            const match = filePath.match(/(?:\{[^}]*? => ([^}]+)\}|.* => (.+))/);
            if (match) filePath = match[1] || match[2];
        }
        map.set(filePath, { additions, deletions });
    }
    return map;
}

/**
 * Parse `git diff --name-status` output into file entries.
 */
function parseNameStatus(output: string): Array<{
    path: string;
    originalPath?: string;
    status: GitChangeStatus;
}> {
    const entries: Array<{ path: string; originalPath?: string; status: GitChangeStatus }> = [];
    for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length < 2) continue;

        const statusCode = parts[0];
        const status = statusCharToGitChangeStatus(statusCode.charAt(0));

        if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
            if (parts.length >= 3) {
                entries.push({ path: parts[2], originalPath: parts[1], status });
            }
        } else {
            entries.push({ path: parts[1], status });
        }
    }
    return entries;
}

/**
 * Build `DiffFileEntry[]` from combined name-status + numstat git output.
 */
async function buildFileList(
    repoRoot: string,
    diffArgs: string[],
): Promise<DiffFileEntry[]> {
    const [nameStatusOutput, numstatOutput] = await Promise.all([
        execGitAsync(['diff', '--name-status', '-M', '-C', ...diffArgs], repoRoot),
        execGitAsync(['diff', '--numstat', ...diffArgs], repoRoot),
    ]);

    const entries = parseNameStatus(nameStatusOutput);
    const stats = parseNumstat(numstatOutput);

    const files: DiffFileEntry[] = entries.map(entry => {
        const fileStat = stats.get(entry.path);
        const isBinary = fileStat === undefined && stats.size > 0 ? undefined :
            fileStat?.additions === 0 && fileStat?.deletions === 0 ? true : false;
        return {
            path: entry.path,
            originalPath: entry.originalPath,
            status: entry.status,
            additions: fileStat?.additions,
            deletions: fileStat?.deletions,
            isBinary: isBinary || undefined,
        };
    });

    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
}

// ── Commit diff provider─────────────────────────────────────

/**
 * Create a diff provider for a single commit vs its parent.
 */
export function createCommitDiffProvider(
    repositoryRoot: string,
    commitHash: string,
): IDiffProvider {
    const source: CommitDiffSource = {
        kind: 'commit',
        repositoryRoot,
        commitHash,
    };

    let cachedFiles: DiffFileEntry[] | undefined;

    async function getParentRef(): Promise<string> {
        try {
            const parent = await execGitAsync(
                ['rev-parse', '--verify', `${commitHash}^`],
                repositoryRoot,
            );
            return parent.trim() || EMPTY_TREE_HASH;
        } catch {
            return EMPTY_TREE_HASH;
        }
    }

    function diffArgs(parentRef: string): string[] {
        return [parentRef, commitHash];
    }

    return {
        source,

        async listFiles(): Promise<DiffFileEntry[]> {
            if (cachedFiles) return cachedFiles;
            const parent = await getParentRef();
            cachedFiles = await buildFileList(repositoryRoot, diffArgs(parent));
            return cachedFiles;
        },

        async getFileDiff(filePath: string, options?: GetFileDiffOptions): Promise<DiffContent> {
            const parent = await getParentRef();
            const raw = await execGitAsync(
                ['diff', ...diffArgs(parent), '--', filePath],
                repositoryRoot,
            );
            const content = makeDiffContent(raw);
            return options?.maxLines != null ? truncateDiffContent(content, options.maxLines) : content;
        },

        async getFullDiff(): Promise<DiffContent> {
            const parent = await getParentRef();
            const raw = await execGitAsync(['diff', ...diffArgs(parent)], repositoryRoot);
            return makeDiffContent(raw);
        },

        async prefetchAll(): Promise<Map<string, DiffContent>> {
            const files = await this.listFiles();
            const parent = await getParentRef();
            const map = new Map<string, DiffContent>();

            // Single git diff call, then split by file header
            const fullRaw = await execGitAsync(['diff', ...diffArgs(parent)], repositoryRoot);
            splitDiffByFile(fullRaw, files, map);
            return map;
        },

        async getSummary(): Promise<DiffSummary> {
            const files = await this.listFiles();
            return computeSummary(files);
        },
    };
}

// ── Range diff provider ──────────────────────────────────────

/**
 * Create a diff provider for a commit range (e.g. feature branch vs base).
 * Uses three-dot diff (`base...head`) to show only the branch's changes.
 */
export function createRangeDiffProvider(
    repositoryRoot: string,
    baseRef: string,
    headRef: string,
): IDiffProvider {
    const source: RangeDiffSource = {
        kind: 'range',
        repositoryRoot,
        baseRef,
        headRef,
    };

    const rangeSpec = `${baseRef}...${headRef}`;
    let cachedFiles: DiffFileEntry[] | undefined;

    return {
        source,

        async listFiles(): Promise<DiffFileEntry[]> {
            if (cachedFiles) return cachedFiles;
            cachedFiles = await buildFileList(repositoryRoot, [rangeSpec]);
            return cachedFiles;
        },

        async getFileDiff(filePath: string, options?: GetFileDiffOptions): Promise<DiffContent> {
            const raw = await execGitAsync(
                ['diff', rangeSpec, '--', filePath],
                repositoryRoot,
            );
            const content = makeDiffContent(raw);
            return options?.maxLines != null ? truncateDiffContent(content, options.maxLines) : content;
        },

        async getFullDiff(): Promise<DiffContent> {
            const raw = await execGitAsync(['diff', rangeSpec], repositoryRoot);
            return makeDiffContent(raw);
        },

        async prefetchAll(): Promise<Map<string, DiffContent>> {
            const files = await this.listFiles();
            const map = new Map<string, DiffContent>();
            const fullRaw = await execGitAsync(['diff', rangeSpec], repositoryRoot);
            splitDiffByFile(fullRaw, files, map);
            return map;
        },

        async getSummary(): Promise<DiffSummary> {
            const files = await this.listFiles();
            return computeSummary(files);
        },
    };
}

// ── Working tree diff provider ───────────────────────────────

/**
 * Create a diff provider for working tree changes.
 */
export function createWorkingTreeDiffProvider(
    repositoryRoot: string,
    scope: 'all' | 'staged' | 'unstaged' = 'all',
): IDiffProvider {
    const source: WorkingTreeDiffSource = {
        kind: 'working-tree',
        repositoryRoot,
        scope,
    };

    let cachedFiles: DiffFileEntry[] | undefined;

    function diffArgsForScope(s: 'staged' | 'unstaged'): string[] {
        return s === 'staged' ? ['--cached'] : [];
    }

    async function listFilesForScope(s: 'staged' | 'unstaged'): Promise<DiffFileEntry[]> {
        return buildFileList(repositoryRoot, diffArgsForScope(s));
    }

    return {
        source,

        async listFiles(): Promise<DiffFileEntry[]> {
            if (cachedFiles) return cachedFiles;

            if (scope === 'all') {
                const [staged, unstaged] = await Promise.all([
                    listFilesForScope('staged'),
                    listFilesForScope('unstaged'),
                ]);
                // Merge: unstaged overrides staged for the same path
                const byPath = new Map<string, DiffFileEntry>();
                for (const f of staged) byPath.set(f.path, f);
                for (const f of unstaged) byPath.set(f.path, f);
                cachedFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
            } else {
                cachedFiles = await listFilesForScope(scope);
            }
            return cachedFiles;
        },

        async getFileDiff(filePath: string, options?: GetFileDiffOptions): Promise<DiffContent> {
            if (scope === 'all') {
                const [staged, unstaged] = await Promise.all([
                    execGitAsync(['diff', '--cached', '--', filePath], repositoryRoot).catch(() => ''),
                    execGitAsync(['diff', '--', filePath], repositoryRoot).catch(() => ''),
                ]);
                const parts: string[] = [];
                if (staged.trim()) parts.push(staged);
                if (unstaged.trim()) parts.push(unstaged);
                const content = makeDiffContent(parts.join('\n'));
                return options?.maxLines != null ? truncateDiffContent(content, options.maxLines) : content;
            }
            const raw = await execGitAsync(
                ['diff', ...diffArgsForScope(scope), '--', filePath],
                repositoryRoot,
            );
            const content = makeDiffContent(raw);
            return options?.maxLines != null ? truncateDiffContent(content, options.maxLines) : content;
        },

        async getFullDiff(): Promise<DiffContent> {
            if (scope === 'all') {
                const [staged, unstaged] = await Promise.all([
                    execGitAsync(['diff', '--cached'], repositoryRoot).catch(() => ''),
                    execGitAsync(['diff'], repositoryRoot).catch(() => ''),
                ]);
                const parts: string[] = [];
                if (staged.trim()) parts.push(staged);
                if (unstaged.trim()) parts.push(unstaged);
                return makeDiffContent(parts.join('\n'));
            }
            const raw = await execGitAsync(
                ['diff', ...diffArgsForScope(scope)],
                repositoryRoot,
            );
            return makeDiffContent(raw);
        },

        async prefetchAll(): Promise<Map<string, DiffContent>> {
            const files = await this.listFiles();
            const map = new Map<string, DiffContent>();

            if (scope === 'all') {
                const [stagedRaw, unstagedRaw] = await Promise.all([
                    execGitAsync(['diff', '--cached'], repositoryRoot).catch(() => ''),
                    execGitAsync(['diff'], repositoryRoot).catch(() => ''),
                ]);
                // Split each and merge
                const stagedMap = new Map<string, DiffContent>();
                const unstagedMap = new Map<string, DiffContent>();
                splitDiffByFile(stagedRaw, files, stagedMap);
                splitDiffByFile(unstagedRaw, files, unstagedMap);
                for (const f of files) {
                    const staged = stagedMap.get(f.path);
                    const unstaged = unstagedMap.get(f.path);
                    const parts: string[] = [];
                    if (staged?.raw.trim()) parts.push(staged.raw);
                    if (unstaged?.raw.trim()) parts.push(unstaged.raw);
                    if (parts.length > 0) {
                        map.set(f.path, makeDiffContent(parts.join('\n')));
                    }
                }
            } else {
                const fullRaw = await execGitAsync(
                    ['diff', ...diffArgsForScope(scope)],
                    repositoryRoot,
                );
                splitDiffByFile(fullRaw, files, map);
            }
            return map;
        },

        async getSummary(): Promise<DiffSummary> {
            const files = await this.listFiles();
            return computeSummary(files);
        },
    };
}
