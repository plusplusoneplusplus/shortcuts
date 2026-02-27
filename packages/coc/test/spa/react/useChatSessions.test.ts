/**
 * Tests for useChatSessions hook.
 *
 * Validates the hook's source structure: fetch on mount, refresh,
 * workspace-scoped query, session item mapping, and error handling.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'useChatSessions.ts'
);

describe('useChatSessions', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports useChatSessions as a named function', () => {
            expect(source).toContain('export function useChatSessions');
        });

        it('exports UseChatSessionsResult interface', () => {
            expect(source).toContain('export interface UseChatSessionsResult');
        });
    });

    describe('hook signature', () => {
        it('accepts workspaceId parameter', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('returns sessions array', () => {
            expect(source).toContain('sessions: ChatSessionItem[]');
        });

        it('returns loading flag', () => {
            expect(source).toContain('loading: boolean');
        });

        it('returns error state', () => {
            expect(source).toContain('error: string | null');
        });

        it('returns refresh function', () => {
            expect(source).toContain('refresh: () => void');
        });
    });

    describe('fetch behavior', () => {
        it('fetches from /queue/history with type=chat filter', () => {
            expect(source).toContain('/queue/history?type=chat&repoId=');
        });

        it('encodes workspaceId in the URL', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });

        it('fetches on mount via useEffect', () => {
            expect(source).toContain('useEffect');
            expect(source).toContain('fetchSessions');
        });

        it('re-fetches when workspaceId changes', () => {
            expect(source).toContain('[fetchSessions]');
        });

        it('uses fetchApi from hooks/useApi', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });
    });

    describe('session item mapping', () => {
        it('maps task id', () => {
            expect(source).toContain('id: task.id');
        });

        it('maps processId', () => {
            expect(source).toContain('processId: task.processId');
        });

        it('maps status', () => {
            expect(source).toContain('status: task.status');
        });

        it('maps createdAt', () => {
            expect(source).toContain('createdAt: task.createdAt');
        });

        it('maps completedAt', () => {
            expect(source).toContain('completedAt: task.completedAt');
        });

        it('maps firstMessage with fallback to payload.prompt', () => {
            expect(source).toContain('task.firstMessage');
            expect(source).toContain('task.payload?.prompt');
        });

        it('maps turnCount', () => {
            expect(source).toContain('turnCount: task.turnCount');
        });
    });

    describe('state management', () => {
        it('initializes loading to true', () => {
            expect(source).toContain('useState(true)');
        });

        it('sets loading false after fetch', () => {
            expect(source).toContain('setLoading(false)');
        });

        it('tracks error state', () => {
            expect(source).toContain('setError(');
        });

        it('clears sessions on error', () => {
            expect(source).toContain('setSessions([])');
        });
    });

    describe('refresh function', () => {
        it('exposes fetchSessions as refresh', () => {
            expect(source).toContain('refresh: fetchSessions');
        });

        it('uses useCallback for fetchSessions', () => {
            expect(source).toContain('useCallback');
        });
    });

    describe('cleanup', () => {
        it('uses mountedRef to avoid state updates after unmount', () => {
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

        it('imports ChatSessionItem type', () => {
            expect(source).toContain("import type { ChatSessionItem } from '../types/dashboard'");
        });
    });
});
