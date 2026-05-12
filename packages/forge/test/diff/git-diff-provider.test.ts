/**
 * Tests for git-diff-provider: commit, range, and working-tree factories.
 *
 * Uses vi.mock to mock execGitAsync so tests are deterministic and
 * do not require a real git repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createCommitDiffProvider,
    createRangeDiffProvider,
    createWorkingTreeDiffProvider,
} from '../../src/diff/git-diff-provider';
import type { IDiffProvider } from '../../src/diff/types';

// ── Mock execGitAsync ────────────────────────────────────────

vi.mock('../../src/git/exec', () => ({
    execGitAsync: vi.fn(),
}));

import { execGitAsync } from '../../src/git/exec';
const mockExecGit = vi.mocked(execGitAsync);

// ── Test data ────────────────────────────────────────────────

const REPO = '/test/repo';
const COMMIT_HASH = 'abc1234567890';
const PARENT_HASH = 'def0987654321';

const NAME_STATUS_OUTPUT = [
    'M\tsrc/foo.ts',
    'A\tsrc/bar.ts',
    'D\tsrc/baz.ts',
    'R100\tsrc/old.ts\tsrc/new.ts',
].join('\n');

const NUMSTAT_OUTPUT = [
    '10\t5\tsrc/foo.ts',
    '20\t0\tsrc/bar.ts',
    '0\t15\tsrc/baz.ts',
    '3\t2\tsrc/new.ts',
].join('\n');

const FILE_DIFF_FOO = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index 1234567..abcdefg 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' line1',
    '-old line',
    '+new line',
    ' line3',
].join('\n');

const FILE_DIFF_BAR = [
    'diff --git a/src/bar.ts b/src/bar.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/bar.ts',
    '@@ -0,0 +1,2 @@',
    '+export const x = 1;',
    '+export const y = 2;',
].join('\n');

const FULL_DIFF = `${FILE_DIFF_FOO}\n${FILE_DIFF_BAR}`;

// ── Helper to set up mock responses ──────────────────────────

function setupCommitMocks(): void {
    mockExecGit.mockImplementation(async (args: string[]) => {
        const joined = args.join(' ');

        // rev-parse for parent hash
        if (joined.includes('rev-parse') && joined.includes(`${COMMIT_HASH}^`)) {
            return PARENT_HASH;
        }

        // name-status
        if (joined.includes('--name-status')) {
            return NAME_STATUS_OUTPUT;
        }

        // numstat
        if (joined.includes('--numstat')) {
            return NUMSTAT_OUTPUT;
        }

        // full diff (no -- file filter)
        if (joined.includes('diff') && !joined.includes('--') && joined.includes(PARENT_HASH)) {
            return FULL_DIFF;
        }

        // single-file diff
        if (joined.includes('diff') && joined.includes('-- src/foo.ts')) {
            return FILE_DIFF_FOO;
        }
        if (joined.includes('diff') && joined.includes('-- src/bar.ts')) {
            return FILE_DIFF_BAR;
        }

        return '';
    });
}

// ── Tests ────────────────────────────────────────────────────

describe('createCommitDiffProvider', () => {
    let provider: IDiffProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        setupCommitMocks();
        provider = createCommitDiffProvider(REPO, COMMIT_HASH);
    });

    it('has correct source descriptor', () => {
        expect(provider.source).toEqual({
            kind: 'commit',
            repositoryRoot: REPO,
            commitHash: COMMIT_HASH,
        });
    });

    it('listFiles returns sorted file entries with stats', async () => {
        const files = await provider.listFiles();
        expect(files).toHaveLength(4);
        expect(files[0].path).toBe('src/bar.ts');
        expect(files[0].status).toBe('added');
        expect(files[0].additions).toBe(20);
        expect(files[0].deletions).toBe(0);
    });

    it('listFiles caches results', async () => {
        await provider.listFiles();
        await provider.listFiles();
        // name-status and numstat should each be called only once
        const nameStatusCalls = mockExecGit.mock.calls.filter(
            c => c[0].includes('--name-status'),
        );
        expect(nameStatusCalls).toHaveLength(1);
    });

    it('listFiles detects renames', async () => {
        const files = await provider.listFiles();
        const renamed = files.find(f => f.path === 'src/new.ts');
        expect(renamed).toBeDefined();
        expect(renamed!.status).toBe('renamed');
        expect(renamed!.originalPath).toBe('src/old.ts');
    });

    it('getFileDiff returns diff content for a single file', async () => {
        const content = await provider.getFileDiff('src/foo.ts');
        expect(content.raw).toContain('diff --git');
        expect(content.raw).toContain('-old line');
        expect(content.raw).toContain('+new line');
        expect(content.truncated).toBe(false);
        expect(content.totalLines).toBeGreaterThan(0);
    });

    it('getFullDiff returns combined diff', async () => {
        const content = await provider.getFullDiff();
        expect(content.raw).toContain('src/foo.ts');
        expect(content.raw).toContain('src/bar.ts');
    });

    it('prefetchAll returns a map keyed by file path', async () => {
        const map = await provider.prefetchAll();
        expect(map.size).toBeGreaterThanOrEqual(2);
        expect(map.has('src/foo.ts')).toBe(true);
        expect(map.has('src/bar.ts')).toBe(true);
        expect(map.get('src/foo.ts')!.raw).toContain('-old line');
    });

    it('getSummary returns aggregate stats', async () => {
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(4);
        expect(summary.additions).toBe(33); // 10+20+0+3
        expect(summary.deletions).toBe(22); // 5+0+15+2
    });

    it('handles initial commit (no parent)', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            if (args.join(' ').includes('rev-parse')) {
                throw new Error('no parent');
            }
            if (args.join(' ').includes('--name-status')) {
                return 'A\tsrc/init.ts';
            }
            if (args.join(' ').includes('--numstat')) {
                return '10\t0\tsrc/init.ts';
            }
            return '';
        });

        const p = createCommitDiffProvider(REPO, 'first-commit');
        const files = await p.listFiles();
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('added');

        // Verify it used EMPTY_TREE_HASH as parent
        const diffCalls = mockExecGit.mock.calls.filter(c => c[0].includes('--name-status'));
        expect(diffCalls.length).toBeGreaterThan(0);
        const diffArgs = diffCalls[0][0];
        expect(diffArgs.some((a: string) => a.includes('4b825dc642cb6eb9a060e54bf8d69288fbee4904'))).toBe(true);
    });
});

describe('createRangeDiffProvider', () => {
    let provider: IDiffProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        mockExecGit.mockImplementation(async (args: string[]) => {
            const joined = args.join(' ');
            if (joined.includes('--name-status')) return NAME_STATUS_OUTPUT;
            if (joined.includes('--numstat')) return NUMSTAT_OUTPUT;
            if (joined.includes('diff') && !joined.includes('--name') && !joined.includes('--num')) {
                if (joined.includes('-- src/foo.ts')) return FILE_DIFF_FOO;
                return FULL_DIFF;
            }
            return '';
        });
        provider = createRangeDiffProvider(REPO, 'origin/main', 'HEAD');
    });

    it('has correct source descriptor', () => {
        expect(provider.source).toEqual({
            kind: 'range',
            repositoryRoot: REPO,
            baseRef: 'origin/main',
            headRef: 'HEAD',
        });
    });

    it('uses three-dot diff range', async () => {
        await provider.listFiles();
        const calls = mockExecGit.mock.calls;
        const nameStatusCall = calls.find(c => c[0].includes('--name-status'));
        expect(nameStatusCall).toBeDefined();
        expect(nameStatusCall![0].some((a: string) => a === 'origin/main...HEAD')).toBe(true);
    });

    it('listFiles returns entries with stats', async () => {
        const files = await provider.listFiles();
        expect(files).toHaveLength(4);
    });

    it('getFileDiff uses range spec', async () => {
        await provider.getFileDiff('src/foo.ts');
        const diffCall = mockExecGit.mock.calls.find(
            c => c[0].includes('diff') && c[0].includes('src/foo.ts'),
        );
        expect(diffCall).toBeDefined();
        expect(diffCall![0].some((a: string) => a === 'origin/main...HEAD')).toBe(true);
    });

    it('getSummary computes from file list', async () => {
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(4);
        expect(summary.additions).toBe(33);
    });
});

describe('createWorkingTreeDiffProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('scope: staged', () => {
        it('uses --cached flag', async () => {
            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('--name-status') && joined.includes('--cached')) {
                    return 'M\tsrc/staged.ts';
                }
                if (joined.includes('--numstat') && joined.includes('--cached')) {
                    return '5\t2\tsrc/staged.ts';
                }
                if (joined.includes('diff') && joined.includes('--cached') && joined.includes('-- src/staged.ts')) {
                    return FILE_DIFF_FOO;
                }
                if (joined.includes('diff') && joined.includes('--cached')) {
                    return FILE_DIFF_FOO;
                }
                return '';
            });

            const provider = createWorkingTreeDiffProvider(REPO, 'staged');
            expect(provider.source.kind).toBe('working-tree');
            if (provider.source.kind === 'working-tree') {
                expect(provider.source.scope).toBe('staged');
            }

            const files = await provider.listFiles();
            expect(files).toHaveLength(1);
            expect(files[0].path).toBe('src/staged.ts');
        });
    });

    describe('scope: unstaged', () => {
        it('uses no --cached flag', async () => {
            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('--cached')) return '';
                if (joined.includes('--name-status')) return 'M\tsrc/unstaged.ts';
                if (joined.includes('--numstat')) return '3\t1\tsrc/unstaged.ts';
                return '';
            });

            const provider = createWorkingTreeDiffProvider(REPO, 'unstaged');
            const files = await provider.listFiles();
            expect(files).toHaveLength(1);
            expect(files[0].path).toBe('src/unstaged.ts');
        });
    });

    describe('scope: all (default)', () => {
        it('merges staged and unstaged files', async () => {
            let callCount = 0;
            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');

                // Staged calls
                if (joined.includes('--name-status') && joined.includes('--cached')) {
                    return 'M\tsrc/both.ts\nA\tsrc/staged-only.ts';
                }
                if (joined.includes('--numstat') && joined.includes('--cached')) {
                    return '5\t2\tsrc/both.ts\n10\t0\tsrc/staged-only.ts';
                }

                // Unstaged calls
                if (joined.includes('--name-status') && !joined.includes('--cached')) {
                    return 'M\tsrc/both.ts\nM\tsrc/unstaged-only.ts';
                }
                if (joined.includes('--numstat') && !joined.includes('--cached')) {
                    return '3\t1\tsrc/both.ts\n7\t4\tsrc/unstaged-only.ts';
                }

                return '';
            });

            const provider = createWorkingTreeDiffProvider(REPO);
            const files = await provider.listFiles();
            expect(files).toHaveLength(3);

            const paths = files.map(f => f.path).sort();
            expect(paths).toEqual(['src/both.ts', 'src/staged-only.ts', 'src/unstaged-only.ts']);

            // 'both.ts' should have unstaged values (unstaged overrides staged)
            const both = files.find(f => f.path === 'src/both.ts')!;
            expect(both.additions).toBe(3);
            expect(both.deletions).toBe(1);
        });

        it('getFileDiff merges staged and unstaged content', async () => {
            const stagedDiff = 'diff --git a/src/f.ts b/src/f.ts\nstaged content';
            const unstagedDiff = 'diff --git a/src/f.ts b/src/f.ts\nunstaged content';

            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('--cached') && joined.includes('-- src/f.ts')) return stagedDiff;
                if (!joined.includes('--cached') && joined.includes('-- src/f.ts')) return unstagedDiff;
                // listFiles mocks
                if (joined.includes('--name-status')) return 'M\tsrc/f.ts';
                if (joined.includes('--numstat')) return '1\t1\tsrc/f.ts';
                return '';
            });

            const provider = createWorkingTreeDiffProvider(REPO, 'all');
            const content = await provider.getFileDiff('src/f.ts');
            expect(content.raw).toContain('staged content');
            expect(content.raw).toContain('unstaged content');
        });

        it('getFullDiff merges staged and unstaged', async () => {
            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('diff') && joined.includes('--cached') && !joined.includes('--name') && !joined.includes('--num')) {
                    return 'staged-full-diff';
                }
                if (joined.includes('diff') && !joined.includes('--cached') && !joined.includes('--name') && !joined.includes('--num')) {
                    return 'unstaged-full-diff';
                }
                return '';
            });

            const provider = createWorkingTreeDiffProvider(REPO, 'all');
            const content = await provider.getFullDiff();
            expect(content.raw).toContain('staged-full-diff');
            expect(content.raw).toContain('unstaged-full-diff');
        });
    });
});

describe('edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles empty diff output', async () => {
        mockExecGit.mockResolvedValue('');
        const provider = createCommitDiffProvider(REPO, COMMIT_HASH);
        const files = await provider.listFiles();
        expect(files).toHaveLength(0);
    });

    it('handles diff with binary files (numstat shows -)', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            const joined = args.join(' ');
            if (joined.includes('rev-parse')) return PARENT_HASH;
            if (joined.includes('--name-status')) return 'M\timage.png';
            if (joined.includes('--numstat')) return '-\t-\timage.png';
            return '';
        });

        const provider = createCommitDiffProvider(REPO, COMMIT_HASH);
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        expect(files[0].additions).toBe(0);
        expect(files[0].deletions).toBe(0);
    });

    it('DiffContent.totalLines counts newlines', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            const joined = args.join(' ');
            if (joined.includes('rev-parse')) return PARENT_HASH;
            if (joined.includes('diff') && joined.includes('-- src/f.ts')) {
                return 'line1\nline2\nline3';
            }
            return '';
        });

        const provider = createCommitDiffProvider(REPO, COMMIT_HASH);
        const content = await provider.getFileDiff('src/f.ts');
        expect(content.totalLines).toBe(3);
        expect(content.truncated).toBe(false);
    });
});
