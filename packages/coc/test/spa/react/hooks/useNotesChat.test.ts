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
import { formatNoteAttachmentLink, formatNoteAttachmentPrompt } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat';

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
            expect(source).toContain("defaultScope = 'per-note'");
        });

        it('defaults scope to per-note (Chat with Note) rather than per-workspace', () => {
            // The chat launched from Notes must land on "This note" by default.
            expect(source).toContain("defaultScope = 'per-note'");
            expect(source).not.toContain("defaultScope = 'per-workspace'");
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

        it('seeds per-note map from server via listChatBindings', () => {
            expect(source).toContain('listChatBindings(workspaceId)');
        });

        it('does not persist per-note map to localStorage', () => {
            expect(source).not.toContain('coc-notes-chat-map-');
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

    describe('createChat creates queue task', () => {
        it('POSTs to /queue with chat payload', () => {
            expect(source).toContain('cloneClient.notes.createChat');
        });

        it('accepts ask and autopilot as valid modes', () => {
            expect(source).toContain("mode: 'ask' | 'autopilot'");
        });

        it('includes noteChat context with current note', () => {
            expect(source).toContain('notePath');
            expect(source).toContain('noteTitle');
        });

        it('prepends note path to prompt when notePath is set', () => {
            expect(source).toContain('prompt: formatNoteAttachmentPrompt(prompt, workspaceId, notePath)');
        });

        it('handles missing notePath gracefully (undefined context)', () => {
            expect(source).toContain('notePath,');
        });

        it('stores chat note context at creation time', () => {
            expect(source).toContain('setChatNoteContext({ notePath, noteTitle:');
        });

        it('clears chat note context when no notePath', () => {
            expect(source).toContain('setChatNoteContext(null)');
        });

        it('extracts taskId from response', () => {
            expect(source).toContain('res.task.id');
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

        it('accepts optional model, skills, and attachments parameters in createChat signature', () => {
            expect(source).toContain('createChat: (prompt: string, model?: string | null, mode?: \'ask\' | \'autopilot\', skills?: string[], attachments?: AttachmentPayload[])');
        });

        it('includes skills in context when provided', () => {
            expect(source).toContain('skills,');
        });

        it('includes model in payload when provided', () => {
            expect(source).toContain('model,');
        });

        it('passes inherited Lens Chat mode only when the shared Lens flag is enabled', () => {
            expect(source).toContain('isCommitChatLensEnabled() ? { lensChat: INHERITED_LENS_CHAT_MODE } : {}');
            expect(source).not.toContain('coc-notes-lens');
        });
    });

    describe('note attachment link formatting', () => {
        it('formats note attachment as a markdown deep-link', () => {
            expect(formatNoteAttachmentLink('workspace-a', 'Features/Memory.md'))
                .toBe('[📝 Note: Features/Memory.md](#repos/workspace-a/notes/Features/Memory.md)');
        });

        it('encodes route segments while preserving readable link text', () => {
            expect(formatNoteAttachmentLink('my workspace', 'New Features/Memory (draft).md'))
                .toBe('[📝 Note: New Features/Memory (draft).md](#repos/my%20workspace/notes/New%20Features/Memory%20%28draft%29.md)');
        });

        it('escapes markdown metacharacters in the link text', () => {
            expect(formatNoteAttachmentLink('ws', 'Notes/[Memory]\\Plan.md'))
                .toBe('[📝 Note: Notes/\\[Memory\\]\\\\Plan.md](#repos/ws/notes/Notes/%5BMemory%5D%5CPlan.md)');
        });

        it('prepends the linked note attachment before the prompt', () => {
            expect(formatNoteAttachmentPrompt('Summarize this', 'ws', 'Features/Memory.md'))
                .toBe('[📝 Note: Features/Memory.md](#repos/ws/notes/Features/Memory.md)\n\nSummarize this');
        });

        it('returns the original prompt when no note is attached', () => {
            expect(formatNoteAttachmentPrompt('Summarize this', 'ws', null)).toBe('Summarize this');
        });
    });

    describe('resetChat clears correct bucket', () => {
        it('clears per-workspace taskId when scope is per-workspace', () => {
            expect(source).toContain('setPerWorkspaceTaskId(null)');
        });

        it('removes per-note entry when scope is per-note', () => {
            expect(source).toContain("delete next[notePath]");
        });

        it('calls deleteChatBindingByPath on the server when resetting a per-note chat', () => {
            expect(source).toContain('deleteChatBindingByPath(workspaceId, notePath)');
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
