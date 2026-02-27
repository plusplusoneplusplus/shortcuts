import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    ConversationMetadataPopover,
    getSessionIdFromProcess,
} from '../../../src/server/spa/client/react/processes/ConversationMetadataPopover';

beforeEach(() => {
    vi.restoreAllMocks();
});

const BASE_PROCESS = {
    id: 'proc-abc-123',
    type: 'chat',
    status: 'completed',
    startTime: '2026-01-15T10:00:00Z',
    endTime: '2026-01-15T10:05:00Z',
    workingDirectory: '/home/user/project',
    workspaceName: 'my-workspace',
    metadata: { queueTaskId: 'qt-456', model: 'gpt-4', backend: 'copilot-sdk' },
};

function renderPopover(process: any = BASE_PROCESS, turnsCount?: number) {
    return render(<ConversationMetadataPopover process={process} turnsCount={turnsCount} />);
}

describe('ConversationMetadataPopover', () => {
    it('renders nothing when process has no displayable rows', () => {
        const { container } = renderPopover({});
        expect(container.innerHTML).toBe('');
    });

    it('renders the trigger button with "i" text', () => {
        renderPopover();
        const btn = screen.getByRole('button', { name: /conversation metadata/i });
        expect(btn).toBeDefined();
        expect(btn.textContent).toBe('i');
    });

    it('opens popover on trigger click and shows header', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Conversation metadata')).toBeDefined();
    });

    it('displays process metadata rows', async () => {
        renderPopover(BASE_PROCESS, 5);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Process ID')).toBeDefined();
        expect(screen.getByText('proc-abc-123')).toBeDefined();
        expect(screen.getByText('Queue Task ID')).toBeDefined();
        expect(screen.getByText('qt-456')).toBeDefined();
        expect(screen.getByText('Type')).toBeDefined();
        expect(screen.getByText('chat')).toBeDefined();
        expect(screen.getByText('Status')).toBeDefined();
        expect(screen.getByText('completed')).toBeDefined();
        expect(screen.getByText('Model')).toBeDefined();
        expect(screen.getByText('gpt-4')).toBeDefined();
        expect(screen.getByText('Backend')).toBeDefined();
        expect(screen.getByText('copilot-sdk')).toBeDefined();
        expect(screen.getByText('Working Directory')).toBeDefined();
        expect(screen.getByText('/home/user/project')).toBeDefined();
        expect(screen.getByText('Workspace')).toBeDefined();
        expect(screen.getByText('my-workspace')).toBeDefined();
        expect(screen.getByText('Turns')).toBeDefined();
        expect(screen.getByText('5')).toBeDefined();
    });

    it('renders popover via createPortal into document.body', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const popover = document.querySelector('.fixed.z-50');
        expect(popover).not.toBeNull();
        expect(popover?.parentElement).toBe(document.body);
    });

    it('closes popover on second trigger click', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('closes popover on Escape key', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('closes popover on outside mousedown', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        await act(async () => {
            fireEvent.mouseDown(document.body);
        });
        expect(screen.queryByText('Conversation metadata')).toBeNull();
    });

    it('does not close popover when clicking inside it', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const header = screen.getByText('Conversation metadata');
        await act(async () => {
            fireEvent.mouseDown(header);
        });
        expect(screen.getByText('Conversation metadata')).toBeDefined();
    });

    it('uses fixed positioning with style top/left', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const popover = document.querySelector('.fixed.z-50') as HTMLElement;
        expect(popover).not.toBeNull();
        expect(popover.style.top).toBeDefined();
        expect(popover.style.left).toBeDefined();
    });

    it('uses grid layout with label+value columns', async () => {
        renderPopover();
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        const grid = document.querySelector('.grid');
        expect(grid).not.toBeNull();
    });

    it('omits rows with null/empty values', async () => {
        const sparseProcess = { id: 'p-1', status: 'running' };
        renderPopover(sparseProcess);
        const trigger = screen.getByRole('button', { name: /conversation metadata/i });

        await act(async () => {
            fireEvent.click(trigger);
        });

        expect(screen.getByText('Process ID')).toBeDefined();
        expect(screen.getByText('Status')).toBeDefined();
        expect(screen.queryByText('Queue Task ID')).toBeNull();
        expect(screen.queryByText('Model')).toBeNull();
        expect(screen.queryByText('Working Directory')).toBeNull();
    });
});

describe('getSessionIdFromProcess', () => {
    it('returns null for null/undefined process', () => {
        expect(getSessionIdFromProcess(null)).toBeNull();
        expect(getSessionIdFromProcess(undefined)).toBeNull();
    });

    it('returns sdkSessionId when available', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: 'sdk-123' })).toBe('sdk-123');
    });

    it('returns sessionId when sdkSessionId is absent', () => {
        expect(getSessionIdFromProcess({ sessionId: 'sess-456' })).toBe('sess-456');
    });

    it('parses sessionId from result JSON string', () => {
        const process = { result: JSON.stringify({ sessionId: 'from-result' }) };
        expect(getSessionIdFromProcess(process)).toBe('from-result');
    });

    it('prefers sdkSessionId over sessionId', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: 'sdk', sessionId: 'sess' })).toBe('sdk');
    });

    it('returns null when no session ID found', () => {
        expect(getSessionIdFromProcess({ id: 'proc-1' })).toBeNull();
    });

    it('returns null for invalid result JSON', () => {
        expect(getSessionIdFromProcess({ result: 'not-json' })).toBeNull();
    });

    it('returns null for empty string values', () => {
        expect(getSessionIdFromProcess({ sdkSessionId: '', sessionId: '  ' })).toBeNull();
    });
});
