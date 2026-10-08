/**
 * Tests for the working-tree provider before native migration.
 *
 * Uses vi.mock to mock execGitAsync so tests are deterministic and
 * do not require a real git repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createWorkingTreeDiffProvider,
} from '../../src/diff/git-diff-provider';
import type { IDiffProvider } from '../../src/diff/types';

// ── Mock execGitAsync ────────────────────────────────────────

vi.mock('../../src/git/exec', () => ({
    execGitAsync: vi.fn(),
}));

import { execGitAsync } from '../../src/git/exec';
import { hostRepoPath } from '../helpers/host-repo-path';
const mockExecGit = vi.mocked(execGitAsync);

// ── Test data ────────────────────────────────────────────────

const REPO = hostRepoPath('test', 'repo');

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

        it('getFileDiff passes contextLines to both staged and unstaged git calls', async () => {
            mockExecGit.mockImplementation(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('--name-status')) return 'M\tsrc/f.ts';
                if (joined.includes('--numstat')) return '1\t1\tsrc/f.ts';
                return 'some diff content';
            });

            const provider = createWorkingTreeDiffProvider(REPO, 'all');
            await provider.getFileDiff('src/f.ts', { contextLines: 8 });
            const diffCalls = mockExecGit.mock.calls.filter(
                c => c[0].includes('diff') && c[0].includes('src/f.ts') && !c[0].includes('--name-status') && !c[0].includes('--numstat'),
            );
            expect(diffCalls.length).toBe(2); // staged + unstaged
            for (const call of diffCalls) {
                expect(call[0].some((a: string) => a === '-U8')).toBe(true);
            }
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
        const provider = createWorkingTreeDiffProvider(REPO, 'unstaged');
        const files = await provider.listFiles();
        expect(files).toHaveLength(0);
    });

    it('handles diff with binary files (numstat shows -)', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            const joined = args.join(' ');
            if (joined.includes('--name-status')) return 'M\timage.png';
            if (joined.includes('--numstat')) return '-\t-\timage.png';
            return '';
        });

        const provider = createWorkingTreeDiffProvider(REPO, 'unstaged');
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        expect(files[0].additions).toBe(0);
        expect(files[0].deletions).toBe(0);
    });

    it('DiffContent.totalLines counts newlines', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            const joined = args.join(' ');
            if (joined.includes('diff') && joined.includes('-- src/f.ts')) {
                return 'line1\nline2\nline3';
            }
            return '';
        });

        const provider = createWorkingTreeDiffProvider(REPO, 'unstaged');
        const content = await provider.getFileDiff('src/f.ts');
        expect(content.totalLines).toBe(3);
        expect(content.truncated).toBe(false);
    });
});
