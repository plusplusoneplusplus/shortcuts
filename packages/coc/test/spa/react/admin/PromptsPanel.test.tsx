/**
 * PromptsPanel — unit tests for the read-only prompts viewer panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { PromptsPanel } from '../../../../src/server/spa/client/react/admin/PromptsPanel';

const mockFetch = vi.fn();
const onError = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    onError.mockReset();
    global.fetch = mockFetch;
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
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        renderPanel();
        expect(screen.getByTestId('prompts-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    it('renders prompts grouped by category after fetch', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(MOCK_PROMPTS),
        });

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
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(MOCK_PROMPTS),
        });

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(screen.getByText('Prompt Templates')).toBeDefined();
            expect(screen.getByText(/read-only in this view/)).toBeDefined();
        });
    });

    it('calls onError when fetch fails', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500 });

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith('Failed to load prompts');
        });
    });

    it('calls onError when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith('Network error');
        });
    });

    it('renders prompt cards with correct data-testid', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(MOCK_PROMPTS),
        });

        await act(async () => { renderPanel(); });

        await waitFor(() => {
            const cards = screen.getAllByTestId('prompt-card');
            expect(cards.length).toBe(3);
        });
    });
});
