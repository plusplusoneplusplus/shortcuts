/**
 * Tests for ProcessSummary payload completeness.
 * Verifies that toProcessSummary() preserves the fields the SPA notification system needs.
 */

import { describe, it, expect } from 'vitest';
import { toProcessSummary, type ProcessSummary } from '@plusplusoneplusplus/coc-server';

// Minimal AIProcess-like object with all required fields.
function makeAIProcess(overrides: Record<string, any> = {}): any {
    return {
        id: 'proc-1',
        type: 'code-review',
        promptPreview: 'Review auth module',
        fullPrompt: 'Full prompt text here that is very long ...',
        status: 'completed',
        startTime: new Date('2025-06-01T10:00:00Z'),
        endTime: new Date('2025-06-01T10:00:42Z'),
        error: undefined,
        result: 'Some long result',
        metadata: { type: 'code-review', workspaceId: 'ws-abc123' },
        ...overrides,
    };
}

describe('toProcessSummary — field completeness for notifications', () => {
    it('includes promptPreview in summary', () => {
        const summary = toProcessSummary(makeAIProcess({ promptPreview: 'Summarize code' }));
        expect(summary.promptPreview).toBe('Summarize code');
    });

    it('includes endTime as ISO string on completed process', () => {
        const summary = toProcessSummary(makeAIProcess({
            status: 'completed',
            endTime: new Date('2025-06-01T10:00:42Z'),
        }));
        expect(summary.endTime).toBe('2025-06-01T10:00:42.000Z');
    });

    it('endTime is undefined when process has no endTime', () => {
        const summary = toProcessSummary(makeAIProcess({ endTime: undefined }));
        expect(summary.endTime).toBeUndefined();
    });

    it('includes workspaceId from metadata', () => {
        const summary = toProcessSummary(makeAIProcess({
            metadata: { type: 'code-review', workspaceId: 'frontend' },
        }));
        expect(summary.workspaceId).toBe('frontend');
    });

    it('workspaceId is undefined when metadata has no workspaceId', () => {
        const summary = toProcessSummary(makeAIProcess({
            metadata: { type: 'code-review' },
        }));
        expect(summary.workspaceId).toBeUndefined();
    });

    it('workspaceId is undefined when metadata is missing', () => {
        const summary = toProcessSummary(makeAIProcess({ metadata: undefined }));
        expect(summary.workspaceId).toBeUndefined();
    });

    it('includes startTime as ISO string', () => {
        const summary = toProcessSummary(makeAIProcess({
            startTime: new Date('2025-06-01T10:00:00Z'),
        }));
        expect(summary.startTime).toBe('2025-06-01T10:00:00.000Z');
    });

    it('strips large fields (fullPrompt, result)', () => {
        const summary = toProcessSummary(makeAIProcess()) as Record<string, any>;
        expect(summary.fullPrompt).toBeUndefined();
        expect(summary.result).toBeUndefined();
    });
});
