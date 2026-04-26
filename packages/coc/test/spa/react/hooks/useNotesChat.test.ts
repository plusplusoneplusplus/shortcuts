/**
 * Tests for useNotesChat hook — dual-scope (per-note + per-workspace) model.
 *
 * Validates localStorage persistence, createChat task creation,
 * resetChat clearing, context injection with current note,
 * note context transparency (chatNoteContext with metadata fetch),
 * and scope state management (defaultScope, setScope, dual storage keys).
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

    it('exports ChatScope type', () => {
        expect(source).toContain("export type ChatScope = 'per-note' | 'per-workspace'");
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

    describe('scope management', () => {
        it('accepts defaultScope param in options', () => {
            expect(source).toContain('defaultScope?: ChatScope');
        });

        it('exposes scope and setScope in return value', () => {
            expect(source).toContain('scope: ChatScope');
            expect(source).toContain('setScope: (scope: ChatScope) => void');
        });

        it('returns scope and setScope', () => {
            expect(source).toContain('return { taskId, chatNoteContext, createChat, resetChat, scope, setScope }');
        });

        it('persists scope to workspace-scoped localStorage key', () => {
            expect(source).toContain('`coc-notes-chat-scope-${workspaceId}`');
        });

        it('falls back to defaultScope when no stored value', () => {
            expect(source).toContain("defaultScope = 'per-workspace'");
        });
    });

    describe('localStorage persistence', () => {
        it('reads initial per-workspace taskId from localStorage', () => {
            expect(source).toContain('localStorage.getItem(key)');
        });

        it('writes per-workspace taskId to localStorage when set', () => {
            expect(source).toContain('localStorage.setItem(key, perWorkspaceTaskId)');
        });

        it('removes from localStorage when per-workspace taskId is null', () => {
            expect(source).toContain('localStorage.removeItem(key)');
        });

        it('uses workspace-scoped storage key for per-workspace chat', () => {
            expect(source).toContain('`coc-notes-chat-${workspaceId}`');
        });

        it('uses workspace-scoped map key for per-note chats', () => {
            expect(source).toContain('`coc-notes-chat-map-${workspaceId}`');
        });

        it('persists per-note map to localStorage', () => {
            expect(source).toContain('localStorage.setItem(noteMapKey(workspaceId), JSON.stringify(perNoteMap))');
        });

        it('removes per-note map from localStorage when empty', () => {
            expect(source).toContain('localStorage.removeItem(noteMapKey(workspaceId))');
        });
    });

    describe('derived taskId', () => {
        it('derives taskId from perWorkspaceTaskId when scope is per-workspace', () => {
            expect(source).toContain("scope === 'per-workspace'");
            expect(source).toContain('? perWorkspaceTaskId');
        });

        it('derives taskId from perNoteMap when scope is per-note', () => {
            expect(source).toContain("perNoteMap[notePath] ?? null");
        });

        it('returns null when scope is per-note but no note selected', () => {
            expect(source).toContain('(notePath ? perNoteMap[notePath] ?? null : null)');
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

        it('clears chatNoteContext when taskId becomes null', () => {
            expect(source).toContain('setChatNoteContext(null)');
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

        it('sets per-workspace taskId when scope is per-workspace', () => {
            expect(source).toContain('setPerWorkspaceTaskId(newTaskId)');
        });

        it('updates per-note map when scope is per-note', () => {
            expect(source).toContain('setPerNoteMap(prev => ({ ...prev, [notePath]: newTaskId }))');
        });

        it('returns null on failure', () => {
            expect(source).toContain('return null');
        });
    });

    describe('resetChat clears correct bucket', () => {
        it('clears per-workspace taskId when scope is per-workspace', () => {
            expect(source).toContain('setPerWorkspaceTaskId(null)');
        });

        it('removes per-note entry when scope is per-note', () => {
            expect(source).toContain("delete next[notePath]");
        });

        it('clears chat note context in both cases', () => {
            const resetBlock = source.substring(
                source.indexOf('const resetChat'),
                source.indexOf('return { taskId')
            );
            expect(resetBlock).toContain('setChatNoteContext(null)');
        });
    });
});
