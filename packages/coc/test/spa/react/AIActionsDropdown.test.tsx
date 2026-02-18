import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { AIActionsDropdown } from '../../../src/server/spa/client/react/shared/AIActionsDropdown';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    });
});

function renderDropdown(props?: Partial<{ wsId: string; taskPath: string }>) {
    return render(
        <AppProvider>
            <AIActionsDropdown wsId={props?.wsId ?? 'ws-1'} taskPath={props?.taskPath ?? 'test/task.md'} />
        </AppProvider>
    );
}

describe('AIActionsDropdown', () => {
    it('renders the trigger button', () => {
        renderDropdown();
        expect(screen.getByTestId('ai-actions-trigger')).toBeDefined();
    });

    it('opens menu on trigger click', async () => {
        renderDropdown();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ai-actions-trigger'));
        });
        expect(screen.getByTestId('ai-actions-menu')).toBeDefined();
        expect(screen.getByText('Follow Prompt')).toBeDefined();
        expect(screen.getByText('Update Document')).toBeDefined();
    });

    it('closes menu on second trigger click', async () => {
        renderDropdown();
        const trigger = screen.getByTestId('ai-actions-trigger');

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.getByTestId('ai-actions-menu')).toBeDefined();

        await act(async () => {
            fireEvent.click(trigger);
        });
        expect(screen.queryByTestId('ai-actions-menu')).toBeNull();
    });

    it('closes menu on Escape key', async () => {
        renderDropdown();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ai-actions-trigger'));
        });
        expect(screen.getByTestId('ai-actions-menu')).toBeDefined();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        expect(screen.queryByTestId('ai-actions-menu')).toBeNull();
    });

    it('clicking Follow Prompt opens the dialog', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });

        renderDropdown();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ai-actions-trigger'));
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Follow Prompt'));
        });

        await waitFor(() => {
            expect(screen.getByText('Follow Prompt')).toBeDefined();
        });
    });

    it('clicking Update Document opens the dialog', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });

        renderDropdown();
        await act(async () => {
            fireEvent.click(screen.getByTestId('ai-actions-trigger'));
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Update Document'));
        });

        await waitFor(() => {
            expect(screen.getByText('Update Document')).toBeDefined();
        });
    });
});
