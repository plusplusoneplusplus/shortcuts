/**
 * Tests for the "Create Work Item from Chat" button in ChatHeader
 * and its integration with ActivityChatDetail + CreateWorkItemDialog.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const CHAT_HEADER_SRC_PATH = path.join(REACT_SRC, 'repos', 'ChatHeader.tsx');
const ACTIVITY_CHAT_DETAIL_SRC_PATH = path.join(REACT_SRC, 'repos', 'ActivityChatDetail.tsx');
const CREATE_WORK_ITEM_DIALOG_SRC_PATH = path.join(REACT_SRC, 'repos', 'CreateWorkItemDialog.tsx');

describe('ChatHeader — Create Work Item button', () => {
    let headerSrc: string;

    beforeAll(() => {
        headerSrc = fs.readFileSync(CHAT_HEADER_SRC_PATH, 'utf-8');
    });

    it('declares onCreateWorkItem as an optional callback prop', () => {
        expect(headerSrc).toContain('onCreateWorkItem?: () => void');
    });

    it('destructures onCreateWorkItem in the function signature', () => {
        expect(headerSrc).toContain('onCreateWorkItem,');
    });

    it('renders a button with data-testid="create-work-item-from-chat-btn"', () => {
        expect(headerSrc).toContain('data-testid="create-work-item-from-chat-btn"');
    });

    it('calls onCreateWorkItem when the button is clicked', () => {
        expect(headerSrc).toContain('onClick={onCreateWorkItem}');
    });

    it('conditionally renders the button only when onCreateWorkItem is provided', () => {
        expect(headerSrc).toContain('{onCreateWorkItem && (');
    });

    it('has a descriptive title attribute on the button', () => {
        expect(headerSrc).toContain('title="Create work item from chat"');
    });
});

describe('ActivityChatDetail — CreateWorkItemDialog integration', () => {
    let detailSrc: string;

    beforeAll(() => {
        detailSrc = fs.readFileSync(ACTIVITY_CHAT_DETAIL_SRC_PATH, 'utf-8');
    });

    it('imports CreateWorkItemDialog', () => {
        expect(detailSrc).toContain("import { CreateWorkItemDialog } from './CreateWorkItemDialog'");
    });

    it('declares showCreateWorkItem state', () => {
        expect(detailSrc).toContain('useState(false)');
        expect(detailSrc).toContain('showCreateWorkItem');
    });

    it('passes onCreateWorkItem callback to ChatHeader', () => {
        expect(detailSrc).toContain('onCreateWorkItem={');
        expect(detailSrc).toContain('setShowCreateWorkItem(true)');
    });

    it('only provides onCreateWorkItem when workspaceId is available', () => {
        expect(detailSrc).toContain('workspaceId ? () => setShowCreateWorkItem(true) : undefined');
    });

    it('renders CreateWorkItemDialog with fromChatId bound to processId', () => {
        expect(detailSrc).toContain('<CreateWorkItemDialog');
        expect(detailSrc).toContain('fromChatId={processId');
    });

    it('passes showCreateWorkItem as the open prop', () => {
        expect(detailSrc).toContain('open={showCreateWorkItem}');
    });

    it('closes dialog via setShowCreateWorkItem(false)', () => {
        expect(detailSrc).toContain('onClose={() => setShowCreateWorkItem(false)}');
    });

    it('conditionally renders dialog only when workspaceId is defined', () => {
        expect(detailSrc).toContain('{workspaceId && (');
    });
});

describe('CreateWorkItemDialog — fromChat support', () => {
    let dialogSrc: string;

    beforeAll(() => {
        dialogSrc = fs.readFileSync(CREATE_WORK_ITEM_DIALOG_SRC_PATH, 'utf-8');
    });

    it('accepts fromChatId prop', () => {
        expect(dialogSrc).toContain('fromChatId?: string');
    });

    it('calls from-chat endpoint when fromChatId is provided', () => {
        expect(dialogSrc).toContain('/from-chat');
        expect(dialogSrc).toContain('processId: fromChatId');
    });

    it('shows chat session indicator for fromChat mode', () => {
        expect(dialogSrc).toContain('Creating from chat session');
    });
});
