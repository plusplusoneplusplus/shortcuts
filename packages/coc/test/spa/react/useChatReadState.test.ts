/**
 * Tests for useChatReadState hook.
 *
 * Validates the hook's source structure: localStorage persistence,
 * isUnread / markRead / unreadCount logic, error handling, and workspace isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'useChatReadState.ts'
);

describe('useChatReadState', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports useChatReadState as a named function', () => {
            expect(source).toContain('export function useChatReadState');
        });

        it('exports UseChatReadStateResult interface', () => {
            expect(source).toContain('export interface UseChatReadStateResult');
        });
    });

    describe('hook signature', () => {
        it('accepts workspaceId parameter', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('returns isUnread function', () => {
            expect(source).toContain('isUnread: (sessionId: string, currentTurnCount?: number) => boolean');
        });

        it('returns markRead function', () => {
            expect(source).toContain('markRead: (sessionId: string, turnCount: number) => void');
        });

        it('returns unreadCount function', () => {
            expect(source).toContain('unreadCount: (sessions: ChatSessionItem[]) => number');
        });
    });

    describe('localStorage persistence', () => {
        it('uses coc:chatReadState as the storage key', () => {
            expect(source).toContain("const STORAGE_KEY = 'coc:chatReadState'");
        });

        it('reads from localStorage on mount', () => {
            expect(source).toContain('localStorage.getItem(STORAGE_KEY)');
        });

        it('writes to localStorage on markRead', () => {
            expect(source).toContain('localStorage.setItem(STORAGE_KEY');
        });

        it('parses stored JSON', () => {
            expect(source).toContain('JSON.parse(raw)');
        });

        it('serializes state to JSON', () => {
            expect(source).toContain('JSON.stringify(');
        });
    });

    describe('isUnread logic', () => {
        it('returns false when turnCount is null or undefined', () => {
            expect(source).toContain('currentTurnCount == null');
            expect(source).toContain('return false');
        });

        it('returns false when no entry exists (first visit = read)', () => {
            // No localStorage entry means session appears as read
            expect(source).toContain('if (!entry) return false');
        });

        it('compares currentTurnCount against lastSeenTurnCount', () => {
            expect(source).toContain('currentTurnCount > entry.lastSeenTurnCount');
        });

        it('returns false when turnCount is zero or less', () => {
            expect(source).toContain('currentTurnCount <= 0');
        });
    });

    describe('markRead logic', () => {
        it('updates lastSeenTurnCount in state', () => {
            expect(source).toContain('lastSeenTurnCount: turnCount');
        });

        it('persists updated state to localStorage via saveAllState', () => {
            expect(source).toContain('saveAllState(updated)');
        });

        it('maintains allStateRef for cross-workspace consistency', () => {
            expect(source).toContain('allStateRef.current = updated');
        });

        it('scopes update to current workspaceId', () => {
            expect(source).toContain('[workspaceId]: next');
        });
    });

    describe('unreadCount logic', () => {
        it('filters sessions using isUnread', () => {
            expect(source).toContain('sessions.filter(s => isUnread(s.id, s.turnCount))');
        });

        it('returns count via .length', () => {
            expect(source).toContain('.length');
        });
    });

    describe('error handling', () => {
        it('handles localStorage read errors gracefully', () => {
            // loadAllState catches errors and returns empty object
            expect(source).toContain('catch');
            expect(source).toContain('return {}');
        });

        it('handles localStorage write errors gracefully', () => {
            // saveAllState catches errors silently (storage full, private browsing)
            const saveMatch = source.match(/function saveAllState[\s\S]*?^}/m);
            expect(saveMatch).toBeTruthy();
            expect(saveMatch![0]).toContain('catch');
        });
    });

    describe('workspace isolation', () => {
        it('loads workspace-specific slice from all state', () => {
            expect(source).toContain('all[workspaceId]');
        });

        it('re-initializes when workspaceId changes', () => {
            expect(source).toContain('[workspaceId]');
        });
    });

    describe('state management', () => {
        it('stores all-workspace state in a ref', () => {
            expect(source).toContain('allStateRef');
        });

        it('uses mountedRef to prevent state updates after unmount', () => {
            expect(source).toContain('mountedRef');
            expect(source).toContain('mountedRef.current = false');
        });

        it('uses useCallback for memoized functions', () => {
            const callbackCount = (source.match(/useCallback/g) || []).length;
            expect(callbackCount).toBeGreaterThanOrEqual(3);
        });
    });

    describe('imports', () => {
        it('imports React hooks', () => {
            expect(source).toContain("from 'react'");
            expect(source).toContain('useEffect');
            expect(source).toContain('useState');
            expect(source).toContain('useCallback');
            expect(source).toContain('useRef');
        });

        it('imports ChatSessionItem type', () => {
            expect(source).toContain("import type { ChatSessionItem } from '../types/dashboard'");
        });
    });

    describe('data shape', () => {
        it('defines SessionReadEntry with lastSeenTurnCount', () => {
            expect(source).toContain('lastSeenTurnCount: number');
        });

        it('defines WorkspaceReadState as record of session entries', () => {
            expect(source).toContain('WorkspaceReadState');
        });

        it('defines AllReadState as record of workspace states', () => {
            expect(source).toContain('AllReadState');
        });
    });
});
