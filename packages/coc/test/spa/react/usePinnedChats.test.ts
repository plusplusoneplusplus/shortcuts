/**
 * Tests for usePinnedChats hook.
 *
 * Validates the hook's source structure: preference fetch on mount,
 * pin/unpin operations, session partitioning, and persistence via PATCH.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'usePinnedChats.ts'
);

describe('usePinnedChats', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports usePinnedChats as a named function', () => {
            expect(source).toContain('export function usePinnedChats');
        });

        it('exports UsePinnedChatsResult interface', () => {
            expect(source).toContain('export interface UsePinnedChatsResult');
        });
    });

    describe('hook signature', () => {
        it('accepts workspaceId parameter', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('returns pinnedIds array', () => {
            expect(source).toContain('pinnedIds: string[]');
        });

        it('returns isPinned function', () => {
            expect(source).toContain('isPinned: (id: string) => boolean');
        });

        it('returns togglePin function', () => {
            expect(source).toContain('togglePin: (id: string) => void');
        });

        it('returns partitionSessions function', () => {
            expect(source).toContain('partitionSessions: (sessions: ChatSessionItem[])');
        });
    });

    describe('preferences fetch', () => {
        it('fetches per-workspace preferences on mount', () => {
            expect(source).toContain("fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/preferences')");
        });

        it('extracts pinnedChats from preferences', () => {
            expect(source).toContain('pinnedChats');
        });

        it('uses workspace-scoped pin IDs', () => {
            expect(source).toContain('[workspaceId]');
        });

        it('handles fetch error gracefully', () => {
            expect(source).toContain('.catch(');
            expect(source).toContain('setPinnedIds([])');
        });
    });

    describe('pin/unpin logic', () => {
        it('togglePin adds new ID to front of array (newest-first)', () => {
            expect(source).toContain('[id, ...prev]');
        });

        it('togglePin removes existing ID', () => {
            expect(source).toContain('prev.filter(p => p !== id)');
        });

        it('persists via PATCH to workspace preferences', () => {
            expect(source).toContain("method: 'PATCH'");
            expect(source).toContain("'/workspaces/' + encodeURIComponent(workspaceId) + '/preferences'");
        });

        it('sends updated pinnedChats array in PATCH body', () => {
            expect(source).toContain('JSON.stringify({ pinnedChats');
        });

        it('pin/unpin is reflected in the sent array', () => {
            // The next array (updated IDs) is what gets sent
            expect(source).toContain('body: JSON.stringify({ pinnedChats: next })');
        });
    });

    describe('session partitioning', () => {
        it('defines partitionSessions function', () => {
            expect(source).toContain('const partitionSessions = useCallback');
        });

        it('returns pinned and unpinned groups', () => {
            expect(source).toContain('pinned: ChatSessionItem[]');
            expect(source).toContain('unpinned: ChatSessionItem[]');
        });

        it('preserves pin order from pinnedIds', () => {
            // Pinned sessions are mapped in pinnedIds order, not session list order
            expect(source).toContain('validPinnedIds');
            expect(source).toContain('.map(id => pinnedMap.get(id))');
        });

        it('prunes stale pin IDs that do not match any session', () => {
            expect(source).toContain('sessionIdSet.has(id)');
        });
    });

    describe('state management', () => {
        it('uses mountedRef to prevent state updates after unmount', () => {
            expect(source).toContain('mountedRef');
            expect(source).toContain('mountedRef.current = false');
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

        it('imports fetchApi', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('imports ChatSessionItem type', () => {
            expect(source).toContain("import type { ChatSessionItem } from '../types/dashboard'");
        });
    });
});
