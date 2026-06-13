import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    preferences: {
        getLlmToolsConfig: vi.fn(),
        updateLlmToolsConfig: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: mocks.preferences }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mocks.addToast }),
}));

import { LlmToolsPanel } from '../../../../src/server/spa/client/react/features/repo-settings/LlmToolsPanel';

const TOOLS = [
    {
        name: 'create_update_work_item',
        label: 'Create/Update Work Item',
        description: 'Creates typed work items and updates existing items.',
        enabledByDefault: true,
        params: [
            { name: 'title', type: 'string', required: true },
            { name: 'description', type: 'string', required: false },
            { name: 'plan', type: '{...}', required: false },
        ],
    },
    {
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the web.',
        enabledByDefault: false,
        params: [],
    },
    {
        name: 'memory',
        label: 'Memory',
        description: 'Reads and writes persistent memory.',
        enabledByDefault: true,
        // No params field at all -> schema unavailable.
    },
];

describe('LlmToolsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preferences.getLlmToolsConfig.mockResolvedValue({
            tools: TOOLS,
            disabledLlmTools: ['tavily_web_search'],
        });
        mocks.preferences.updateLlmToolsConfig.mockImplementation((_workspaceId: string, config: { disabledLlmTools: string[] }) =>
            Promise.resolve({ tools: TOOLS, disabledLlmTools: config.disabledLlmTools })
        );
    });

    it('loads and renders tool config through the typed preference client', async () => {
        render(<LlmToolsPanel workspaceId="repo/a" />);

        expect(screen.getByTestId('llm-tools-loading')).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledWith('repo/a');
        expect(screen.getByText('Create/Update Work Item')).toBeTruthy();
        expect(screen.getByText('Tavily Web Search')).toBeTruthy();
        expect((screen.getByTestId('llm-tool-toggle-create_update_work_item') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByTestId('llm-tool-toggle-tavily_web_search') as HTMLInputElement).checked).toBe(false);
    });

    it('sends disabled tool overrides when a tool is turned off', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-create_update_work_item')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-create_update_work_item'));
        });

        expect(mocks.preferences.updateLlmToolsConfig).toHaveBeenCalledWith('repo-a', {
            disabledLlmTools: ['tavily_web_search', 'create_update_work_item'],
        });
    });

    it('preserves explicit empty disabled-tool override arrays when enabling all tools', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue({
            tools: TOOLS,
            disabledLlmTools: ['create_update_work_item'],
        });

        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-create_update_work_item')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-create_update_work_item'));
        });

        expect(mocks.preferences.updateLlmToolsConfig).toHaveBeenCalledWith('repo-a', {
            disabledLlmTools: [],
        });
    });

    it('reverts local state and shows a toast when saving fails', async () => {
        mocks.preferences.updateLlmToolsConfig.mockRejectedValue(new Error('Save failed'));
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-create_update_work_item')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-create_update_work_item'));
        });

        await waitFor(() => {
            expect(mocks.addToast).toHaveBeenCalledWith('Save failed', 'error');
            expect((screen.getByTestId('llm-tool-toggle-create_update_work_item') as HTMLInputElement).checked).toBe(true);
        });
    });

    it('shows a collapsed parameter-count affordance without raw schemas', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-create_update_work_item');
        // Count is visible, but the per-parameter summary is collapsed by default.
        expect(toggle.textContent).toContain('3 parameters');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('llm-tool-params-create_update_work_item')).toBeNull();
    });

    it('expands inline to show required/optional parameter summaries on demand', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-create_update_work_item');
        await act(async () => { fireEvent.click(toggle); });

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const panel = screen.getByTestId('llm-tool-params-create_update_work_item');
        // Required -> `name: type*`; optional -> `name?: type`; nested stays `{...}`.
        expect(screen.getByTestId('llm-tool-param-create_update_work_item-title').textContent).toBe('title: string*');
        expect(screen.getByTestId('llm-tool-param-create_update_work_item-description').textContent).toBe('description?: string');
        expect(screen.getByTestId('llm-tool-param-create_update_work_item-plan').textContent).toBe('plan?: {...}');
        expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    });

    it('collapses the parameter summary again when the affordance is re-activated', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-create_update_work_item');
        await act(async () => { fireEvent.click(toggle); });
        expect(screen.getByTestId('llm-tool-params-create_update_work_item')).toBeTruthy();

        await act(async () => { fireEvent.click(toggle); });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('llm-tool-params-create_update_work_item')).toBeNull();
    });

    it('expanding parameters does not toggle the tool enable/disable checkbox', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const checkbox = screen.getByTestId('llm-tool-toggle-create_update_work_item') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        await act(async () => { fireEvent.click(screen.getByTestId('llm-tool-params-toggle-create_update_work_item')); });

        expect(checkbox.checked).toBe(true);
        expect(mocks.preferences.updateLlmToolsConfig).not.toHaveBeenCalled();
    });

    it('renders a compact empty-state for tools with no parameters', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        expect(screen.getByTestId('llm-tool-params-empty-tavily_web_search').textContent).toBe('No parameters');
        expect(screen.queryByTestId('llm-tool-params-toggle-tavily_web_search')).toBeNull();
    });

    it('renders a compact empty-state when a tool schema is unavailable', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        expect(screen.getByTestId('llm-tool-params-empty-memory').textContent).toBe('Parameters unavailable');
        expect(screen.queryByTestId('llm-tool-params-toggle-memory')).toBeNull();
    });
});
