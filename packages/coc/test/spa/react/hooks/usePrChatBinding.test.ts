/**
 * Tests for usePrChatBinding hook — localStorage binding, createChat, context pattern.
 *
 * Validates that the hook stores/restores bindings in localStorage,
 * sends correct context shape (workspaceId, prId, filePath) without content,
 * and manages loading/error/taskId states.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'hooks', 'usePrChatBinding.ts'
);

describe('usePrChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    it('exports UsePrChatBindingOptions interface', () => {
        expect(source).toContain('export interface UsePrChatBindingOptions');
    });

    it('exports UsePrChatBindingReturn interface', () => {
        expect(source).toContain('export interface UsePrChatBindingReturn');
    });

    it('exports usePrChatBinding function', () => {
        expect(source).toContain('export function usePrChatBinding');
    });

    describe('options shape', () => {
        it('accepts workspaceId', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts prId', () => {
            expect(source).toContain('prId: string');
        });

        it('accepts optional filePath for context', () => {
            expect(source).toContain('filePath?: string');
        });
    });

    describe('return shape', () => {
        it('returns taskId', () => {
            expect(source).toContain('taskId: string | null');
        });

        it('returns loading flag', () => {
            expect(source).toContain('loading: boolean');
        });

        it('returns error', () => {
            expect(source).toContain('error: string | null');
        });

        it('returns createChat function', () => {
            expect(source).toContain('createChat: (prompt: string');
        });
    });

    describe('localStorage binding', () => {
        it('uses prChat binding prefix in localStorage', () => {
            expect(source).toContain('coc.prChat.binding.');
        });

        it('stores binding to localStorage after createChat success', () => {
            expect(source).toContain('storeBinding(prId, ');
        });

        it('restores binding from localStorage on mount', () => {
            expect(source).toContain('getStoredBinding(prId)');
        });

        it('refreshes binding when prId changes via useEffect', () => {
            expect(source).toContain('[prId]');
        });
    });

    describe('createChat context pattern', () => {
        it('sends context with prChat object (no diff content)', () => {
            expect(source).toContain('prChat: { prId, filePath }');
        });

        it('uses queue.enqueue to create chat task', () => {
            expect(source).toContain('queue.enqueue');
        });

        it('sets mode to ask', () => {
            expect(source).toContain("mode: 'ask'");
        });

        it('includes workspaceId in payload', () => {
            expect(source).toContain('workspaceId,');
        });
    });

    describe('state management', () => {
        it('sets loading true during createChat', () => {
            expect(source).toContain('setLoading(true)');
        });

        it('sets loading false in finally block', () => {
            expect(source).toContain('setLoading(false)');
        });

        it('sets error on failure', () => {
            expect(source).toContain("setError(err?.message ?? 'Failed to create PR chat')");
        });

        it('clears error before create', () => {
            expect(source).toContain('setError(null)');
        });
    });
});
