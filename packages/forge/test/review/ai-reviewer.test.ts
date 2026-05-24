/**
 * AIReviewer Tests — Phase 2c
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiffSource, CommitDiffSource, RangeDiffSource, WorkingTreeDiffSource } from '../../src/diff/types';
import type { ReviewComment, ReviewOptions } from '../../src/review/types';
import { AIReviewer, AIReviewerConfig, parseReviewFindings, extractJsonFromResponse } from '../../src/review/ai-reviewer';
import type { SDKInvocationResult } from '@plusplusoneplusplus/coc-agent-sdk';

// ── Helpers ──────────────────────────────────────────────────

function makeCommitSource(overrides?: Partial<CommitDiffSource>): CommitDiffSource {
    return {
        kind: 'commit',
        repositoryRoot: '/repo',
        commitHash: 'abc123',
        ...overrides,
    };
}

function makeRangeSource(overrides?: Partial<RangeDiffSource>): RangeDiffSource {
    return {
        kind: 'range',
        repositoryRoot: '/repo',
        baseRef: 'origin/main',
        headRef: 'feature-branch',
        ...overrides,
    };
}

function makeWorkingTreeSource(): WorkingTreeDiffSource {
    return {
        kind: 'working-tree',
        repositoryRoot: '/repo',
        scope: 'staged',
    };
}

function makeMockSdkService(response?: Partial<SDKInvocationResult>) {
    return {
        sendMessage: vi.fn().mockResolvedValue({
            success: true,
            response: '[]',
            ...response,
        }),
    } as unknown as AIReviewerConfig['sdkService'];
}

function makeConfig(overrides?: Partial<AIReviewerConfig>): AIReviewerConfig {
    return {
        sdkService: makeMockSdkService(),
        ...overrides,
    };
}

// ── extractJsonFromResponse ─────────────────────────────────

describe('extractJsonFromResponse', () => {
    it('should parse direct JSON array', () => {
        const result = extractJsonFromResponse('[{"a": 1}]');
        expect(result).toEqual([{ a: 1 }]);
    });

    it('should parse direct JSON object', () => {
        const result = extractJsonFromResponse('{"findings": []}');
        expect(result).toEqual({ findings: [] });
    });

    it('should extract JSON from markdown fences', () => {
        const text = 'Here are findings:\n```json\n[{"severity": "error"}]\n```';
        const result = extractJsonFromResponse(text);
        expect(result).toEqual([{ severity: 'error' }]);
    });

    it('should extract JSON from unmarked fences', () => {
        const text = 'Results:\n```\n[{"x": 1}]\n```';
        const result = extractJsonFromResponse(text);
        expect(result).toEqual([{ x: 1 }]);
    });

    it('should extract embedded JSON object from prose', () => {
        const text = 'No issues. {"findings": []}';
        const result = extractJsonFromResponse(text);
        expect(result).toEqual({ findings: [] });
    });

    it('should extract embedded JSON array from prose', () => {
        const text = 'Found these: [{"severity": "warning", "filePath": "a.ts", "description": "bad"}]';
        const result = extractJsonFromResponse(text);
        expect(result).toEqual([{ severity: 'warning', filePath: 'a.ts', description: 'bad' }]);
    });

    it('should return undefined for unparseable text', () => {
        const result = extractJsonFromResponse('No JSON here at all.');
        expect(result).toBeUndefined();
    });

    it('should handle whitespace around JSON', () => {
        const result = extractJsonFromResponse('  \n  []\n  ');
        expect(result).toEqual([]);
    });
});

// ── parseReviewFindings ─────────────────────────────────────────

describe('parseReviewFindings', () => {
    it('should parse a JSON array of findings', () => {
        const response = JSON.stringify([
            {
                severity: 'error',
                category: 'bug',
                filePath: 'src/main.ts',
                line: 10,
                description: 'Null pointer risk',
                suggestion: 'Add null check',
            },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
        expect(comments[0].severity).toBe('error');
        expect(comments[0].category).toBe('bug');
        expect(comments[0].filePath).toBe('src/main.ts');
        expect(comments[0].lineRange).toEqual({ startLine: 10, endLine: 10 });
        expect(comments[0].description).toBe('Null pointer risk');
        expect(comments[0].suggestion).toBe('Add null check');
        expect(comments[0].author.isAI).toBe(true);
    });

    it('should parse an object with findings array', () => {
        const response = JSON.stringify({
            findings: [
                { severity: 'warning', filePath: 'a.ts', line: 5, description: 'Unused var' },
            ],
        });
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
        expect(comments[0].severity).toBe('warning');
    });

    it('should handle "comments" key', () => {
        const response = JSON.stringify({
            comments: [
                { severity: 'info', filePath: 'b.ts', line: 1, description: 'Consider refactor' },
            ],
        });
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
    });

    it('should handle "issues" key', () => {
        const response = JSON.stringify({
            issues: [
                { severity: 'suggestion', filePath: 'c.ts', line: 3, description: 'Typo' },
            ],
        });
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
    });

    it('should handle "violations" key', () => {
        const response = JSON.stringify({
            violations: [
                { severity: 'error', filePath: 'd.ts', line: 7, description: 'Security flaw' },
            ],
        });
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
    });

    it('should handle a single finding object', () => {
        const response = JSON.stringify({
            severity: 'warning',
            filePath: 'e.ts',
            line: 20,
            description: 'Perf issue',
        });
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
    });

    it('should skip findings without filePath', () => {
        const response = JSON.stringify([
            { severity: 'error', description: 'No file' },
            { severity: 'error', filePath: 'f.ts', description: 'Has file' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
        expect(comments[0].filePath).toBe('f.ts');
    });

    it('should skip findings without description', () => {
        const response = JSON.stringify([
            { severity: 'error', filePath: 'g.ts' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(0);
    });

    it('should use "file" as fallback for "filePath"', () => {
        const response = JSON.stringify([
            { severity: 'info', file: 'h.ts', line: 1, description: 'Note' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
        expect(comments[0].filePath).toBe('h.ts');
    });

    it('should normalize unknown severity to info', () => {
        const response = JSON.stringify([
            { severity: 'unknown', filePath: 'i.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].severity).toBe('info');
    });

    it('should normalize "critical" severity to error', () => {
        const response = JSON.stringify([
            { severity: 'critical', filePath: 'j.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].severity).toBe('error');
    });

    it('should normalize "medium" severity to warning', () => {
        const response = JSON.stringify([
            { severity: 'medium', filePath: 'k.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].severity).toBe('warning');
    });

    it('should normalize unknown category to general', () => {
        const response = JSON.stringify([
            { severity: 'info', category: 'mystery', filePath: 'l.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].category).toBe('general');
    });

    it('should normalize category from partial match', () => {
        const response = JSON.stringify([
            { severity: 'info', category: 'security-issue', filePath: 'm.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].category).toBe('security');
    });

    it('should handle line range with endLine', () => {
        const response = JSON.stringify([
            { severity: 'info', filePath: 'n.ts', line: 5, endLine: 10, description: 'multi-line' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].lineRange).toEqual({ startLine: 5, endLine: 10 });
    });

    it('should invoke onComment callback for each parsed comment', () => {
        const onComment = vi.fn();
        const response = JSON.stringify([
            { severity: 'info', filePath: 'o.ts', description: 'first' },
            { severity: 'warning', filePath: 'p.ts', description: 'second' },
        ]);
        const comments = parseReviewFindings(response, onComment);
        expect(comments).toHaveLength(2);
        expect(onComment).toHaveBeenCalledTimes(2);
        expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'o.ts' }));
        expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'p.ts' }));
    });

    it('should return empty for empty array response', () => {
        const comments = parseReviewFindings('[]');
        expect(comments).toHaveLength(0);
    });

    it('should return empty for unparseable response', () => {
        const comments = parseReviewFindings('No issues found. The code looks good.');
        expect(comments).toHaveLength(0);
    });

    it('should extract from markdown-fenced response', () => {
        const response = 'Here are the findings:\n```json\n[{"severity": "error", "filePath": "x.ts", "description": "bug"}]\n```';
        const comments = parseReviewFindings(response);
        expect(comments).toHaveLength(1);
    });

    it('should default missing severity and category', () => {
        const response = JSON.stringify([
            { filePath: 'z.ts', description: 'something' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].severity).toBe('info');
        expect(comments[0].category).toBe('general');
    });

    it('should populate author as AI', () => {
        const response = JSON.stringify([
            { filePath: 'a.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].author).toEqual({ name: 'AI Code Review', isAI: true });
    });

    it('should generate unique IDs', () => {
        const response = JSON.stringify([
            { filePath: 'a.ts', description: 'one' },
            { filePath: 'b.ts', description: 'two' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].id).not.toBe(comments[1].id);
    });

    it('should set createdAt and updatedAt', () => {
        const response = JSON.stringify([
            { filePath: 'a.ts', description: 'test' },
        ]);
        const comments = parseReviewFindings(response);
        expect(comments[0].createdAt).toBeTruthy();
        expect(comments[0].updatedAt).toBeTruthy();
    });
});

// ── AIReviewer ───────────────────────────────────────────────

describe('AIReviewer', () => {
    describe('constructor', () => {
        it('should set the name to "AI Code Review"', () => {
            const reviewer = new AIReviewer(makeConfig());
            expect(reviewer.name).toBe('AI Code Review');
        });
    });

    describe('review', () => {
        it('should call sdkService.sendMessage with correct prompt', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });
            const source = makeCommitSource();

            await reviewer.review(source);

            expect(sdkService.sendMessage).toHaveBeenCalledTimes(1);
            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.prompt).toContain('commit abc123');
            expect(opts.prompt).toContain('/repo');
            expect(opts.workingDirectory).toBe('/repo');
            expect(opts.streaming).toBe(true);
            expect(opts.mode).toBe('autopilot');
        });

        it('should use workingDirectory from config when provided', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, workingDirectory: '/custom' });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.workingDirectory).toBe('/custom');
        });

        it('should pass model from config', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, model: 'gpt-5' });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.model).toBe('gpt-5');
        });

        it('should pass skillDirectories from config', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, skillDirectories: ['/skills'] });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.skillDirectories).toEqual(['/skills']);
        });

        it('should pass disabledSkills from config', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, disabledSkills: ['some-skill'] });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.disabledSkills).toEqual(['some-skill']);
        });

        it('should append system prompt when configured', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, systemPromptAppend: 'Extra instructions' });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.systemMessage).toEqual({
                mode: 'append',
                content: 'Extra instructions',
            });
        });

        it('should parse findings from response', async () => {
            const findings = [
                { severity: 'error', filePath: 'main.ts', line: 10, description: 'Bug' },
                { severity: 'warning', filePath: 'util.ts', line: 5, description: 'Perf issue' },
            ];
            const sdkService = makeMockSdkService({
                success: true,
                response: JSON.stringify(findings),
            });
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.comments).toHaveLength(2);
            expect(result.comments[0].filePath).toBe('main.ts');
            expect(result.comments[1].filePath).toBe('util.ts');
            expect(result.stats.totalComments).toBe(2);
            expect(result.stats.bySeverity.error).toBe(1);
            expect(result.stats.bySeverity.warning).toBe(1);
        });

        it('should stream comments via onComment callback', async () => {
            const onComment = vi.fn();
            const findings = [
                { severity: 'info', filePath: 'a.ts', description: 'Note 1' },
                { severity: 'info', filePath: 'b.ts', description: 'Note 2' },
            ];
            const sdkService = makeMockSdkService({
                success: true,
                response: JSON.stringify(findings),
            });
            const reviewer = new AIReviewer({ sdkService });

            await reviewer.review(makeCommitSource(), { onComment });

            expect(onComment).toHaveBeenCalledTimes(2);
        });

        it('should return empty result on failed invocation', async () => {
            const sdkService = makeMockSdkService({
                success: false,
                error: 'SDK error',
                response: undefined,
            });
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toContain('AI review failed');
            expect(result.summaryText).toContain('SDK error');
        });

        it('should return empty result on missing response', async () => {
            const sdkService = makeMockSdkService({
                success: true,
                response: undefined,
            });
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toContain('AI review failed');
        });

        it('should handle SDK exception', async () => {
            const sdkService = {
                sendMessage: vi.fn().mockRejectedValue(new Error('Connection lost')),
            } as unknown as AIReviewerConfig['sdkService'];
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toContain('AI review error');
            expect(result.summaryText).toContain('Connection lost');
        });

        it('should return cancelled result when signal is pre-aborted', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });
            const controller = new AbortController();
            controller.abort();

            const result = await reviewer.review(makeCommitSource(), { signal: controller.signal });

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toContain('cancelled');
            expect(sdkService.sendMessage).not.toHaveBeenCalled();
        });

        it('should return cancelled result when aborted during execution', async () => {
            const controller = new AbortController();
            const sdkService = {
                sendMessage: vi.fn().mockImplementation(async () => {
                    controller.abort();
                    throw new Error('Aborted');
                }),
            } as unknown as AIReviewerConfig['sdkService'];
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource(), { signal: controller.signal });

            expect(result.comments).toHaveLength(0);
            expect(result.summaryText).toContain('cancelled');
        });

        it('should pass signal to sendMessage', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });
            const controller = new AbortController();

            await reviewer.review(makeCommitSource(), { signal: controller.signal });

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.signal).toBe(controller.signal);
        });

        it('should include file filter in prompt when specified', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });

            await reviewer.review(makeCommitSource(), { filePaths: ['src/a.ts', 'src/b.ts'] });

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.prompt).toContain('src/a.ts');
            expect(opts.prompt).toContain('src/b.ts');
        });

        it('should derive correct assessment', async () => {
            const findings = [
                { severity: 'error', filePath: 'a.ts', description: 'Bug' },
            ];
            const sdkService = makeMockSdkService({
                success: true,
                response: JSON.stringify(findings),
            });
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.assessment).toBe('fail');
        });

        it('should set source on result', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });
            const source = makeCommitSource({ commitHash: 'def456' });

            const result = await reviewer.review(source);

            expect(result.source).toBe(source);
        });

        it('should set timestamps on result', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.startedAt).toBeTruthy();
            expect(result.completedAt).toBeTruthy();
            expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
                new Date(result.completedAt).getTime(),
            );
        });

        it('should handle empty array response', async () => {
            const sdkService = makeMockSdkService({
                success: true,
                response: '[]',
            });
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.comments).toHaveLength(0);
            expect(result.assessment).toBe('pass');
        });

        it('should handle range diff source in prompt', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });

            await reviewer.review(makeRangeSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.prompt).toContain('range origin/main..feature-branch');
        });

        it('should handle working-tree diff source in prompt', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService });

            await reviewer.review(makeWorkingTreeSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.prompt).toContain('staged working tree changes');
        });

        it('should pass timeout from config', async () => {
            const sdkService = makeMockSdkService();
            const reviewer = new AIReviewer({ sdkService, timeoutMs: 60000 });

            await reviewer.review(makeCommitSource());

            const opts = (sdkService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(opts.timeoutMs).toBe(60000);
        });

        it('should handle non-Error exceptions', async () => {
            const sdkService = {
                sendMessage: vi.fn().mockRejectedValue('string error'),
            } as unknown as AIReviewerConfig['sdkService'];
            const reviewer = new AIReviewer({ sdkService });

            const result = await reviewer.review(makeCommitSource());

            expect(result.summaryText).toContain('string error');
        });
    });
});
