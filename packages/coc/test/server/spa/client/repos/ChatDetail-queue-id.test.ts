/**
 * @vitest-environment node
 *
 * Regression test: ChatDetail must strip the `queue_` prefix from
 * processId-style taskIds before calling typed queue-client task endpoints.
 *
 * The component's `taskId` prop may arrive with a `queue_` prefix (when
 * opened from the repos view), but queue task routes expect a bare task ID.
 * A shared `bareTaskId` constant handles the normalisation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isQueueProcessId, toTaskId, toQueueProcessId, ensureQueueProcessId } from '../../../../../src/server/spa/client/react/utils/queue-process-id';

// ---------------------------------------------------------------------------
// 1. queue-process-id utility functions
// ---------------------------------------------------------------------------

describe('queue-process-id utilities', () => {
    it('isQueueProcessId detects queue_ prefix', () => {
        expect(isQueueProcessId('queue_123')).toBe(true);
        expect(isQueueProcessId('123')).toBe(false);
        expect(isQueueProcessId('')).toBe(false);
    });

    it('toTaskId strips queue_ prefix', () => {
        expect(toTaskId('queue_abc-123')).toBe('abc-123');
    });

    it('toTaskId throws for bare IDs', () => {
        expect(() => toTaskId('abc-123')).toThrow('Expected process ID to start with');
    });

    it('toQueueProcessId adds queue_ prefix', () => {
        expect(toQueueProcessId('abc-123')).toBe('queue_abc-123');
    });

    it('ensureQueueProcessId is idempotent', () => {
        expect(ensureQueueProcessId('abc-123')).toBe('queue_abc-123');
        expect(ensureQueueProcessId('queue_abc-123')).toBe('queue_abc-123');
    });
});

// ---------------------------------------------------------------------------
// 2. bareTaskId derivation (mirrors component logic at line ~124)
// ---------------------------------------------------------------------------

describe('bareTaskId derivation', () => {
    function deriveBareTaskId(taskId: string): string {
        return isQueueProcessId(taskId) ? toTaskId(taskId) : taskId;
    }

    it('strips queue_ prefix from processId', () => {
        expect(deriveBareTaskId('queue_1776175353362-jj1p454')).toBe('1776175353362-jj1p454');
    });

    it('returns bare taskId unchanged', () => {
        expect(deriveBareTaskId('1776175353362-jj1p454')).toBe('1776175353362-jj1p454');
    });

    it('handles edge case: empty string', () => {
        expect(deriveBareTaskId('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// 3. Source-level regression guard: every queue-client task call in
//    ChatDetail must use `bareTaskId`, not raw `taskId`.
// ---------------------------------------------------------------------------

describe('ChatDetail source-level regression', () => {
    const src = readFileSync(
        resolve(__dirname, '../../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx'),
        'utf-8',
    );

    it('defines bareTaskId from taskId', () => {
        expect(src).toContain('const bareTaskId = isQueueProcessId(taskId) ? toTaskId(taskId) : taskId');
    });

    it('never passes raw taskId to typed queue task methods', () => {
        // AC-07: ChatDetail routes queue calls through the clone-aware client
        // (`useCocClient(workspaceId)` → `client.queue.*`), so match that call form.
        const queueTaskCallLines = src.split('\n').filter(line =>
            line.includes('client.queue.') && line.includes('taskId'),
        );

        for (const line of queueTaskCallLines) {
            // Lines that define bareTaskId or contain comments are OK
            if (line.includes('const bareTaskId') || line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
            // Every remaining queue task line must use bareTaskId, not raw taskId
            expect(line).toContain('bareTaskId');
            expect(line).not.toMatch(/[^e]taskId/); // must not have raw taskId (but bareTaskId is OK)
        }
    });

    it('handleCancel uses bareTaskId', () => {
        expect(src).toContain('client.queue.cancel(bareTaskId)');
    });

    it('handleMoveToTop uses bareTaskId', () => {
        expect(src).toContain('client.queue.moveToTop(bareTaskId)');
    });
});
