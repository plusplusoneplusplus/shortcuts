/**
 * PromptsPanel — unit tests for the read-only prompts viewer panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { PromptsPanel } from '../../../../src/server/spa/client/react/admin/PromptsPanel';

const mocks = vi.hoisted(() => ({
    admin: {
        getPrompts: vi.fn(),
        getConfig: vi.fn(),
        updateConfig: vi.fn(),
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
    mocks.admin.getConfig.mockReset();
    mocks.admin.updateConfig.mockReset();
    // Default: empty global prompt so the editor resolves out of its loading state.
    mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: {} } });
    mocks.admin.updateConfig.mockResolvedValue({ resolved: { chat: {} } });
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

describe('PromptsPanel — Global System Prompt editor', () => {
    it('loads the resolved global prompt into the editor', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: { globalSystemPrompt: 'Stay terse.' } } });

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            const input = screen.getByTestId('global-system-prompt-input') as HTMLTextAreaElement;
            expect(input.value).toBe('Stay terse.');
        });
        expect(mocks.admin.getConfig).toHaveBeenCalled();
    });

    it('makes the cross-provider scope clear in the help text', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText(/Copilot, Codex, and Claude/)).toBeDefined();
        });
    });

    it('keeps the built-in template list visible below the editor', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: { globalSystemPrompt: 'Hello' } } });

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByTestId('global-system-prompt-input')).toBeDefined();
        });
        // Templates still render alongside the editor.
        expect(screen.getByText('Prompt Templates')).toBeDefined();
        expect(screen.getByText('Read-only Mode')).toBeDefined();
    });

    it('marks the editor dirty when edited and enables save', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: { globalSystemPrompt: 'orig' } } });

        await act(async () => { renderPanel(); });

        const saveBtn = await screen.findByTestId('global-system-prompt-save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true); // not dirty initially

        const input = screen.getByTestId('global-system-prompt-input');
        await act(async () => { fireEvent.change(input, { target: { value: 'orig changed' } }); });

        expect(saveBtn.disabled).toBe(false);
        expect(screen.getByText('Unsaved changes')).toBeDefined();
    });

    it('saves the edited prompt via updateConfig', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);

        await act(async () => { renderPanel(); });

        const input = await screen.findByTestId('global-system-prompt-input');
        await act(async () => { fireEvent.change(input, { target: { value: 'Be concise.' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('global-system-prompt-save')); });

        await waitFor(() => {
            expect(mocks.admin.updateConfig).toHaveBeenCalledWith({ 'chat.globalSystemPrompt': 'Be concise.' });
        });
        // Saving clears the dirty state.
        const saveBtn = screen.getByTestId('global-system-prompt-save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
    });

    it('clears the stored prompt via updateConfig with null', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: { globalSystemPrompt: 'Old prompt' } } });

        await act(async () => { renderPanel(); });

        const clearBtn = await screen.findByTestId('global-system-prompt-clear');
        await act(async () => { fireEvent.click(clearBtn); });

        await waitFor(() => {
            expect(mocks.admin.updateConfig).toHaveBeenCalledWith({ 'chat.globalSystemPrompt': null });
        });
        const input = screen.getByTestId('global-system-prompt-input') as HTMLTextAreaElement;
        expect(input.value).toBe('');
    });

    it('clears the stored value when saving an empty prompt', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockResolvedValue({ resolved: { chat: { globalSystemPrompt: 'something' } } });

        await act(async () => { renderPanel(); });

        const input = await screen.findByTestId('global-system-prompt-input');
        await act(async () => { fireEvent.change(input, { target: { value: '   ' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('global-system-prompt-save')); });

        await waitFor(() => {
            expect(mocks.admin.updateConfig).toHaveBeenCalledWith({ 'chat.globalSystemPrompt': null });
        });
    });

    it('displays an error when saving fails', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.updateConfig.mockRejectedValue(new Error('boom'));

        await act(async () => { renderPanel(); });

        const input = await screen.findByTestId('global-system-prompt-input');
        await act(async () => { fireEvent.change(input, { target: { value: 'X' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('global-system-prompt-save')); });

        await waitFor(() => {
            expect(screen.getByTestId('global-system-prompt-error')).toBeDefined();
            expect(screen.getByText('boom')).toBeDefined();
        });
    });

    it('surfaces a load error through onError', async () => {
        mocks.admin.getPrompts.mockResolvedValue(MOCK_PROMPTS);
        mocks.admin.getConfig.mockRejectedValue(new Error('config down'));

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith('config down');
        });
    });
});
