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

    it('includes workspaceName from metadata', () => {
        const summary = toProcessSummary(makeAIProcess({
            metadata: { type: 'code-review', workspaceId: 'ws-abc', workspaceName: 'MyRepo' },
        }));
        expect(summary.workspaceName).toBe('MyRepo');
    });

    it('workspaceName is undefined when metadata has no workspaceName', () => {
        const summary = toProcessSummary(makeAIProcess({
            metadata: { type: 'code-review', workspaceId: 'ws-abc' },
        }));
        expect(summary.workspaceName).toBeUndefined();
    });

    it('includes workingDirectory when present on process', () => {
        const summary = toProcessSummary(makeAIProcess({ workingDirectory: '/home/user/my-repo' }));
        expect(summary.workingDirectory).toBe('/home/user/my-repo');
    });

    it('workingDirectory is undefined when not set on process', () => {
        const summary = toProcessSummary(makeAIProcess({ workingDirectory: undefined }));
        expect(summary.workingDirectory).toBeUndefined();
    });

    it('includes lastEventAt as ISO string when present', () => {
        const summary = toProcessSummary(makeAIProcess({
            lastEventAt: new Date('2026-04-01T12:00:00Z'),
        }));
        expect(summary.lastEventAt).toBe('2026-04-01T12:00:00.000Z');
    });

    it('lastEventAt is undefined when not set on process', () => {
        const summary = toProcessSummary(makeAIProcess({ lastEventAt: undefined }));
        expect(summary.lastEventAt).toBeUndefined();
    });

    it('includes pendingAskUserCount when the process is awaiting interactive input', () => {
        const summary = toProcessSummary(makeAIProcess({
            status: 'running',
            pendingAskUser: [
                { batchId: 'b', questionId: 'q1' },
                { batchId: 'b', questionId: 'q2' },
            ],
        }));
        expect(summary.pendingAskUserCount).toBe(2);
    });

    it('reports pendingAskUserCount as 0 when no questions are pending', () => {
        const summary = toProcessSummary(makeAIProcess({ pendingAskUser: undefined }));
        expect(summary.pendingAskUserCount).toBe(0);
    });

    it('reports pendingAskUserCount as 0 for an empty pendingAskUser array', () => {
        const summary = toProcessSummary(makeAIProcess({ pendingAskUser: [] }));
        expect(summary.pendingAskUserCount).toBe(0);
    });

    // Compaction state must reach the client so the chat-list sidebar can bucket a
    // mid-`/compact` conversation under RUNNING TASKS (compact-running-in-chat-list).
    it('forwards in-flight compaction state from process metadata', () => {
        const summary = toProcessSummary(makeAIProcess({
            status: 'running',
            metadata: {
                type: 'chat',
                workspaceId: 'ws-abc',
                compaction: { state: 'running', priorStatus: 'completed', startedAt: '2026-06-01T10:00:00Z' },
            },
        }));
        expect(summary.compaction?.state).toBe('running');
        expect(summary.compaction?.priorStatus).toBe('completed');
    });

    it('forwards settled compaction state (completed) so the client can release the running row', () => {
        const summary = toProcessSummary(makeAIProcess({
            status: 'completed',
            metadata: {
                type: 'chat',
                workspaceId: 'ws-abc',
                compaction: { state: 'completed', priorStatus: 'completed', startedAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T10:00:05Z' },
            },
        }));
        expect(summary.compaction?.state).toBe('completed');
    });

    it('compaction is undefined when the process never ran /compact', () => {
        const summary = toProcessSummary(makeAIProcess({ metadata: { type: 'chat', workspaceId: 'ws-abc' } }));
        expect(summary.compaction).toBeUndefined();
    });
});
