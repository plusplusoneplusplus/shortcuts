/**
 * Container Session Store Tests
 *
 * Unit tests for `ContainerSessionStore` — SQLite CRUD operations.
 * Uses in-memory SQLite databases (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ContainerSessionStore } from '../../../src/server/container-sessions/container-session-store';
import type { ContainerSessionTurn } from '../../../src/server/container-sessions/container-session-types';

// ============================================================================
// Helpers
// ============================================================================

function createDb(): Database.Database {
    return new Database(':memory:');
}

function makeTurn(overrides: Partial<ContainerSessionTurn> = {}): ContainerSessionTurn {
    return {
        index: overrides.index ?? 0,
        role: overrides.role ?? 'user',
        content: overrides.content ?? 'Hello',
        routing: overrides.routing ?? {
            agentId: 'agent-1',
            workspaceId: 'ws-1',
            confidence: 0.9,
            reason: 'test',
        },
        downstreamProcessId: overrides.downstreamProcessId ?? null,
        timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ContainerSessionStore', () => {
    let db: Database.Database;
    let store: ContainerSessionStore;

    beforeEach(() => {
        db = createDb();
        store = new ContainerSessionStore(db);
    });

    describe('create', () => {
        it('creates a session with active status', () => {
            const session = store.create('csess_test1');
            expect(session.id).toBe('csess_test1');
            expect(session.status).toBe('active');
            expect(session.routingOverride).toBeNull();
            expect(session.turns).toEqual([]);
            expect(session.createdAt).toBeTruthy();
            expect(session.updatedAt).toBeTruthy();
        });

        it('rejects duplicate IDs', () => {
            store.create('csess_dup');
            expect(() => store.create('csess_dup')).toThrow();
        });
    });

    describe('get', () => {
        it('returns null for non-existent session', () => {
            expect(store.get('nonexistent')).toBeNull();
        });

        it('returns session with turns', () => {
            store.create('csess_turns');
            store.addTurn('csess_turns', makeTurn({ index: 0, content: 'Hello' }));
            store.addTurn('csess_turns', makeTurn({ index: 1, role: 'assistant', content: 'Hi there' }));

            const session = store.get('csess_turns');
            expect(session).not.toBeNull();
            expect(session!.turns).toHaveLength(2);
            expect(session!.turns[0].content).toBe('Hello');
            expect(session!.turns[1].content).toBe('Hi there');
        });
    });

    describe('list', () => {
        it('returns sessions ordered by most recent', () => {
            store.create('csess_old');
            store.create('csess_new');
            // Update csess_new to have a later timestamp
            store.addTurn('csess_new', makeTurn({ timestamp: '2026-12-01T00:00:00.000Z' }));

            const sessions = store.list();
            expect(sessions.length).toBe(2);
            // Most recent first (csess_new has later updatedAt)
            expect(sessions[0].id).toBe('csess_new');
        });

        it('respects limit and offset', () => {
            store.create('csess_1');
            store.create('csess_2');
            store.create('csess_3');

            const page = store.list(2, 1);
            expect(page.length).toBe(2);
        });
    });

    describe('addTurn', () => {
        it('adds a turn and updates session timestamp', () => {
            const session = store.create('csess_addturn');
            const originalUpdated = session.updatedAt;

            // Small delay to ensure timestamp differs
            const turn = makeTurn({ timestamp: '2026-06-01T00:00:00.000Z' });
            store.addTurn('csess_addturn', turn);

            const updated = store.get('csess_addturn');
            expect(updated!.turns).toHaveLength(1);
            expect(updated!.updatedAt).toBe('2026-06-01T00:00:00.000Z');
        });

        it('stores routing metadata', () => {
            store.create('csess_routing');
            store.addTurn('csess_routing', makeTurn({
                routing: { agentId: 'a1', workspaceId: 'w1', confidence: 0.85, reason: 'matched path' },
            }));

            const session = store.get('csess_routing');
            expect(session!.turns[0].routing.agentId).toBe('a1');
            expect(session!.turns[0].routing.confidence).toBe(0.85);
            expect(session!.turns[0].routing.reason).toBe('matched path');
        });
    });

    describe('updateTurnProcessId', () => {
        it('updates downstream process ID on a turn', () => {
            store.create('csess_pid');
            store.addTurn('csess_pid', makeTurn({ index: 0 }));
            store.updateTurnProcessId('csess_pid', 0, 'proc_downstream');

            const session = store.get('csess_pid');
            expect(session!.turns[0].downstreamProcessId).toBe('proc_downstream');
        });
    });

    describe('setRoutingOverride', () => {
        it('sets a routing override', () => {
            store.create('csess_override');
            store.setRoutingOverride('csess_override', { agentId: 'a2', workspaceId: 'w2' });

            const session = store.get('csess_override');
            expect(session!.routingOverride).toEqual({ agentId: 'a2', workspaceId: 'w2' });
        });

        it('clears a routing override', () => {
            store.create('csess_clear');
            store.setRoutingOverride('csess_clear', { agentId: 'a2', workspaceId: 'w2' });
            store.setRoutingOverride('csess_clear', null);

            const session = store.get('csess_clear');
            expect(session!.routingOverride).toBeNull();
        });
    });

    describe('close', () => {
        it('closes a session', () => {
            store.create('csess_close');
            store.close('csess_close');

            const session = store.get('csess_close');
            expect(session!.status).toBe('closed');
        });
    });

    describe('delete', () => {
        it('deletes a session and returns true', () => {
            store.create('csess_del');
            store.addTurn('csess_del', makeTurn());

            const deleted = store.delete('csess_del');
            expect(deleted).toBe(true);
            expect(store.get('csess_del')).toBeNull();
        });

        it('returns false for non-existent session', () => {
            expect(store.delete('nonexistent')).toBe(false);
        });
    });

    describe('turnCount', () => {
        it('returns 0 for empty session', () => {
            store.create('csess_empty');
            expect(store.turnCount('csess_empty')).toBe(0);
        });

        it('returns correct count', () => {
            store.create('csess_cnt');
            store.addTurn('csess_cnt', makeTurn({ index: 0 }));
            store.addTurn('csess_cnt', makeTurn({ index: 1 }));
            store.addTurn('csess_cnt', makeTurn({ index: 2 }));
            expect(store.turnCount('csess_cnt')).toBe(3);
        });
    });
});
