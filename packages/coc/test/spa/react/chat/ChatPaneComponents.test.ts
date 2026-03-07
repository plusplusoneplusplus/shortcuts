/**
 * Tests for extracted chat pane components:
 *   ChatStartPane, ChatConversationPane, chatConversationUtils
 *
 * Validates that the components exist as standalone modules with the
 * same structure that RepoChatTab previously had inline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_START_PANE_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatStartPane.tsx'
);

const CHAT_CONVERSATION_PANE_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'ChatConversationPane.tsx'
);

const CHAT_UTILS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'chatConversationUtils.ts'
);

const REPO_CHAT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'
);

describe('ChatStartPane (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(CHAT_START_PANE_PATH, 'utf-8');
    });

    it('exports ChatStartPane as a named export', () => {
        expect(source).toContain('export function ChatStartPane');
    });

    it('exports ChatStartPaneProps interface', () => {
        expect(source).toContain('export interface ChatStartPaneProps');
    });

    it('renders "Chat with this repository" heading', () => {
        expect(source).toContain('Chat with this repository');
    });

    it('renders textarea with "Ask anything" placeholder', () => {
        expect(source).toContain('Ask anything');
    });

    it('renders Start Chat button', () => {
        expect(source).toContain('Start Chat');
    });

    it('renders read-only toggle with data-testid', () => {
        expect(source).toContain('data-testid="chat-readonly-toggle"');
    });

    it('renders model select with data-testid', () => {
        expect(source).toContain('data-testid="chat-model-select"');
    });

    it('renders start controls with data-testid', () => {
        expect(source).toContain('data-testid="chat-start-controls"');
    });

    it('renders SlashCommandMenu', () => {
        expect(source).toContain('<SlashCommandMenu');
    });

    it('renders ImagePreviews', () => {
        expect(source).toContain('<ImagePreviews');
    });

    it('renders back button with data-testid on mobile', () => {
        expect(source).toContain('data-testid="chat-detail-back-btn"');
    });

    it('handles Ctrl/Cmd+Enter for start', () => {
        expect(source).toContain("(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
    });

    it('disables Start Chat when input is empty', () => {
        expect(source).toContain('disabled={!inputValue.trim() || sending}');
    });

    it('renders Default option in model select', () => {
        expect(source).toContain('<option value="">Default</option>');
    });

    it('maps models to option elements', () => {
        expect(source).toContain('models.map(m =>');
    });

    it('has mobile-specific w-full justify-center on Start Chat button', () => {
        expect(source).toContain('className="w-full justify-center"');
    });

    it('has mobile-specific flex-1 on model select', () => {
        expect(source).toContain('"flex-1 px-2 py-1.5 text-sm rounded border');
    });

    it('has desktop model select without flex-1', () => {
        expect(source).toContain('"px-2 py-1.5 text-sm rounded border');
    });

    it('accepts onMobileBack prop', () => {
        expect(source).toContain('onMobileBack');
    });
});

describe('ChatConversationPane (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(CHAT_CONVERSATION_PANE_PATH, 'utf-8');
    });

    it('exports ChatConversationPane as a named export', () => {
        expect(source).toContain('export function ChatConversationPane');
    });

    it('exports ChatConversationPaneProps interface', () => {
        expect(source).toContain('export interface ChatConversationPaneProps');
    });

    it('renders conversation header with data-testid', () => {
        expect(source).toContain('data-testid="chat-conversation-header"');
    });

    it('renders Chat label in header', () => {
        expect(source).toContain('>Chat<');
    });

    it('renders read-only badge with data-testid', () => {
        expect(source).toContain('data-testid="chat-readonly-badge"');
    });

    it('renders Stop button when streaming', () => {
        expect(source).toContain('isStreaming && <Button');
        expect(source).toContain('>Stop<');
    });

    it('renders Cancel button when queued', () => {
        expect(source).toContain('data-testid="cancel-chat-header-btn"');
    });

    it('renders Resume in Terminal button', () => {
        expect(source).toContain('Resume in Terminal');
    });

    it('renders Resume button', () => {
        expect(source).toContain('↻ Resume');
    });

    it('renders model badge with data-testid', () => {
        expect(source).toContain('data-testid="chat-model-badge"');
    });

    it('renders copy conversation button with data-testid', () => {
        expect(source).toContain('data-testid="copy-conversation-btn"');
    });

    it('renders ConversationMetadataPopover', () => {
        expect(source).toContain('<ConversationMetadataPopover');
    });

    it('renders ConversationTurnBubble for turns', () => {
        expect(source).toContain('<ConversationTurnBubble');
        expect(source).toContain('turns.map');
    });

    it('renders Spinner when loading', () => {
        expect(source).toContain('loading ? <Spinner');
    });

    it('renders "Waiting to start" with inline cancel', () => {
        expect(source).toContain('Waiting to start…');
        expect(source).toContain('data-testid="cancel-chat-inline-btn"');
    });

    it('renders session expired message', () => {
        expect(source).toContain('Session expired — use header buttons to resume.');
    });

    it('renders SuggestionChips', () => {
        expect(source).toContain('<SuggestionChips');
    });

    it('renders follow-up textarea', () => {
        expect(source).toContain('Follow up… Type / for skills');
    });

    it('renders SlashCommandMenu in follow-up area', () => {
        expect(source).toContain('<SlashCommandMenu');
    });

    it('renders Send button', () => {
        expect(source).toContain("'Send'");
    });

    it('renders ImagePreviews for follow-up images', () => {
        expect(source).toContain('<ImagePreviews');
    });

    it('handles Ctrl/Cmd+Enter for send', () => {
        expect(source).toContain("(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
    });

    it('renders back button on mobile', () => {
        expect(source).toContain('data-testid="chat-detail-back-btn"');
    });

    it('renders error with retry button', () => {
        expect(source).toContain('⚠️ {error}');
        expect(source).toContain('Retry');
    });

    it('passes onRetry to ConversationTurnBubble for error turns', () => {
        expect(source).toContain('onRetry={');
        expect(source).toContain('turn.isError');
    });

    it('guards onRetry behind readOnly check', () => {
        const retryProp = source.substring(
            source.indexOf('onRetry={'),
            source.indexOf('onRetry={') + 300
        );
        expect(retryProp).toContain('!readOnly');
    });

    it('accepts conversationContainerRef and textareaRef props', () => {
        expect(source).toContain('conversationContainerRef');
        expect(source).toContain('textareaRef');
    });

    it('renders historical session separator', () => {
        expect(source).toContain('Resumed from previous session');
    });
});

describe('chatConversationUtils (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(CHAT_UTILS_PATH, 'utf-8');
    });

    it('exports getConversationTurns as a named export', () => {
        expect(source).toContain('export function getConversationTurns');
    });

    it('accepts optional task parameter', () => {
        expect(source).toContain('function getConversationTurns(data: any, task?: any)');
    });

    it('checks process.conversationTurns first', () => {
        expect(source).toContain('process?.conversationTurns');
    });

    it('falls back to data.conversation', () => {
        expect(source).toContain("data?.conversation");
    });

    it('falls back to data.turns', () => {
        expect(source).toContain("data?.turns");
    });

    it('creates synthetic turns from fullPrompt and result', () => {
        expect(source).toContain('process.fullPrompt || process.promptPreview');
        expect(source).toContain('process.result');
    });

    it('falls back to task.payload.prompt', () => {
        expect(source).toContain('task?.payload?.prompt');
    });

    it('imports ClientConversationTurn type', () => {
        expect(source).toContain("import type { ClientConversationTurn }");
    });
});

describe('RepoChatTab uses extracted components', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_CHAT_TAB_PATH, 'utf-8');
    });

    it('imports getConversationTurns from chatConversationUtils', () => {
        expect(source).toContain("import { getConversationTurns } from '../chat/chatConversationUtils'");
    });

    it('imports ChatStartPane from chat module', () => {
        expect(source).toContain("import { ChatStartPane } from '../chat/ChatStartPane'");
    });

    it('imports ChatConversationPane from chat module', () => {
        expect(source).toContain("import { ChatConversationPane } from '../chat/ChatConversationPane'");
    });

    it('no longer defines getConversationTurns inline', () => {
        expect(source).not.toContain('function getConversationTurns(data: any');
    });

    it('renderStartScreen delegates to ChatStartPane', () => {
        expect(source).toContain('<ChatStartPane');
    });

    it('renderConversation delegates to ChatConversationPane', () => {
        expect(source).toContain('<ChatConversationPane');
    });

    it('still exports RepoChatTab', () => {
        expect(source).toContain('export function RepoChatTab');
    });

    it('still renders chat-split-panel data-testid', () => {
        expect(source).toContain('data-testid="chat-split-panel"');
    });

    it('still renders ChatSessionSidebar', () => {
        expect(source).toContain('<ChatSessionSidebar');
    });

    it('still uses renderStartScreen and renderConversation as local helpers', () => {
        expect(source).toContain('const renderStartScreen');
        expect(source).toContain('const renderConversation');
    });
});
