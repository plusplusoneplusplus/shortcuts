/**
 * Tests for useNotesChat hook — single-chat-per-workspace model.
 *
 * Validates localStorage persistence, createChat task creation,
 * resetChat clearing, context injection with current note, and
 * note context transparency (chatNoteContext with metadata fetch).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'hooks', 'useNotesChat.ts'
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

    it('exports ChatNoteContext interface', () => {
        expect(source).toContain('export interface ChatNoteContext');
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

    describe('note context persistence', () => {
        it('stores chat note context in a separate localStorage key', () => {
            expect(source).toContain('`coc-notes-chat-ctx-${workspaceId}`');
        });

        it('saves context to localStorage on change', () => {
            expect(source).toContain('saveContext(workspaceId, chatNoteContext)');
        });

        it('loads context from localStorage on init', () => {
            expect(source).toContain('loadContext(workspaceId)');
        });
    });

    describe('metadata fetch on restore', () => {
        it('fetches process metadata when taskId is restored', () => {
            expect(source).toContain('fetchApi(`/processes/');
        });

        it('extracts noteContentStatus from process metadata', () => {
            expect(source).toContain('meta.noteContentStatus');
        });

        it('skips fetch when contentStatus already exists', () => {
            expect(source).toContain('chatNoteContext?.contentStatus');
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

        it('stores chat note context at creation time', () => {
            expect(source).toContain('setChatNoteContext({ notePath, noteTitle:');
        });

        it('clears chat note context when no notePath', () => {
            expect(source).toContain('setChatNoteContext(null)');
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

        it('clears chat note context', () => {
            // resetChat clears both taskId and context
            const resetBlock = source.substring(
                source.indexOf('const resetChat'),
                source.indexOf('return { taskId')
            );
            expect(resetBlock).toContain('setChatNoteContext(null)');
        });
    });

    it('returns taskId, chatNoteContext, createChat, and resetChat', () => {
        expect(source).toContain('return { taskId, chatNoteContext, createChat, resetChat }');
    });
});
