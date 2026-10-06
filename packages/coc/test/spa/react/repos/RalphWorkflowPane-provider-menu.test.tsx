import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { ChatProvider } from '../../../../src/server/spa/client/react/features/chat/AgentSelectorChip';
import type { EffortTierKey } from '../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

// Keep the real shared controls and provider menu; isolate provider fetching and
// submission so opening a confirmation never operates on a live Ralph session.
vi.mock('../../../../src/server/spa/client/react/shared/ModalJobAiControls', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/ModalJobAiControls')>();
    return {
        ...actual,
        useModalJobAiSelection: () => {
            const [provider, setProvider] = useState<ChatProvider>('copilot');
            const [selectedEffortTier, setEffortTier] = useState<EffortTierKey>('medium');
            return {
                provider, setProvider, selectedEffortTier, setEffortTier,
                agentProviders: [
                    { id: 'copilot', label: 'Copilot', enabled: true, available: true },
                    { id: 'codex', label: 'Codex', enabled: true, available: true },
                ],
                providersLoading: false,
                useEffortTierMode: true,
                effortTierMap: {
                    low: { model: 'low-model', reasoningEffort: 'low', source: 'config' },
                    medium: { model: 'medium-model', reasoningEffort: 'medium', source: 'config' },
                },
                modelCommand: {},
                resolved: { provider, effortTier: selectedEffortTier },
                dirty: true,
            };
        },
    };
});

import { RalphWorkflowPane, type RalphSessionView } from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowPane';

afterEach(() => vi.restoreAllMocks());

describe('Ralph confirmation provider menu placement', () => {
    it.each(['resume', 'continue'] as const)('%s anchors below controls without covering the message', action => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
            return this.getAttribute('role') === 'listbox'
                ? new DOMRect(0, 0, 140, 120) : new DOMRect(100, 400, 80, 22);
        });
        const onResume = vi.fn();
        const onContinue = vi.fn();
        const view: RalphSessionView = {
            record: {
                sessionId: 'session', workspaceId: 'workspace', originalGoal: 'Test goal',
                phase: action === 'resume' ? 'executing' : 'complete',
                maxIterations: 10, currentIteration: 3,
                startedAt: '2026-01-01T00:00:00Z', iterations: [],
                ...(action === 'continue' ? { terminalReason: 'CAP_REACHED' } : {}),
            },
            sections: [], hasInFlightTask: false,
        };
        render(<RalphWorkflowPane workspaceId="workspace" sessionId="session" view={view}
            onResume={onResume} onContinue={onContinue} />);
        fireEvent.click(screen.getByTestId(`ralph-workflow-${action}`));
        const panel = screen.getByTestId(`ralph-workflow-${action}-confirm`);
        const trigger = within(panel).getByTestId('agent-selector-chip-btn');
        fireEvent.click(trigger);
        const menu = screen.getByRole('listbox', { name: 'Select agent provider' });
        expect(menu).toHaveStyle({ position: 'fixed', top: '426px', left: '100px' });
        expect(menu.parentElement).toBe(document.body);
        expect(panel.contains(menu)).toBe(false);
        expect(trigger).toHaveAttribute('aria-controls', menu.id);
        fireEvent.mouseDown(screen.getByTestId('agent-option-codex'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        expect(trigger).toHaveTextContent('Codex');
        expect(screen.queryByTestId('agent-selector-menu')).toBeNull();
        fireEvent.click(within(panel).getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-low'));
        expect(within(panel).getByTestId('effort-tier-label')).toHaveTextContent('Low');
        expect(onResume).not.toHaveBeenCalled();
        expect(onContinue).not.toHaveBeenCalled();
    });
});
