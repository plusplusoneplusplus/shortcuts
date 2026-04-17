/**
 * Tests for useNotesChat hook — single-chat-per-workspace model.
 *
 * Validates localStorage persistence, createChat task creation,
 * resetChat clearing, and context injection with current note.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useNotesChat.ts'
);

describe('useNotesChat', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    it('exports UseNotesChatOptions interface', () => {
        expect(source).toContain('export interface UseNotesChatOptions');
    });

    it('exports UseNotesChatReturn interface', () => {
        expect(source).toContain('export interface UseNotesChatReturn');
    });

    it('exports useNotesChat function', () => {
        expect(source).toContain('export function useNotesChat');
    });

    describe('localStorage persistence', () => {
        it('reads initial taskId from localStorage', () => {
            expect(source).toContain('localStorage.getItem(key)');
        });

        it('writes taskId to localStorage when set', () => {
            expect(source).toContain('localStorage.setItem(key, taskId)');
        });

        it('removes from localStorage when taskId is null', () => {
            expect(source).toContain('localStorage.removeItem(key)');
        });

        it('uses workspace-scoped storage key', () => {
            expect(source).toContain('`coc-notes-chat-${workspaceId}`');
        });
    });

    describe('single-chat model', () => {
        it('does not fetch any API on mount', () => {
            // No fetchApi call in useEffect — only in createChat
            const hookBody = source.substring(
                source.indexOf('export function useNotesChat'),
                source.lastIndexOf('}')
            );
            // No useEffect that calls fetchApi
            expect(hookBody).not.toContain('fetchApi(`/workspaces/');
        });

        it('does not have loading or error states', () => {
            expect(source).not.toContain('setLoading');
            expect(source).not.toContain('setError');
        });
    });

    describe('createChat creates queue task', () => {
        it('POSTs to /queue/tasks with chat payload', () => {
            expect(source).toContain("fetchApi('/queue/tasks'");
            expect(source).toContain("method: 'POST'");
            expect(source).toContain("kind: 'chat'");
        });

        it('uses autopilot mode', () => {
            expect(source).toContain("mode: 'autopilot'");
        });

        it('includes noteChat context with current note', () => {
            expect(source).toContain('noteChat:');
            expect(source).toContain('notePath');
            expect(source).toContain('noteTitle');
        });

        it('handles missing notePath gracefully (undefined context)', () => {
            expect(source).toContain('notePath ? { notePath, noteTitle } : undefined');
        });

        it('extracts taskId from response', () => {
            expect(source).toContain('res.task?.id ?? res.id');
        });

        it('sets taskId on success', () => {
            expect(source).toContain('setTaskId(newTaskId)');
            expect(source).toContain('return newTaskId');
        });

        it('returns null on failure', () => {
            expect(source).toContain('return null');
        });
    });

    describe('resetChat clears state', () => {
        it('sets taskId to null', () => {
            expect(source).toContain('setTaskId(null)');
        });

        it('does not make any API call', () => {
            // resetChat is a simple state clear — no server call
            const resetBlock = source.substring(
                source.indexOf('const resetChat'),
                source.indexOf('return { taskId')
            );
            expect(resetBlock).not.toContain('fetchApi');
        });
    });

    it('returns taskId, createChat, and resetChat', () => {
        expect(source).toContain('return { taskId, createChat, resetChat }');
    });
});
