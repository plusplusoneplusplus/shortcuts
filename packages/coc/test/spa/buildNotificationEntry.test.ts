/**
 * Tests for buildNotificationEntry — pure utility that maps process payloads
 * to notification entry inputs.
 */

import { describe, it, expect } from 'vitest';
import {
    buildNotificationEntry,
    type ProcessLike,
} from '../../src/server/spa/client/react/utils/build-notification-entry';

function makeProcess(overrides: Partial<ProcessLike> = {}): ProcessLike {
    return {
        id: 'proc-1',
        status: 'completed',
        promptPreview: 'Summarize code',
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-01-01T00:00:42.000Z',
        metadata: { workspaceId: 'frontend' },
        ...overrides,
    };
}

describe('buildNotificationEntry', () => {
    it('completed process → success type', () => {
        const result = buildNotificationEntry(makeProcess({ status: 'completed' }));
        expect(result.type).toBe('success');
    });

    it('failed process → error type', () => {
        const result = buildNotificationEntry(makeProcess({ status: 'failed' }));
        expect(result.type).toBe('error');
    });

    it('cancelled process → warning type', () => {
        const result = buildNotificationEntry(makeProcess({ status: 'cancelled' }));
        expect(result.type).toBe('warning');
    });

    it('duration calculated correctly', () => {
        const result = buildNotificationEntry(makeProcess({
            startTime: '2025-01-01T00:00:00.000Z',
            endTime: '2025-01-01T00:00:42.000Z',
        }));
        expect(result.detail).toContain('42s');
    });

    it('missing endTime omits duration', () => {
        const result = buildNotificationEntry(makeProcess({ endTime: undefined }));
        expect(result.detail).not.toMatch(/\d+s/);
    });

    it('workspaceId included in detail', () => {
        const result = buildNotificationEntry(makeProcess({ metadata: { workspaceId: 'frontend' } }));
        expect(result.detail).toContain('frontend');
    });

    it('missing workspaceId omits workspace', () => {
        const result = buildNotificationEntry(makeProcess({ metadata: undefined }));
        expect(result.detail).not.toContain('frontend');
    });

    it('null promptPreview falls back to "Run"', () => {
        const result = buildNotificationEntry(makeProcess({ promptPreview: null }));
        expect(result.title).toMatch(/^Run /);
    });

    it('processId set to process.id', () => {
        const result = buildNotificationEntry(makeProcess({ id: 'abc-123' }));
        expect(result.processId).toBe('abc-123');
    });

    it('duration and workspaceId joined with " · "', () => {
        const result = buildNotificationEntry(makeProcess());
        expect(result.detail).toBe('42s · frontend');
    });

    it('unknown status maps to info type', () => {
        const result = buildNotificationEntry(makeProcess({ status: 'unknown' }));
        expect(result.type).toBe('info');
    });
});
