/**
 * Tests for ConversationSessionManager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationSessionManager } from '../../src/server/conversation-session-manager';
import type { AskAIFunction } from '../../src/server/ask-handler';

// ============================================================================
// Helpers
// ============================================================================

function createMockSendMessage(): ReturnType<typeof vi.fn> & AskAIFunction {
    return vi.fn().mockResolvedValue('AI response') as any;
}

function createManager(overrides?: {
    sendMessage?: AskAIFunction;
    idleTimeoutMs?: number;
    maxSessions?: number;
    cleanupIntervalMs?: number;
}): ConversationSessionManager {
    return new ConversationSessionManager({
        sendMessage: overrides?.sendMessage ?? createMockSendMessage(),
        idleTimeoutMs: overrides?.idleTimeoutMs ?? 600000,
        maxSessions: overrides?.maxSessions ?? 5,
        cleanupIntervalMs: overrides?.cleanupIntervalMs ?? 60000,
    });
}

// ============================================================================
// Session Creation
// ============================================================================

describe('ConversationSessionManager', () => {
    let manager: ConversationSessionManager;

    afterEach(() => {
        if (manager) {
            manager.destroyAll();
        }
    });

    describe('create()', () => {
        it('should create a session with a unique ID', () => {
            manager = createManager();
            const session = manager.create();
            expect(session).not.toBeNull();
            expect(session!.sessionId).toBeDefined();
            expect(typeof session!.sessionId).toBe('string');
            expect(session!.sessionId.length).toBe(12);
        });

        it('should initialize session with correct defaults', () => {
            manager = createManager();
            const session = manager.create()!;
            expect(session.turnCount).toBe(0);
            expect(session.busy).toBe(false);
            expect(session.lastUsedAt).toBeLessThanOrEqual(Date.now());
            expect(session.createdAt).toBeLessThanOrEqual(Date.now());
        });

        it('should create unique IDs for multiple sessions', () => {
            manager = createManager();
            const s1 = manager.create()!;
            const s2 = manager.create()!;
            expect(s1.sessionId).not.toBe(s2.sessionId);
        });

        it('should increment size for each created session', () => {
            manager = createManager();
            expect(manager.size).toBe(0);
            manager.create();
            expect(manager.size).toBe(1);
            manager.create();
            expect(manager.size).toBe(2);
        });

        it('should return null when max sessions reached and all are busy', () => {
            manager = createManager({ maxSessions: 2 });
            const s1 = manager.create()!;
            const s2 = manager.create()!;
            // Mark both busy so they can't be evicted
            s1.busy = true;
            s2.busy = true;
            const s3 = manager.create();
            expect(s3).toBeNull();
        });

        it('should evict oldest idle session when max reached', () => {
            manager = createManager({ maxSessions: 2 });
            const s1 = manager.create()!;
            const s2 = manager.create()!;
            // s1 is older, both are idle
            const s3 = manager.create();
            expect(s3).not.toBeNull();
            expect(manager.size).toBe(2);
            expect(manager.get(s1.sessionId)).toBeUndefined(); // evicted
            expect(manager.get(s2.sessionId)).toBeDefined();
        });
    });

    // ============================================================================
    // Session Retrieval
    // ============================================================================

    describe('get()', () => {
        it('should return an existing session', () => {
            manager = createManager();
            const created = manager.create()!;
            const retrieved = manager.get(created.sessionId);
            expect(retrieved).toBeDefined();
            expect(retrieved!.sessionId).toBe(created.sessionId);
        });

        it('should return undefined for non-existent session', () => {
            manager = createManager();
            expect(manager.get('nonexistent')).toBeUndefined();
        });
    });

    // ============================================================================
    // Sending Messages
    // ============================================================================

    describe('send()', () => {
        it('should send a message and return response', async () => {
            const mockSend = createMockSendMessage();
            manager = createManager({ sendMessage: mockSend });
            const session = manager.create()!;

            const result = await manager.send(session.sessionId, 'Hello');
            expect(result.response).toBe('AI response');
            expect(result.sessionId).toBe(session.sessionId);
            expect(mockSend).toHaveBeenCalledWith('Hello', expect.any(Object));
        });

        it('should increment turn count after send', async () => {
            manager = createManager();
            const session = manager.create()!;
            expect(session.turnCount).toBe(0);

            await manager.send(session.sessionId, 'Hello');
            expect(session.turnCount).toBe(1);

            await manager.send(session.sessionId, 'Follow-up');
            expect(session.turnCount).toBe(2);
        });

        it('should update lastUsedAt after send', async () => {
            manager = createManager();
            const session = manager.create()!;
            const before = session.lastUsedAt;

            // Small delay to ensure time difference
            await new Promise(r => setTimeout(r, 10));
            await manager.send(session.sessionId, 'Hello');
            expect(session.lastUsedAt).toBeGreaterThanOrEqual(before);
        });

        it('should throw for non-existent session', async () => {
            manager = createManager();
            await expect(manager.send('nonexistent', 'Hello'))
                .rejects.toThrow('Session not found: nonexistent');
        });

        it('should throw when session is busy', async () => {
            const slowSend = vi.fn().mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve('done'), 100)),
            );
            manager = createManager({ sendMessage: slowSend as any });
            const session = manager.create()!;

            // Start first send (don't await)
            const p1 = manager.send(session.sessionId, 'First');

            // Try concurrent send — should fail
            await expect(manager.send(session.sessionId, 'Second'))
                .rejects.toThrow('Session is busy');

            await p1; // cleanup
        });

        it('should release busy flag after send completes', async () => {
            manager = createManager();
            const session = manager.create()!;

            await manager.send(session.sessionId, 'Hello');
            expect(session.busy).toBe(false);
        });

        it('should release busy flag even on error', async () => {
            const failingSend = vi.fn().mockRejectedValue(new Error('AI error'));
            manager = createManager({ sendMessage: failingSend as any });
            const session = manager.create()!;

            await expect(manager.send(session.sessionId, 'Hello')).rejects.toThrow('AI error');
            expect(session.busy).toBe(false);
        });

        it('should pass options to sendMessage', async () => {
            const mockSend = createMockSendMessage();
            manager = createManager({ sendMessage: mockSend });
            const session = manager.create()!;
            const onChunk = vi.fn();

            await manager.send(session.sessionId, 'Hello', {
                model: 'gpt-4',
                workingDirectory: '/test',
                onStreamingChunk: onChunk,
            });

            expect(mockSend).toHaveBeenCalledWith('Hello', {
                model: 'gpt-4',
                workingDirectory: '/test',
                onStreamingChunk: onChunk,
            });
        });
    });

    // ============================================================================
    // Session Destruction
    // ============================================================================

    describe('destroy()', () => {
        it('should destroy an existing session', () => {
            manager = createManager();
            const session = manager.create()!;
            const result = manager.destroy(session.sessionId);
            expect(result).toBe(true);
            expect(manager.size).toBe(0);
            expect(manager.get(session.sessionId)).toBeUndefined();
        });

        it('should return false for non-existent session', () => {
            manager = createManager();
            expect(manager.destroy('nonexistent')).toBe(false);
        });
    });

    describe('destroyAll()', () => {
        it('should destroy all sessions', () => {
            manager = createManager();
            manager.create();
            manager.create();
            manager.create();
            expect(manager.size).toBe(3);

            manager.destroyAll();
            expect(manager.size).toBe(0);
        });
    });

    // ============================================================================
    // Session IDs
    // ============================================================================

    describe('sessionIds', () => {
        it('should return all session IDs', () => {
            manager = createManager();
            const s1 = manager.create()!;
            const s2 = manager.create()!;
            const ids = manager.sessionIds;
            expect(ids).toContain(s1.sessionId);
            expect(ids).toContain(s2.sessionId);
            expect(ids.length).toBe(2);
        });

        it('should return empty array when no sessions', () => {
            manager = createManager();
            expect(manager.sessionIds).toEqual([]);
        });
    });

    // ============================================================================
    // Idle Session Cleanup
    // ============================================================================

    describe('idle session cleanup', () => {
        it('should clean up sessions idle beyond timeout', async () => {
            manager = createManager({
                idleTimeoutMs: 50,
                cleanupIntervalMs: 25,
            });

            const session = manager.create()!;
            expect(manager.size).toBe(1);

            // Wait for cleanup to run
            await new Promise(r => setTimeout(r, 100));
            expect(manager.size).toBe(0);
            expect(manager.get(session.sessionId)).toBeUndefined();
        });

        it('should not clean up busy sessions', async () => {
            const slowSend = vi.fn().mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve('done'), 200)),
            );
            manager = createManager({
                sendMessage: slowSend as any,
                idleTimeoutMs: 50,
                cleanupIntervalMs: 25,
            });

            const session = manager.create()!;
            const sendPromise = manager.send(session.sessionId, 'Hello');

            // Wait for cleanup interval — session should survive because it's busy
            await new Promise(r => setTimeout(r, 100));
            expect(manager.size).toBe(1);

            await sendPromise; // cleanup
        });

        it('should not clean up recently used sessions', async () => {
            manager = createManager({
                idleTimeoutMs: 200,
                cleanupIntervalMs: 50,
            });

            manager.create();
            expect(manager.size).toBe(1);

            // Wait less than idle timeout
            await new Promise(r => setTimeout(r, 75));
            expect(manager.size).toBe(1); // still alive
        });
    });
});
