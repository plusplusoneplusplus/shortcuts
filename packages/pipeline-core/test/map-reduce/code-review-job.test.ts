/**
 * Tests for Code Review Job
 *
 * Covers both inline-diff and commit-reference prompt paths,
 * splitter context propagation, and the createCodeReviewJob factory.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createCodeReviewJob,
    CodeReviewInput,
    CommitReference,
    AIInvoker
} from '../../src/map-reduce/jobs/code-review-job';
import { Rule } from '../../src/map-reduce/splitters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<Rule> = {}): Rule {
    return {
        id: 'test-rule',
        filename: 'test-rule.md',
        path: '/rules/test-rule.md',
        content: 'Do not use console.log in production code.',
        ...overrides
    };
}

function makeAIInvoker(response?: string): AIInvoker {
    return vi.fn().mockResolvedValue({
        success: true,
        response: response ?? JSON.stringify({
            assessment: 'pass',
            findings: []
        })
    });
}

// ---------------------------------------------------------------------------
// Tests: Splitter context propagation
// ---------------------------------------------------------------------------

describe('createCodeReviewJob - splitter', () => {
    it('passes diff as targetContent when no commitReference', () => {
        const job = createCodeReviewJob({ aiInvoker: makeAIInvoker() });
        const input: CodeReviewInput = {
            diff: 'diff --git a/file.ts b/file.ts\n+console.log("hello")',
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);

        expect(items).toHaveLength(1);
        expect(items[0].data.targetContent).toBe(input.diff);
        expect(items[0].data.context?.commitReference).toBeUndefined();
    });

    it('passes empty targetContent and commitReference in context when reference is set', () => {
        const job = createCodeReviewJob({ aiInvoker: makeAIInvoker() });
        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: '/repo',
            commitSha: 'abc123'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);

        expect(items).toHaveLength(1);
        expect(items[0].data.targetContent).toBe('');
        expect(items[0].data.context?.commitReference).toEqual(ref);
    });

    it('preserves existing context alongside commitReference', () => {
        const job = createCodeReviewJob({ aiInvoker: makeAIInvoker() });
        const ref: CommitReference = {
            type: 'staged',
            repositoryRoot: '/repo'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()],
            context: {
                commitSha: 'xyz',
                filesChanged: 3
            }
        };

        const items = job.splitter.split(input);

        expect(items[0].data.context).toEqual({
            commitSha: 'xyz',
            filesChanged: 3,
            commitReference: ref
        });
    });

    it('creates one work item per rule', () => {
        const job = createCodeReviewJob({ aiInvoker: makeAIInvoker() });
        const input: CodeReviewInput = {
            diff: 'some diff',
            rules: [
                makeRule({ id: 'r1', filename: 'rule-a.md' }),
                makeRule({ id: 'r2', filename: 'rule-b.md' })
            ]
        };

        const items = job.splitter.split(input);

        expect(items).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Tests: Mapper prompt generation (via full execute)
// ---------------------------------------------------------------------------

describe('createCodeReviewJob - mapper prompt', () => {
    it('embeds inline diff in prompt when no commitReference', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const diff = 'diff --git a/file.ts\n+console.log("oops")';
        const input: CodeReviewInput = {
            diff,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const result = await job.mapper.map(items[0], {
            jobId: 'test',
            totalItems: 1,
            completedItems: 0
        });

        expect(result.success).toBe(true);
        // The AI invoker should have been called with a prompt containing the diff
        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('console.log("oops")');
        expect(prompt).toContain('Diff to Review');
        expect(prompt).not.toContain('Retrieve the diff');
    });

    it('builds reference prompt for commit type', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: '/repo/path',
            commitSha: 'abc123def',
            commitMessage: 'fix: repair widget'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const result = await job.mapper.map(items[0], {
            jobId: 'test',
            totalItems: 1,
            completedItems: 0
        });

        expect(result.success).toBe(true);
        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('abc123def');
        expect(prompt).toContain('fix: repair widget');
        expect(prompt).toContain('Repository: `/repo/path`');
        expect(prompt).toContain('git show');
        expect(prompt).not.toContain('```diff');
    });

    it('builds reference prompt for range type', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'range',
            repositoryRoot: '/repo',
            baseRef: 'main',
            headRef: 'feature-branch'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('Range: main...feature-branch');
        expect(prompt).toContain('git diff main feature-branch');
    });

    it('builds reference prompt for pending type', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'pending',
            repositoryRoot: '/repo'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('Pending Changes');
        expect(prompt).toContain('git diff');
        expect(prompt).toContain('git diff --cached');
    });

    it('builds reference prompt for staged type', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'staged',
            repositoryRoot: '/repo'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('Staged Changes');
        expect(prompt).toContain('git diff --cached');
        expect(prompt).not.toContain('Pending');
    });

    it('normalizes Windows backslashes in repositoryRoot', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: 'C:\\Users\\dev\\project',
            commitSha: 'abc'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('C:/Users/dev/project');
        expect(prompt).not.toContain('\\');
    });

    it('includes rule name and content in reference prompt', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const rule = makeRule({
            filename: 'no-console.md',
            content: 'Do not use console.log in production code.'
        });
        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: '/repo',
            commitSha: 'abc'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [rule]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('## Rule: no-console.md');
        expect(prompt).toContain('Do not use console.log in production code.');
    });
});

// ---------------------------------------------------------------------------
// Tests: End-to-end with both diff and reference inputs
// ---------------------------------------------------------------------------

describe('createCodeReviewJob - end-to-end', () => {
    it('processes inline diff input with findings', async () => {
        const findingsResponse = JSON.stringify({
            assessment: 'needs-attention',
            findings: [{
                severity: 'warning',
                file: 'src/index.ts',
                line: 10,
                description: 'console.log found',
                suggestion: 'Remove or use logger'
            }]
        });
        const aiInvoker = makeAIInvoker(findingsResponse);
        const job = createCodeReviewJob({ aiInvoker });

        const input: CodeReviewInput = {
            diff: 'diff content',
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const mapResult = await job.mapper.map(items[0], {
            jobId: 'test', totalItems: 1, completedItems: 0
        });

        expect(mapResult.success).toBe(true);
        expect(mapResult.findings).toHaveLength(1);
        expect(mapResult.findings[0].severity).toBe('warning');
        expect(mapResult.assessment).toBe('needs-attention');
    });

    it('processes commitReference input with findings', async () => {
        const findingsResponse = JSON.stringify({
            assessment: 'fail',
            findings: [{
                severity: 'error',
                file: 'src/app.ts',
                line: 5,
                description: 'Security issue',
                suggestion: 'Use parameterized queries'
            }]
        });
        const aiInvoker = makeAIInvoker(findingsResponse);
        const job = createCodeReviewJob({ aiInvoker });

        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: '/repo',
            commitSha: 'deadbeef'
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const mapResult = await job.mapper.map(items[0], {
            jobId: 'test', totalItems: 1, completedItems: 0
        });

        expect(mapResult.success).toBe(true);
        expect(mapResult.findings).toHaveLength(1);
        expect(mapResult.findings[0].severity).toBe('error');
        expect(mapResult.assessment).toBe('fail');

        // Verify prompt did NOT contain inline diff
        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).not.toContain('```diff');
        expect(prompt).toContain('deadbeef');
    });

    it('handles AI failure gracefully', async () => {
        const aiInvoker = vi.fn().mockResolvedValue({
            success: false,
            error: 'Model unavailable'
        });
        const job = createCodeReviewJob({ aiInvoker: aiInvoker as AIInvoker });

        const input: CodeReviewInput = {
            commitReference: {
                type: 'staged',
                repositoryRoot: '/repo'
            },
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const result = await job.mapper.map(items[0], {
            jobId: 'test', totalItems: 1, completedItems: 0
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Model unavailable');
        expect(result.findings).toEqual([]);
    });

    it('handles AI exception gracefully', async () => {
        const aiInvoker = vi.fn().mockRejectedValue(new Error('Network timeout'));
        const job = createCodeReviewJob({ aiInvoker: aiInvoker as AIInvoker });

        const input: CodeReviewInput = {
            commitReference: {
                type: 'commit',
                repositoryRoot: '/repo',
                commitSha: 'abc'
            },
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        const result = await job.mapper.map(items[0], {
            jobId: 'test', totalItems: 1, completedItems: 0
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Network timeout');
    });

    it('commit reference without commitMessage omits Message line', async () => {
        const aiInvoker = makeAIInvoker();
        const job = createCodeReviewJob({ aiInvoker });
        const ref: CommitReference = {
            type: 'commit',
            repositoryRoot: '/repo',
            commitSha: 'abc123'
            // no commitMessage
        };
        const input: CodeReviewInput = {
            commitReference: ref,
            rules: [makeRule()]
        };

        const items = job.splitter.split(input);
        await job.mapper.map(items[0], { jobId: 'test', totalItems: 1, completedItems: 0 });

        const prompt = (aiInvoker as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(prompt).toContain('Commit: abc123');
        expect(prompt).not.toContain('Message:');
    });
});
