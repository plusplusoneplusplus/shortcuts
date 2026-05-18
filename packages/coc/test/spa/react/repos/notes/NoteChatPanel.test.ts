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
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'editor', 'NoteChatPanel.tsx'
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
            expect(source).toContain("from '../hooks/useNotesChat'");
            expect(source).not.toContain('useNoteChatBinding');
        });

        it('calls useNotesChat with workspace, note, and scope options', () => {
            // Call is now multiline and includes defaultScope
            expect(source).toContain('useNotesChat({');
            expect(source).toContain('workspaceId,');
            expect(source).toContain('notePath,');
            expect(source).toContain('noteTitle,');
            expect(source).toContain('defaultScope,');
        });

        it('destructures taskId, chatNoteContext, createChat, resetChat, scope, setScope', () => {
            expect(source).toContain('{ taskId, chatNoteContext, createChat, resetChat, scope, setScope }');
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

        it('passes disableScratchpad to ChatDetail', () => {
            expect(source).toContain('disableScratchpad');
        });
    });

    describe('note context banner', () => {
        it('imports NoteContextBanner', () => {
            expect(source).toContain("from './NoteContextBanner'");
        });

        it('renders NoteContextBanner in active chat', () => {
            expect(source).toContain('<NoteContextBanner');
        });

        it('passes chatNoteContext to banner', () => {
            expect(source).toContain('chatNoteContext?.notePath');
            expect(source).toContain('chatNoteContext?.noteTitle');
        });

        it('passes currentNotePath to banner for anchoring detection', () => {
            expect(source).toContain('currentNotePath={notePath}');
        });
    });

    describe('no per-note binding references', () => {
        it('does not reference binding store', () => {
            expect(source).not.toContain('binding');
            expect(source).not.toContain('Binding');
        });

        it('uses typed client for skill fetching', () => {
            expect(source).toContain('getSpaCocClient');
        });
    });

    describe('save-before-send', () => {
        it('accepts onBeforeSend prop', () => {
            expect(source).toContain('onBeforeSend');
        });

        it('calls onBeforeSend before createChat in handleSend', () => {
            // Verify the call order: onBeforeSend appears before createChat in handleSend
            const sendIdx = source.indexOf('await onBeforeSend?.()');
            const createIdx = source.indexOf('await createChat(prompt,');
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

    describe('onNoteFileEdit prop removed', () => {
        it('does not declare onNoteFileEdit in NoteChatPanelProps', () => {
            expect(source).not.toContain('onNoteFileEdit');
        });
    });

    describe('/model command support', () => {
        it('imports useModels', () => {
            expect(source).toContain("from '../../../hooks/useModels'");
        });

        it('imports useSlashCommands', () => {
            expect(source).toContain("from '../../chat/hooks/useSlashCommands'");
        });

        it('imports useModelCommand', () => {
            expect(source).toContain("from '../../chat/hooks/useModelCommand'");
        });

        it('imports SlashCommandMenu', () => {
            expect(source).toContain("from '../../chat/SlashCommandMenu'");
        });

        it('imports ModelCommandMenu', () => {
            expect(source).toContain("from '../../chat/ModelCommandMenu'");
        });

        it('wires model command hooks', () => {
            expect(source).toContain('useModels()');
            expect(source).toContain('useSlashCommands(augmentedSkills)');
            expect(source).toContain('useModelCommand(enabledModels)');
        });

        it('renders SlashCommandMenu in empty state input', () => {
            expect(source).toContain('<SlashCommandMenu');
        });

        it('renders ModelCommandMenu in empty state input', () => {
            expect(source).toContain('<ModelCommandMenu');
        });

        it('renders model badge with testid', () => {
            expect(source).toContain('note-chat-model-badge');
        });

        it('passes modelOverride, selectedMode, and extracted skills to createChat', () => {
            expect(source).toContain('createChat(prompt, modelCommand.modelOverride, selectedMode,');
        });

        it('wraps RichTextInput in relative container for menu positioning', () => {
            // Menus are children of the relative container
            const relIdx = source.indexOf('min-w-0 relative');
            expect(relIdx).toBeGreaterThan(-1);
            const slashMenuIdx = source.indexOf('<SlashCommandMenu', relIdx);
            expect(slashMenuIdx).toBeGreaterThan(relIdx);
        });
    });

    describe('skill slash-command support', () => {
        it('imports SkillItem type from SlashCommandMenu', () => {
            expect(source).toContain("SkillItem");
            expect(source).toContain("from '../../chat/SlashCommandMenu'");
        });

        it('imports typed SPA client for skill fetching', () => {
            expect(source).toContain("import { getSpaCocClient }");
            expect(source).toContain("from '../../../api/cocClient'");
        });

        it('declares skills state with SkillItem array type', () => {
            expect(source).toContain('useState<SkillItem[]>([])');
        });

        it('fetches skills from the typed skills client on workspaceId change', () => {
            expect(source).toContain('skills.listAllWorkspace(workspaceId)');
            expect(source).toContain('setSkills(data.merged)');
        });

        it('merges fetched skills with META_SKILL_ITEMS', () => {
            expect(source).toContain('mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled()))');
        });

        it('augmentedSkills depends on skills', () => {
            expect(source).toContain('[skills]');
        });

        it('onSelect calls selectSkill for non-model skills', () => {
            expect(source).toContain('slashCommands.selectSkill(name, input, setInput, richTextRef)');
        });

        it('keyboard handler calls selectSkill for non-model skills on Enter/Tab', () => {
            expect(source).toContain('slashCommands.selectSkill(skill.name, input, setInput, richTextRef)');
        });

        it('handleSend extracts skills via parseAndExtract', () => {
            expect(source).toContain('slashCommands.parseAndExtract(text)');
        });

        it('passes extracted skills to createChat when present', () => {
            expect(source).toContain('extractedSkills.length > 0 ? extractedSkills : undefined');
        });
    });

    describe('image paste support', () => {
        it('imports useFileAttachments hook', () => {
            expect(source).toContain("useFileAttachments");
        });

        it('imports AttachmentPreviews component', () => {
            expect(source).toContain("AttachmentPreviews");
        });

        it('wires onPaste to addFromPaste', () => {
            expect(source).toContain('onPaste={addFromPaste}');
        });

        it('renders AttachmentPreviews with attachments and onRemove', () => {
            expect(source).toContain('<AttachmentPreviews');
            expect(source).toContain('attachments={attachments}');
            expect(source).toContain('onRemove={removeAttachment}');
        });

        it('clears attachments after send', () => {
            expect(source).toContain('clearAttachments()');
        });

        it('enables send button when attachments are present', () => {
            expect(source).toContain('attachments.length === 0');
        });

        it('passes attachments to createChat when present', () => {
            expect(source).toContain('attachmentPayload.length > 0 ? attachmentPayload : undefined');
        });

        it('shows attachment error when present', () => {
            expect(source).toContain('note-chat-attachment-error');
        });
    });
});
