/**
 * Tests for the floating New Chat dialog integration in RepoDetail.
 *
 * Validates that the top-bar New Chat button opens a floating dialog
 * instead of switching to the Chat tab, and that the dialog state
 * management (open/close/minimize) is properly wired.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

const REPO_CHAT_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoDetail: floating chat dialog integration', () => {
    it('imports NewChatDialog component', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { NewChatDialog } from '../chat/NewChatDialog'");
    });

    it('has chatDialog state with open/minimized/readOnly', () => {
        expect(REPO_DETAIL_SOURCE).toContain('chatDialog');
        expect(REPO_DETAIL_SOURCE).toContain('setChatDialog');
    });

    it('handleNewChatFromTopBar opens chatDialog instead of switching tabs', () => {
        // Should NOT call switchSubTab('chat')
        const handleFn = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('handleNewChatFromTopBar'),
            REPO_DETAIL_SOURCE.indexOf('handleNewChatFromTopBar') + 200,
        );
        expect(handleFn).toContain('setChatDialog');
        expect(handleFn).not.toContain("switchSubTab('chat')");
    });

    it('renders NewChatDialog when chatDialog.open is true', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<NewChatDialog');
        expect(REPO_DETAIL_SOURCE).toContain('chatDialog.open');
    });

    it('passes onMinimize/onRestore/onClose to NewChatDialog', () => {
        const dialogSection = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog'),
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog') + 600,
        );
        expect(dialogSection).toContain('onMinimize');
        expect(dialogSection).toContain('onRestore');
        expect(dialogSection).toContain('onClose');
    });

    it('passes readOnly from chatDialog state', () => {
        const dialogSection = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog'),
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog') + 600,
        );
        expect(dialogSection).toContain('chatDialog.readOnly');
    });

    it('passes minimized from chatDialog state', () => {
        const dialogSection = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog'),
            REPO_DETAIL_SOURCE.indexOf('<NewChatDialog') + 600,
        );
        expect(dialogSection).toContain('chatDialog.minimized');
    });

    it('New Chat (Terminal) still uses handleLaunchInTerminal', () => {
        expect(REPO_DETAIL_SOURCE).toContain('handleLaunchInTerminal');
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-new-chat-option-terminal"');
    });
});

describe('RepoChatTab: onOpenNewChatDialog prop', () => {
    it('accepts onOpenNewChatDialog prop', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('onOpenNewChatDialog');
    });

    it('passes onOpenNewChatDialog to ChatSessionSidebar onNewChat when provided', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('onOpenNewChatDialog ? onOpenNewChatDialog(readOnly) : handleNewChat(readOnly)');
    });

    it('falls back to handleNewChat when onOpenNewChatDialog is not provided', () => {
        expect(REPO_CHAT_TAB_SOURCE).toContain('handleNewChat(readOnly)');
    });
});

describe('RepoDetail: passes onOpenNewChatDialog to RepoChatTab', () => {
    it('RepoChatTab receives onOpenNewChatDialog callback', () => {
        const chatTabSection = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('<RepoChatTab'),
            REPO_DETAIL_SOURCE.indexOf('<RepoChatTab') + 400,
        );
        expect(chatTabSection).toContain('onOpenNewChatDialog');
    });
});
