/**
 * Tests for CommitChatPanel — thin wrapper around ChatDetail for commit-bound chats.
 *
 * Validates empty state, loading state, error state, delegation to ChatDetail,
 * close button, input handling, and correct props passthrough.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'commits', 'CommitChatPanel.tsx'
);

const CHAT_HEADER_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'ChatHeader.tsx'
);

const FOLLOW_UP_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'FollowUpInputArea.tsx'
);

const ACTIVITY_CHAT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'ChatDetail.tsx'
);

describe('CommitChatPanel', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    it('exports CommitChatPanelProps interface', () => {
        expect(source).toContain('export interface CommitChatPanelProps');
    });

    it('exports CommitChatPanel function', () => {
        expect(source).toContain('export function CommitChatPanel');
    });

    describe('renders empty state when no binding', () => {
        it('shows "Chat about this commit" text in empty state', () => {
            expect(source).toContain('Chat about this commit');
        });

        it('shows "Ask questions about the changes" description', () => {
            expect(source).toContain('Ask questions about the changes');
        });

        it('renders empty state only when no taskId, not loading, no error', () => {
            expect(source).toContain('{!taskId && !loading && !error && (');
        });

        it('renders RichTextInput with commit-chat-input testid', () => {
            expect(source).toContain('data-testid="commit-chat-input"');
        });

        it('renders Send button with commit-chat-send-btn testid', () => {
            expect(source).toContain('data-testid="commit-chat-send-btn"');
        });
    });

    describe('renders ChatDetail when taskId exists', () => {
        it('renders ChatDetail with taskId guard', () => {
            expect(source).toContain('{taskId && !loading && (');
        });

        it('imports ChatDetail', () => {
            expect(source).toContain("import { ChatDetail } from '../../chat/ChatDetail'");
        });

        it('passes taskId to ChatDetail', () => {
            expect(source).toContain('taskId={taskId}');
        });
    });

    describe('close button calls onClose', () => {
        it('renders close button with commit-chat-close-btn testid', () => {
            expect(source).toContain('data-testid="commit-chat-close-btn"');
        });

        it('close button calls onClose handler', () => {
            expect(source).toContain('onClick={onClose}');
        });
    });

    describe('sends new chat on Enter', () => {
        it('handles Enter key without Shift', () => {
            expect(source).toContain("e.key === 'Enter' && !e.shiftKey");
            expect(source).toContain('e.preventDefault()');
            expect(source).toContain('handleSend()');
        });

        it('handleSend trims input and calls createChat', () => {
            expect(source).toContain('const text = input.trim()');
            expect(source).toContain('await createChat(text');
        });

        it('clears input after send', () => {
            expect(source).toContain("setInput('')");
            expect(source).toContain("richTextRef.current?.setValue('')");
        });
    });

    describe('shows loading during binding fetch', () => {
        it('renders loading indicator', () => {
            expect(source).toContain('{loading && (');
            expect(source).toContain('Loading...');
        });
    });

    describe('shows error on fetch failure', () => {
        it('renders error state', () => {
            expect(source).toContain('{error && !loading && (');
            expect(source).toContain('{error}');
        });
    });

    describe('passes correct props to ChatDetail', () => {
        it('passes variant="floating"', () => {
            expect(source).toContain('variant="floating"');
        });

        it('passes standalone prop', () => {
            // standalone without value means true in JSX
            expect(source).toMatch(/standalone\b/);
        });

        it('passes title with commit hash prefix', () => {
            expect(source).toContain('title={`Commit Chat · ${commitHash.slice(0, 7)}`}');
        });

        it('passes hideModeSelector', () => {
            expect(source).toContain('hideModeSelector');
        });

        it('passes onBack={onClose}', () => {
            expect(source).toContain('onBack={onClose}');
        });
    });

    describe('commit hash display', () => {
        it('displays truncated commit hash in header', () => {
            expect(source).toContain('{commitHash.slice(0, 7)}');
        });

        it('has commit-chat-panel testid', () => {
            expect(source).toContain('data-testid="commit-chat-panel"');
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
    });
});

describe('ChatHeader — title prop', () => {
    let chatHeaderSource: string;

    beforeAll(() => {
        chatHeaderSource = fs.readFileSync(CHAT_HEADER_PATH, 'utf-8');
    });

    it('accepts optional title prop', () => {
        expect(chatHeaderSource).toContain('title?: string');
    });

    it('renders custom title when provided', () => {
        expect(chatHeaderSource).toContain("{title ?? 'Chat'}");
    });

    it('falls back to "Chat" without title', () => {
        expect(chatHeaderSource).toContain("title ?? 'Chat'");
    });
});

describe('FollowUpInputArea — hideModeSelector prop', () => {
    let followUpSource: string;

    beforeAll(() => {
        followUpSource = fs.readFileSync(FOLLOW_UP_PATH, 'utf-8');
    });

    it('accepts optional hideModeSelector prop', () => {
        expect(followUpSource).toContain('hideModeSelector?: boolean');
    });

    it('defaults hideModeSelector to false', () => {
        expect(followUpSource).toContain('hideModeSelector = false');
    });

    it('hides mode selector when hideModeSelector is true', () => {
        // Both layout branches gate mode-selector rendering on !hideModeSelector.
        expect(followUpSource).toMatch(/!hideModeSelector\s*&&[\s\S]*data-testid="mode-selector"/);
    });

    it('still renders mode selector by default (hideModeSelector=false)', () => {
        // Guard is {!hideModeSelector && ...} — false is default, so mode-selector renders
        expect(followUpSource).toContain('data-testid="mode-selector"');
    });
});

describe('ChatDetail — standalone, title, hideModeSelector props', () => {
    let actSource: string;

    beforeAll(() => {
        actSource = fs.readFileSync(ACTIVITY_CHAT_PATH, 'utf-8');
    });

    it('accepts standalone prop', () => {
        expect(actSource).toContain('standalone?: boolean');
    });

    it('accepts title prop', () => {
        expect(actSource).toContain("title?: string");
    });

    it('accepts hideModeSelector prop', () => {
        expect(actSource).toContain('hideModeSelector?: boolean');
    });

    it('standalone suppresses SELECT_QUEUE_TASK dispatch', () => {
        expect(actSource).toContain("if (!standalone) queueDispatch({ type: 'SELECT_QUEUE_TASK'");
    });

    it('non-standalone still dispatches SELECT_QUEUE_TASK', () => {
        // standalone defaults to false, so dispatch runs
        expect(actSource).toContain('standalone = false');
    });

    it('passes title to ChatHeader', () => {
        expect(actSource).toContain('title={(task?.customTitle as string | undefined) || title || task?.title || task?.displayName}');
    });

    it('passes hideModeSelector to FollowUpInputArea', () => {
        expect(actSource).toContain('hideModeSelector={hideModeSelector}');
    });
});
