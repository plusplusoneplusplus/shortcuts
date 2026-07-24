/**
 * Tests for NoteChatPanel — the thin Notes adapter around the shared composer.
 *
 * After the shared-composer swap (AC-01), the empty state is rendered by the
 * shared InitialChatComposer and NoteChatPanel owns only a submission adapter,
 * scope/header wiring, and the active-chat handoff to ChatDetail. These remain
 * source-string assertions; the full rendered-behavior conversion
 * (Verification #2) is a follow-up. They lock in the thin-adapter contract
 * (AC-01 Definition of Done #2) and the preserved Notes shell.
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
            expect(source).toContain('useNotesChat({');
            expect(source).toContain('workspaceId,');
            expect(source).toContain('notePath,');
            expect(source).toContain('noteTitle,');
            expect(source).toContain('defaultScope,');
        });

        it('destructures taskId, task-bound context sync, chat actions, and scope state', () => {
            expect(source).toContain('{ taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, scope, setScope }');
        });
    });

    describe('notePath is nullable', () => {
        it('accepts null notePath in props', () => {
            expect(source).toContain('notePath: string | null');
        });
    });

    // AC-01 Definition of Done #2: NoteChatPanel no longer imports or directly
    // coordinates the low-level input, model/slash menu, skill loading, or
    // file-attachment primitives. Those now live entirely in the shared composer.
    describe('thin adapter — no bespoke composer primitives (AC-01)', () => {
        it('renders the shared InitialChatComposer for the empty state', () => {
            expect(source).toContain('<InitialChatComposer');
            expect(source).toContain("import { InitialChatComposer } from '../../chat/NewChatArea'");
        });

        it('retains the stable note-chat test-id prefix', () => {
            expect(source).toContain('testIdPrefix="note-chat"');
        });

        it('does not import the low-level rich-text input', () => {
            expect(source).not.toContain('RichTextInput');
        });

        it('does not coordinate the slash/model command menus or hooks', () => {
            expect(source).not.toContain('useSlashCommands');
            expect(source).not.toContain('useModelCommand');
            expect(source).not.toContain('SlashCommandMenu');
            expect(source).not.toContain('ModelCommandMenu');
        });

        it('does not own model or skill loading', () => {
            expect(source).not.toContain('useModels');
            expect(source).not.toContain('getSpaCocClient');
            expect(source).not.toContain('listAllWorkspace');
        });

        it('does not own file-attachment primitives', () => {
            expect(source).not.toContain('useFileAttachments');
            expect(source).not.toContain('AttachmentPreviews');
        });
    });

    // AC-03/05: the panel pins the composer to Ask + Autopilot, the compact
    // settings chip, no workflow launch, and a scope-isolated draft key.
    describe('shared-composer configuration', () => {
        it('pins allowedModes to NOTE_CHAT_ALLOWED_MODES with a compact settings layout', () => {
            expect(source).toContain('allowedModes={NOTE_CHAT_ALLOWED_MODES}');
            expect(source).toContain('settingsLayout="compact"');
        });

        it('disables the Ralph direct-goal launch so no workflow starts from Notes', () => {
            expect(source).toContain('enableRalphDirectGoal={false}');
        });

        it('feeds the scope-isolated draft key so drafts never cross notes or scopes', () => {
            expect(source).toContain('notesChatDraftKey');
            expect(source).toContain('draftKey={notesChatDraftKey(workspaceId, scope, notePath)}');
        });

        it('keeps the Notes robot identity and scope-specific copy in the hero', () => {
            expect(source).toContain('heroIcon="🤖"');
            expect(source).toContain('heroTitle="Notes Chat"');
            expect(source).toContain('heroDescription={emptyStateText}');
        });
    });

    // AC-04: selected-text references ride as a pending prefix (removable chips
    // above the input); they are cleared only after a successful submission.
    describe('selected-text references', () => {
        it('passes references as the composer pending prefix', () => {
            expect(source).toContain('pendingPrefix={references && references.length > 0 ? formatNoteReferences(references) : undefined}');
        });

        it('renders the removable reference chips in the accessory slot above the input', () => {
            expect(source).toContain('accessoryAboveInput={');
            expect(source).toContain('<NoteReferenceChips');
        });

        it('clears references only via the composer success callback', () => {
            expect(source).toContain('onClearPendingPrefix={onClearReferences}');
        });
    });

    // AC-04: exact trimmed /new and /clear reset the binding without flushing,
    // creating a task, or consuming references — routed through the generic
    // interceptSubmit extension point on the shared composer.
    describe('/new and /clear reset commands', () => {
        it('wires a submission interceptor into the shared composer', () => {
            expect(source).toContain('interceptSubmit={handleInterceptSubmit}');
        });

        it('matches exact trimmed /new and /clear and resets the binding', () => {
            expect(source).toContain('/^\\/(new|clear)$/i');
            expect(source).toContain('resetChat()');
        });

        it('the interceptor does not flush the note or create a chat', () => {
            const start = source.indexOf('const handleInterceptSubmit');
            expect(start).toBeGreaterThan(-1);
            const block = source.slice(start, source.indexOf('}, [resetChat]', start));
            expect(block).toContain('resetChat()');
            expect(block).not.toContain('onBeforeSend');
            expect(block).not.toContain('createChat');
        });
    });

    describe('single compact header (both states)', () => {
        it('renders exactly one NotesChatHeader for both empty and active states', () => {
            const matches = source.match(/<NotesChatHeader/g) ?? [];
            expect(matches.length).toBe(1);
        });

        it('renders NotesChatHeader before the empty/active-state conditionals', () => {
            const headerIdx = source.indexOf('<NotesChatHeader');
            const emptyStateIdx = source.indexOf('{!taskId && (');
            const activeStateIdx = source.indexOf('{taskId && (');
            expect(headerIdx).toBeGreaterThan(-1);
            expect(headerIdx).toBeLessThan(emptyStateIdx);
            expect(headerIdx).toBeLessThan(activeStateIdx);
        });

        it('imports NotesChatHeader from ./NotesChatHeader', () => {
            expect(source).toContain("from './NotesChatHeader'");
        });

        it('passes presentation, onMinimize, onPin, onUnpin, and onNewChat to the header', () => {
            expect(source).toContain('windowMode={presentation}');
            expect(source).toContain('onMinimize={onMinimize}');
            expect(source).toContain('onPin={onPin}');
            expect(source).toContain('onUnpin={onUnpin}');
            expect(source).toContain('onNewChat={taskId ? resetChat : undefined}');
        });

        it('accepts presentation, onMinimize, onPin, onUnpin props', () => {
            expect(source).toContain('presentation?: NotesChatWindowMode');
            expect(source).toContain('onMinimize?: () => void');
            expect(source).toContain('onPin?: () => void');
            expect(source).toContain('onUnpin?: () => void');
        });

        it('defaults presentation to embedded', () => {
            expect(source).toContain("presentation = 'embedded'");
        });

        it('no longer defines its own ScopeToggle or per-state header rows', () => {
            expect(source).not.toContain('function ScopeToggle');
            expect(source).not.toContain('note-chat-new-btn');
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

        it('hides ChatDetail\'s own header (compact header covers it)', () => {
            expect(source).toContain('hideHeader');
        });

        it('passes disableScratchpad to ChatDetail', () => {
            expect(source).toContain('disableScratchpad');
        });

        it('receives the loaded process metadata through ChatDetail without a duplicate fetch', () => {
            expect(source).toContain('onProcessLoaded={syncChatNoteContext}');
        });
    });

    describe('note context banner', () => {
        it('imports NoteContextBanner', () => {
            expect(source).toContain("from './NoteContextBanner'");
        });

        it('renders NoteContextBanner in active chat', () => {
            expect(source).toContain('<NoteContextBanner');
        });

        it('derives the chat-bound note reference from chatNoteContext', () => {
            expect(source).toContain('chatNoteContext?.notePath');
            expect(source).toContain('chatNoteContext?.noteTitle');
        });

        it('computes isSwitched once and shares it with the header and banner', () => {
            expect(source).toContain('const isNoteSwitched =');
            expect(source).toContain('notePath !== chatNotePath');
            expect(source).toContain('isSwitched={isNoteSwitched}');
        });

        it('passes the shared chat-note reference props to the banner', () => {
            expect(source).toContain('chatNotePath={chatNotePath}');
            expect(source).toContain('chatNoteTitle={chatNoteTitle}');
        });

        it('no longer passes currentNotePath to the banner (isSwitched computed upstream)', () => {
            expect(source).not.toContain('currentNotePath={notePath}');
        });
    });

    describe('save-before-send flush ordering (AC-06)', () => {
        it('accepts onBeforeSend prop', () => {
            expect(source).toContain('onBeforeSend');
        });

        it('flushes onBeforeSend before createChat inside the submit adapter', () => {
            const sendIdx = source.indexOf('await onBeforeSend?.()');
            const createIdx = source.indexOf('await createChat(');
            expect(sendIdx).toBeGreaterThan(-1);
            expect(createIdx).toBeGreaterThan(-1);
            expect(sendIdx).toBeLessThan(createIdx);
        });

        it('surfaces a create failure as a rejection so the composer preserves state', () => {
            expect(source).toContain('if (!newTaskId) {');
            expect(source).toContain('throw new Error');
        });
    });

    describe('onNoteFileEdit prop removed', () => {
        it('does not declare onNoteFileEdit in NoteChatPanelProps', () => {
            expect(source).not.toContain('onNoteFileEdit');
        });
    });
});
