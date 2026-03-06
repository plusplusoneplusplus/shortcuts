import { describe, it, expect, vi } from 'vitest';
import { replicateCommit } from '../../src/templates/replicate-service';
import { ReplicateOptions, CommitTemplate } from '../../src/templates/types';
import { AIInvoker } from '../../src/map-reduce';
import { execGit } from '../../src/git';

const CANNED_RESPONSE = [
    '=== FILE: src/alpha.ts (new) ===',
    'export const alpha = true;',
    '=== END FILE ===',
    '=== FILE: src/beta.ts (modified) ===',
    'export const beta = 2;',
    '=== END FILE ===',
    '=== SUMMARY ===',
    'Created alpha and modified beta.',
].join('\n');

function getRepoRoot(): string {
    return execGit(['rev-parse', '--show-toplevel'], process.cwd()).trim();
}

function getHeadHash(): string {
    return execGit(['rev-parse', 'HEAD'], process.cwd()).trim();
}

describe('replicateCommit', () => {
    it('returns expected FileChange array', async () => {
        const repoRoot = getRepoRoot();
        const hash = getHeadHash();

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: hash,
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do the same thing for alpha and beta',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: CANNED_RESPONSE,
        });

        const result = await replicateCommit(options, mockInvoker);

        expect(result.files).toHaveLength(2);
        expect(result.files[0].path).toBe('src/alpha.ts');
        expect(result.files[0].status).toBe('new');
        expect(result.files[1].path).toBe('src/beta.ts');
        expect(result.files[1].status).toBe('modified');
        expect(result.summary).toBe('Created alpha and modified beta.');
    });

    it('throws on unknown commit hash', async () => {
        const repoRoot = getRepoRoot();
        const fakeHash = '0000000000000000000000000000000000000000';

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: fakeHash,
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do something',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '',
        });

        await expect(replicateCommit(options, mockInvoker)).rejects.toThrow(fakeHash);
    });

    it('throws when AI invocation fails', async () => {
        const repoRoot = getRepoRoot();
        const hash = getHeadHash();

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: hash,
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do something',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: false,
            error: 'quota exceeded',
        });

        await expect(replicateCommit(options, mockInvoker)).rejects.toThrow('quota exceeded');
    });

    it('calls onProgress with expected stages', async () => {
        const repoRoot = getRepoRoot();
        const hash = getHeadHash();

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: hash,
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do something',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: CANNED_RESPONSE,
        });
        const onProgress = vi.fn();

        await replicateCommit(options, mockInvoker, onProgress);

        const stages = onProgress.mock.calls.map((call: unknown[]) => call[0]);
        expect(stages).toContain('git');
        expect(stages).toContain('prompt');
        expect(stages).toContain('ai');
        expect(stages).toContain('parse');

        // Verify ordering: git before prompt before ai before parse
        const gitIdx = stages.indexOf('git');
        const promptIdx = stages.indexOf('prompt');
        const aiIdx = stages.indexOf('ai');
        const parseIdx = stages.indexOf('parse');
        expect(gitIdx).toBeLessThan(promptIdx);
        expect(promptIdx).toBeLessThan(aiIdx);
        expect(aiIdx).toBeLessThan(parseIdx);
    });

    it('passes template hints through to the prompt', async () => {
        const repoRoot = getRepoRoot();
        const hash = getHeadHash();

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: hash,
            hints: ['Focus on error handling', 'Use TypeScript'],
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do something',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: CANNED_RESPONSE,
        });

        await replicateCommit(options, mockInvoker);

        const promptArg = (mockInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(promptArg).toContain('Focus on error handling');
        expect(promptArg).toContain('Use TypeScript');
    });

    it('returns empty files array when AI returns no file blocks', async () => {
        const repoRoot = getRepoRoot();
        const hash = getHeadHash();

        const template: CommitTemplate = {
            name: 'test',
            kind: 'commit',
            commitHash: hash,
        };
        const options: ReplicateOptions = {
            template,
            repoRoot,
            instruction: 'Do something',
        };
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: 'I could not generate any changes for this instruction.',
        });

        const result = await replicateCommit(options, mockInvoker);
        expect(result.files).toEqual([]);
    });
});
