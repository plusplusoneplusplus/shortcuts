/**
 * Tests for ChatDetailPane — verifies the empty-state renders NewChatArea.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock child components to isolate ChatDetailPane logic
vi.mock('../../../../src/server/spa/client/react/repos/ChatDetail', () => ({
    ChatDetail: (props: any) =>
        React.createElement('div', { 'data-testid': 'activity-chat-detail' }, `task=${props.taskId}`),
}));

vi.mock('../../../../src/server/spa/client/react/repos/NewChatArea', () => ({
    NewChatArea: (props: any) =>
        React.createElement('div', { 'data-testid': 'new-chat-area' }, `ws=${props.workspaceId}`),
}));

vi.mock('../../../../src/server/spa/client/react/context/PopOutContext', () => ({
    usePopOut: () => ({ poppedOutTasks: new Set(), markRestored: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/context/FloatingChatsContext', () => ({
    useFloatingChats: () => ({ floatingChats: new Set(), unfloatChat: vi.fn() }),
}));

import { ChatDetailPane } from '../../../../src/server/spa/client/react/repos/ChatDetailPane';

describe('ChatDetailPane', () => {
    it('renders NewChatArea when no task is selected', () => {
        render(<ChatDetailPane selectedTaskId={null} selectedTask={null} workspaceId="ws-1" />);
        const newChat = screen.getByTestId('new-chat-area');
        expect(newChat).toBeTruthy();
        expect(newChat.textContent).toContain('ws=ws-1');
    });

    it('renders ChatDetail when a task is selected', () => {
        render(<ChatDetailPane selectedTaskId="task-1" selectedTask={{}} workspaceId="ws-1" />);
        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail).toBeTruthy();
        expect(detail.textContent).toContain('task=task-1');
    });
});
