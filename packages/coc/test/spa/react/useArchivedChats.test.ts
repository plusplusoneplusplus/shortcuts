/**
 * Tests for useArchivedChats hook.
 *
 * Validates source structure: preference fetch on mount,
 * archive/unarchive operations, and persistence via PATCH.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'useArchivedChats.ts'
);

describe('useArchivedChats', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports useArchivedChats as a named function', () => {
            expect(source).toContain('export function useArchivedChats');
        });

        it('exports UseArchivedChatsResult interface', () => {
            expect(source).toContain('export interface UseArchivedChatsResult');
        });
    });

    describe('hook signature', () => {
        it('accepts workspaceId parameter', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional onUnpin callback', () => {
            expect(source).toContain('onUnpin?: (id: string) => void');
        });

        it('returns archiveSet as Set<string>', () => {
            expect(source).toContain('archiveSet: Set<string>');
        });

        it('returns isArchived function', () => {
            expect(source).toContain('isArchived: (id: string) => boolean');
        });

        it('returns toggleArchive function', () => {
            expect(source).toContain('toggleArchive: (id: string) => void');
        });
    });

    describe('preferences fetch', () => {
        it('fetches preferences on mount', () => {
            expect(source).toContain("fetchApi('/preferences')");
        });

        it('extracts archivedChats from preferences', () => {
            expect(source).toContain('archivedChats');
        });

        it('uses workspace-scoped archive IDs', () => {
            expect(source).toContain('[workspaceId]');
        });

        it('handles fetch error gracefully', () => {
            expect(source).toContain('.catch(');
            expect(source).toContain('setArchivedIds([])');
        });
    });

    describe('archive/unarchive logic', () => {
        it('toggleArchive adds new ID to front of array (newest-first)', () => {
            expect(source).toContain('[id, ...prev]');
        });

        it('toggleArchive removes existing ID when already archived', () => {
            expect(source).toContain('prev.filter(a => a !== id)');
        });

        it('persists via PATCH /preferences', () => {
            expect(source).toContain("method: 'PATCH'");
            expect(source).toContain("'/preferences'");
        });

        it('sends archivedChats in PATCH body', () => {
            expect(source).toContain('JSON.stringify({ archivedChats');
        });

        it('cleans up workspace key when no archives remain', () => {
            expect(source).toContain('delete updated[workspaceId]');
        });

        it('auto-unpins when archiving a session', () => {
            expect(source).toContain('onUnpin(id)');
        });

        it('does not unpin when unarchiving', () => {
            expect(source).toContain('!isCurrentlyArchived && onUnpin');
        });
    });

    describe('state management', () => {
        it('tracks all-workspace archives in a ref', () => {
            expect(source).toContain('allArchivedRef');
        });

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
    });
});
