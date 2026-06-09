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
    },
    {
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the web.',
        enabledByDefault: false,
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
});
