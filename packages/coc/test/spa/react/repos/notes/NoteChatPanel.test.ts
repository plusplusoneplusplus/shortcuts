/**
 * Tests for NoteChatPanel — single-chat-per-workspace UI.
 *
 * Validates panel structure, useNotesChat integration, /new and /clear
 * reset commands, empty state, and active chat rendering.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'notes', 'NoteChatPanel.tsx'
);

describe('NoteChatPanel', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    it('exports NoteChatPanel component', () => {
        expect(source).toContain('export function NoteChatPanel');
    });

    it('exports NoteChatPanelProps interface', () => {
        expect(source).toContain('export interface NoteChatPanelProps');
    });

    describe('uses single-chat hook', () => {
        it('imports useNotesChat (not useNoteChatBinding)', () => {
            expect(source).toContain("from '../../hooks/useNotesChat'");
            expect(source).not.toContain('useNoteChatBinding');
        });

        it('calls useNotesChat with workspace and note options', () => {
            expect(source).toContain('useNotesChat({ workspaceId, notePath, noteTitle })');
        });

        it('destructures taskId, createChat, resetChat', () => {
            expect(source).toContain('{ taskId, createChat, resetChat }');
        });

        it('does not use loading or error states', () => {
            expect(source).not.toContain('loading');
            expect(source).not.toContain('{error');
        });
    });

    describe('notePath is nullable', () => {
        it('accepts null notePath in props', () => {
            expect(source).toContain('notePath: string | null');
        });
    });

    describe('/new and /clear reset commands', () => {
        it('intercepts /new command', () => {
            expect(source).toContain('/new');
        });

        it('intercepts /clear command', () => {
            expect(source).toContain('/clear');
        });

        it('calls resetChat on /new or /clear', () => {
            expect(source).toContain('resetChat()');
        });
    });

    describe('empty state', () => {
        it('shows when no taskId', () => {
            expect(source).toContain('{!taskId && (');
        });

        it('shows Notes Chat label (not per-note title)', () => {
            expect(source).toContain('Notes Chat');
        });

        it('has close button', () => {
            expect(source).toContain('note-chat-close-btn');
        });

        it('has input field', () => {
            expect(source).toContain('note-chat-input');
        });

        it('has send button', () => {
            expect(source).toContain('note-chat-send-btn');
        });
    });

    describe('active chat state', () => {
        it('renders ChatDetail when taskId exists', () => {
            expect(source).toContain('{taskId && (');
            expect(source).toContain('<ChatDetail');
        });

        it('wraps in ChatPreferencesProvider', () => {
            expect(source).toContain('<ChatPreferencesProvider');
        });

        it('uses floating variant', () => {
            expect(source).toContain('variant="floating"');
        });

        it('has New Chat button', () => {
            expect(source).toContain('note-chat-new-btn');
            expect(source).toContain('New Chat');
        });
    });

    describe('no per-note binding references', () => {
        it('does not reference binding store', () => {
            expect(source).not.toContain('binding');
            expect(source).not.toContain('Binding');
        });

        it('does not use fetchApi', () => {
            expect(source).not.toContain('fetchApi');
        });
    });

    describe('save-before-send', () => {
        it('accepts onBeforeSend prop', () => {
            expect(source).toContain('onBeforeSend');
        });

        it('calls onBeforeSend before createChat in handleSend', () => {
            // Verify the call order: onBeforeSend appears before createChat in handleSend
            const sendIdx = source.indexOf('await onBeforeSend?.()');
            const createIdx = source.indexOf('await createChat(text)');
            expect(sendIdx).toBeGreaterThan(-1);
            expect(createIdx).toBeGreaterThan(-1);
            expect(sendIdx).toBeLessThan(createIdx);
        });

        it('does not call onBeforeSend for /new or /clear commands', () => {
            // The /new and /clear branch returns early before onBeforeSend
            const newClearIdx = source.indexOf('resetChat()');
            const beforeSendIdx = source.indexOf('await onBeforeSend?.()');
            // resetChat return happens before the onBeforeSend call
            expect(newClearIdx).toBeLessThan(beforeSendIdx);
        });
    });

    describe('onNoteFileEdit prop', () => {
        it('declares onNoteFileEdit in NoteChatPanelProps', () => {
            expect(source).toContain('onNoteFileEdit');
        });

        it('passes onNoteFileEdit to ActivityChatDetail', () => {
            const panelIdx = source.indexOf('onNoteFileEdit');
            const activityIdx = source.indexOf('<ActivityChatDetail');
            expect(panelIdx).toBeGreaterThan(-1);
            // onNoteFileEdit appears in the JSX block where ActivityChatDetail is rendered
            expect(activityIdx).toBeGreaterThan(-1);
            // Find the onNoteFileEdit usage inside ActivityChatDetail's props
            const activityBlock = source.slice(activityIdx);
            expect(activityBlock).toContain('onNoteFileEdit');
        });
    });
});
