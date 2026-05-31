/**
 * PromptsPanel — unit tests for the read-only prompts viewer panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { PromptsPanel } from '../../../../src/server/spa/client/react/admin/PromptsPanel';

const mocks = vi.hoisted(() => ({
    admin: {
        getPrompts: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ admin: mocks.admin }),
    };
});

const onError = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.admin.getPrompts.mockReset();
    onError.mockReset();
});

function renderPanel() {
    return render(
        <AppProvider>
            <PromptsPanel onError={onError} />
        </AppProvider>
    );
}

const MOCK_PROMPTS = {
    'read-only-mode': {
        id: 'read-only-mode',
        title: 'Read-only Mode',
        group: 'Pipeline',
        source: 'forge/copilot-sdk-wrapper/types.ts',
        description: 'System message blocking file edits',
        text: 'You are in read-only mode.',
    },
    'memory-tool-schema': {
        id: 'memory-tool-schema',
        title: 'Memory Tool Schema',
        group: 'Memory',
        source: 'forge/memory/memory-tool.ts',
        description: 'Schema for write_memory tool',
        text: 'The write_memory tool schema.',
    },
    'follow-up-suggestions': {
        id: 'follow-up-suggestions',
        title: 'Follow-up Suggestions',
        group: 'UI',
        source: 'coc/server/suggest-follow-ups-tool.ts',
        description: 'Tool description for suggest_follow_ups',
        text: 'After completing your response, call this tool.',
    },
};

describe('PromptsPanel', () => {
    it('shows loading spinner initially', () => {
        mocks.admin.getPrompts.mockReturnValue(new Promise(() => {})); // never resolves
        renderPanel();
        expect(screen.getByTestId('prompts-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    it('renders prompts grouped by category after fetch', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByTestId('prompts-panel')).toBeDefined();
        });

        // Group headings
        expect(screen.getByText('Pipeline')).toBeDefined();
        expect(screen.getByText('Memory')).toBeDefined();
        expect(screen.getByText('UI')).toBeDefined();

        // Prompt titles
        expect(screen.getByText('Read-only Mode')).toBeDefined();
        expect(screen.getByText('Memory Tool Schema')).toBeDefined();
        expect(screen.getByText('Follow-up Suggestions')).toBeDefined();
    });

    it('renders the page header description', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText('Prompt Templates')).toBeDefined();
            expect(screen.getByText(/Editable prompts can be customised/)).toBeDefined();
        });
    });

    it('calls onError when fetch fails', async () => {
        mocks.admin.getPrompts.mockRejectedValue(new CocApiError({ status: 500, statusText: 'Internal Server Error', url: '/admin/prompts', message: 'Internal Server Error' }));

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalled();
        });
    });

    it('calls onError when fetch throws', async () => {
        mocks.admin.getPrompts.mockRejectedValue(new Error('Network error'));

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith('Network error');
        });
    });

    it('renders prompt cards with correct data-testid', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            const cards = screen.getAllByTestId('prompt-card');
            expect(cards.length).toBe(3);
        });
    });

    it('renders known prompt groups in configured order', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText('UI')).toBeDefined();
        });

        const headings = screen.getAllByRole('heading');
        const groupHeadings = headings.filter(h =>
            ['Pipeline', 'Memory', 'UI'].includes(h.textContent ?? '')
        );
        const lastGroup = groupHeadings[groupHeadings.length - 1];
        expect(lastGroup?.textContent).toBe('UI');
    });

    it('does not show edit buttons when no built-in prompt is editable', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText('Follow-up Suggestions')).toBeDefined();
        });
        expect(screen.queryByTestId('prompt-edit-btn')).toBeNull();
    });

    it('does not render the removed diff classification prompt', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText('Follow-up Suggestions')).toBeDefined();
        });
        expect(screen.queryByText('Diff Classification')).toBeNull();
        expect(screen.queryByText('Diff Classification - User Prompt')).toBeNull();
    });
});
