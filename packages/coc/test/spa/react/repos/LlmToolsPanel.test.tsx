import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
        name: 'demo_tool',
        label: 'Demo Tool',
        description: 'A demo tool with a locally declared parameter schema.',
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
        name: 'schemaless_tool',
        label: 'Schemaless Tool',
        description: 'A tool whose parameter schema is not declared locally.',
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
        expect(screen.getByText('Demo Tool')).toBeTruthy();
        expect(screen.getByText('Tavily Web Search')).toBeTruthy();
        expect((screen.getByTestId('llm-tool-toggle-demo_tool') as HTMLInputElement).checked).toBe(true);
        expect((screen.getByTestId('llm-tool-toggle-tavily_web_search') as HTMLInputElement).checked).toBe(false);
    });

    it('sends disabled tool overrides when a tool is turned off', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-demo_tool')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-demo_tool'));
        });

        expect(mocks.preferences.updateLlmToolsConfig).toHaveBeenCalledWith('repo-a', {
            disabledLlmTools: ['tavily_web_search', 'demo_tool'],
        });
    });

    it('preserves explicit empty disabled-tool override arrays when enabling all tools', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue({
            tools: TOOLS,
            disabledLlmTools: ['demo_tool'],
        });

        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-demo_tool')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-demo_tool'));
        });

        expect(mocks.preferences.updateLlmToolsConfig).toHaveBeenCalledWith('repo-a', {
            disabledLlmTools: [],
        });
    });

    it('reverts local state and shows a toast when saving fails', async () => {
        mocks.preferences.updateLlmToolsConfig.mockRejectedValue(new Error('Save failed'));
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-demo_tool')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-demo_tool'));
        });

        await waitFor(() => {
            expect(mocks.addToast).toHaveBeenCalledWith('Save failed', 'error');
            expect((screen.getByTestId('llm-tool-toggle-demo_tool') as HTMLInputElement).checked).toBe(true);
        });
    });

    it('shows a collapsed parameter-count affordance without raw schemas', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-demo_tool');
        // Count is visible, but the per-parameter summary is collapsed by default.
        expect(toggle.textContent).toContain('3 parameters');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('llm-tool-params-demo_tool')).toBeNull();
    });

    it('expands inline to show required/optional parameter summaries on demand', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-demo_tool');
        await act(async () => { fireEvent.click(toggle); });

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const panel = screen.getByTestId('llm-tool-params-demo_tool');
        // Required -> `name: type*`; optional -> `name?: type`; nested stays `{...}`.
        expect(screen.getByTestId('llm-tool-param-demo_tool-title').textContent).toBe('title: string*');
        expect(screen.getByTestId('llm-tool-param-demo_tool-description').textContent).toBe('description?: string');
        expect(screen.getByTestId('llm-tool-param-demo_tool-plan').textContent).toBe('plan?: {...}');
        expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    });

    it('collapses the parameter summary again when the affordance is re-activated', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-demo_tool');
        await act(async () => { fireEvent.click(toggle); });
        expect(screen.getByTestId('llm-tool-params-demo_tool')).toBeTruthy();

        await act(async () => { fireEvent.click(toggle); });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('llm-tool-params-demo_tool')).toBeNull();
    });

    it('expanding parameters does not toggle the tool enable/disable checkbox', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const checkbox = screen.getByTestId('llm-tool-toggle-demo_tool') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        await act(async () => { fireEvent.click(screen.getByTestId('llm-tool-params-toggle-demo_tool')); });

        expect(checkbox.checked).toBe(true);
        expect(mocks.preferences.updateLlmToolsConfig).not.toHaveBeenCalled();
    });

    it('exposes the parameter affordance as a focusable native button activated by Enter and Space', async () => {
        const user = userEvent.setup();
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        const toggle = screen.getByTestId('llm-tool-params-toggle-demo_tool') as HTMLButtonElement;
        // Native <button> => platform-provided keyboard operability, reachable in the
        // tab order, with an accessible label/state and no hover-only dependency.
        expect(toggle.tagName).toBe('BUTTON');
        expect(toggle.disabled).toBe(false);
        expect(toggle.getAttribute('aria-hidden')).toBeNull();
        expect(toggle.getAttribute('tabindex')).not.toBe('-1');
        expect(toggle.getAttribute('aria-label')).toBe('Demo Tool: 3 parameters');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        // Reachable via keyboard focus.
        toggle.focus();
        expect(document.activeElement).toBe(toggle);

        // Enter expands the summary without any pointer interaction.
        await user.keyboard('{Enter}');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('llm-tool-params-demo_tool')).toBeTruthy();

        // Space collapses it again (button keeps focus across the re-render).
        expect(document.activeElement).toBe(toggle);
        await user.keyboard(' ');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('llm-tool-params-demo_tool')).toBeNull();
    });

    it('lays out for narrow screens: single-column grid, wrapping params, and a fit-width affordance', async () => {
        render(<LlmToolsPanel workspaceId="repo-a" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());

        // Single column by default (narrow screens), two columns only from the `sm` breakpoint up.
        const list = screen.getByTestId('llm-tools-list');
        expect(list.className).toContain('grid-cols-1');
        expect(list.className).toContain('sm:grid-cols-2');

        // The affordance hugs its content rather than stretching, and is not hover-only.
        const toggle = screen.getByTestId('llm-tool-params-toggle-demo_tool');
        expect(toggle.className).toContain('w-fit');

        // Expanded parameter tokens wrap instead of overflowing on narrow widths.
        await act(async () => { fireEvent.click(toggle); });
        expect(screen.getByTestId('llm-tool-params-demo_tool').className).toContain('flex-wrap');
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

        expect(screen.getByTestId('llm-tool-params-empty-schemaless_tool').textContent).toBe('Parameters unavailable');
        expect(screen.queryByTestId('llm-tool-params-toggle-schemaless_tool')).toBeNull();
    });
});
