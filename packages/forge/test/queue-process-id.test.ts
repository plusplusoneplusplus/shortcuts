import { describe, it, expect } from 'vitest';
import {
    QUEUE_PROCESS_PREFIX,
    toQueueProcessId,
    toTaskId,
    isQueueProcessId,
    ensureQueueProcessId,
} from '../src/queue/types';

describe('queue process ID helpers', () => {
    describe('QUEUE_PROCESS_PREFIX', () => {
        it('is the string "queue_"', () => {
            expect(QUEUE_PROCESS_PREFIX).toBe('queue_');
        });
    });

    describe('toQueueProcessId', () => {
        it('prepends the prefix to a task ID', () => {
            expect(toQueueProcessId('abc123')).toBe('queue_abc123');
        });

        it('works with timestamp-style IDs', () => {
            expect(toQueueProcessId('1771242852770-g94u3ig')).toBe('queue_1771242852770-g94u3ig');
        });

        it('double-prefixes if given an already-prefixed ID (not idempotent)', () => {
            expect(toQueueProcessId('queue_abc')).toBe('queue_queue_abc');
        });

        it('handles empty string', () => {
            expect(toQueueProcessId('')).toBe('queue_');
        });
    });

    describe('toTaskId', () => {
        it('strips the prefix from a process ID', () => {
            expect(toTaskId('queue_abc123')).toBe('abc123');
        });

        it('strips only the leading prefix', () => {
            expect(toTaskId('queue_has_queue_inside')).toBe('has_queue_inside');
        });

        it('works with timestamp-style IDs', () => {
            expect(toTaskId('queue_1771242852770-g94u3ig')).toBe('1771242852770-g94u3ig');
        });

        it('throws when prefix is missing', () => {
            expect(() => toTaskId('abc123')).toThrow('Expected process ID to start with "queue_"');
        });

        it('throws for empty string', () => {
            expect(() => toTaskId('')).toThrow('Expected process ID to start with "queue_"');
        });

        it('returns empty string when ID is exactly the prefix', () => {
            expect(toTaskId('queue_')).toBe('');
        });
    });

    describe('isQueueProcessId', () => {
        it('returns true for prefixed IDs', () => {
            expect(isQueueProcessId('queue_abc123')).toBe(true);
        });

        it('returns false for unprefixed IDs', () => {
            expect(isQueueProcessId('abc123')).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isQueueProcessId('')).toBe(false);
        });

        it('returns false for partial prefix', () => {
            expect(isQueueProcessId('queue')).toBe(false);
        });

        it('returns true for just the prefix', () => {
            expect(isQueueProcessId('queue_')).toBe(true);
        });

        it('is case-sensitive', () => {
            expect(isQueueProcessId('Queue_abc')).toBe(false);
            expect(isQueueProcessId('QUEUE_abc')).toBe(false);
        });
    });

    describe('ensureQueueProcessId', () => {
        it('adds prefix when missing', () => {
            expect(ensureQueueProcessId('abc123')).toBe('queue_abc123');
        });

        it('does not double-prefix', () => {
            expect(ensureQueueProcessId('queue_abc123')).toBe('queue_abc123');
        });

        it('handles empty string (adds prefix)', () => {
            expect(ensureQueueProcessId('')).toBe('queue_');
        });

        it('handles just the prefix (no-op)', () => {
            expect(ensureQueueProcessId('queue_')).toBe('queue_');
        });
    });

    describe('round-trip', () => {
        it('toTaskId(toQueueProcessId(id)) === id', () => {
            const taskId = '1771242852770-g94u3ig';
            expect(toTaskId(toQueueProcessId(taskId))).toBe(taskId);
        });

        it('isQueueProcessId(toQueueProcessId(id)) is true', () => {
            expect(isQueueProcessId(toQueueProcessId('any-id'))).toBe(true);
        });

        it('ensureQueueProcessId(toQueueProcessId(id)) === toQueueProcessId(id)', () => {
            const processId = toQueueProcessId('task-1');
            expect(ensureQueueProcessId(processId)).toBe(processId);
        });
    });
});
