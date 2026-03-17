import { describe, it, expect } from 'vitest';
import { buildReplicatePrompt } from '../../src/templates/prompt-builder';
import { GitCommitFile } from '../../src/git';

function makeFile(path: string, status: GitCommitFile['status']): GitCommitFile {
    return {
        path,
        status,
        commitHash: 'abc123',
        parentHash: 'def456',
        repositoryRoot: '/repo',
    };
}

describe('buildReplicatePrompt', () => {
    const commit = { hash: 'abc123full', shortHash: 'abc1', subject: 'Add foo' };

    it('includes commit info and diff', () => {
        const diff = 'diff --git a/foo.ts b/foo.ts\n+export const foo = 1;';
        const result = buildReplicatePrompt(commit, diff, [], 'Do the same for bar');

        expect(result).toContain('abc1');
        expect(result).toContain('Add foo');
        expect(result).toContain(diff);
        expect(result).toContain('Do the same for bar');
    });

    it('maps file statuses correctly', () => {
        const files = [
            makeFile('a.ts', 'added'),
            makeFile('b.ts', 'modified'),
            makeFile('c.ts', 'deleted'),
            makeFile('d.ts', 'renamed'),
        ];
        const result = buildReplicatePrompt(commit, 'diff', files, 'instruction');

        expect(result).toContain('`a.ts` (new)');
        expect(result).toContain('`b.ts` (modified)');
        expect(result).toContain('`c.ts` (deleted)');
        expect(result).toContain('`d.ts` (modified)');
    });

    it('includes hints when provided', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction', [
            'Keep it short',
            'Use TypeScript',
        ]);

        expect(result).toContain('## Hints');
        expect(result).toContain('Keep it short');
        expect(result).toContain('Use TypeScript');
    });

    it('omits hints section when hints is empty or undefined', () => {
        const result1 = buildReplicatePrompt(commit, 'diff', [], 'instruction');
        const result2 = buildReplicatePrompt(commit, 'diff', [], 'instruction', []);

        expect(result1).not.toContain('## Hints');
        expect(result2).not.toContain('## Hints');
    });

    it('handles empty diff gracefully', () => {
        const result = buildReplicatePrompt(commit, '', [], 'instruction');

        expect(result).toContain('(empty diff');
        expect(result).not.toContain('```diff');
    });

    it('includes output format instructions', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');

        expect(result).toContain('=== FILE:');
        expect(result).toContain('=== END FILE ===');
        expect(result).toContain('=== SUMMARY ===');
    });

    it('omits file list when files array is empty', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');

        expect(result).not.toContain('Changed files:');
    });

    it('trims trailing whitespace', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');

        expect(result).toBe(result.trimEnd());
    });

    it('contains the Template Commit section header', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');
        expect(result).toContain('## Template Commit');
    });

    it('contains the Instruction section', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');
        expect(result).toContain('## Instruction');
    });

    it('contains the Output Format section', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], 'instruction');
        expect(result).toContain('## Output Format');
    });

    it('includes each file path in the file list', () => {
        const files = [
            makeFile('src/a.ts', 'added'),
            makeFile('src/b.ts', 'modified'),
            makeFile('lib/c.ts', 'deleted'),
        ];
        const result = buildReplicatePrompt(commit, 'diff', files, 'instruction');
        expect(result).toContain('src/a.ts');
        expect(result).toContain('src/b.ts');
        expect(result).toContain('lib/c.ts');
    });

    it('produces valid prompt when description/instruction is empty string', () => {
        const result = buildReplicatePrompt(commit, 'diff', [], '');
        expect(result).toBeTruthy();
        expect(result).not.toContain('undefined');
    });

    it('handles a large diff without truncation', () => {
        const largeDiff = 'x'.repeat(50_000);
        const result = buildReplicatePrompt(commit, largeDiff, [], 'instruction');
        expect(result).toContain(largeDiff);
    });

    it('includes all files even with a large diff', () => {
        const largeDiff = 'y'.repeat(50_000);
        const fileNames = Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`);
        const files = fileNames.map((f) => makeFile(f, 'modified'));
        const result = buildReplicatePrompt(commit, largeDiff, files, 'instruction');
        for (const name of fileNames) {
            expect(result).toContain(name);
        }
    });
});
