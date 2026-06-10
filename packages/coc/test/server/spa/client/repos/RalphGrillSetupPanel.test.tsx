/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockProviders = vi.hoisted(() => ({
    providers: [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        { id: 'codex', label: 'Codex', enabled: true, available: true },
        { id: 'claude', label: 'Claude', enabled: true, available: true },
    ],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({ providers: mockProviders.providers, loading: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: (provider?: string) => {
        const modelsByProvider: Record<string, any[]> = {
            copilot: [
                { id: 'gpt-5.5', name: 'GPT 5.5', enabled: true },
                { id: 'gpt-5.4', name: 'GPT 5.4', enabled: true },
            ],
            codex: [
                { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', enabled: true },
            ],
            claude: [
                { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', enabled: true },
            ],
        };
        return { models: modelsByProvider[provider ?? 'copilot'] ?? [], loading: false, error: null, reload: vi.fn() };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getDefaultProvider: () => 'copilot',
    getConfiguredDefaultProvider: () => 'copilot',
    isAutoAgentProviderRoutingEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { RalphGrillSetupPanel } from '../../../../../src/server/spa/client/react/features/chat/RalphGrillSetupPanel';
import type { RalphGrillSetup } from '../../../../../src/server/ralph/grill-planning';

function renderPanel(overrides: Partial<Parameters<typeof RalphGrillSetupPanel>[0]> = {}) {
    const onChange = vi.fn();
    const props = {
        value: { enabled: true, depth: 'standard', agents: [] } satisfies RalphGrillSetup,
        onChange,
        defaultProvider: 'copilot' as const,
        defaultModel: 'gpt-5.5',
        ...overrides,
    };
    render(<RalphGrillSetupPanel {...props} />);
    return { onChange };
}

describe('RalphGrillSetupPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to Standard depth and emits standard agent setup', async () => {
        const { onChange } = renderPanel();

        expect(screen.getByTestId('ralph-grill-setup-depth-standard').getAttribute('data-selected')).toBe('true');
        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
        expect(latest.depth).toBe('standard');
        expect(latest.agents?.map(agent => agent.role)).toEqual([
            'product',
            'ux',
            'architecture-system',
            'interaction',
            'failure-edge-cases',
            'quality-test',
        ]);
        expect(latest.agents?.[0]).toEqual({ role: 'product', provider: 'copilot', model: 'gpt-5.5' });
    });

    it('updates the emitted role set when depth changes', async () => {
        const { onChange } = renderPanel();

        fireEvent.click(screen.getByTestId('ralph-grill-setup-depth-deep'));

        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.depth).toBe('deep');
            expect(latest.agents?.map(agent => agent.role)).toContain('provenance');
            expect(latest.agents?.map(agent => agent.role)).toContain('deduplication');
        });
    });

    it('preserves per-agent provider and model selections', async () => {
        const { onChange } = renderPanel();

        fireEvent.change(screen.getByTestId('ralph-grill-setup-agent-ux-provider'), {
            target: { value: 'claude' },
        });
        fireEvent.change(screen.getByTestId('ralph-grill-setup-agent-ux-model'), {
            target: { value: 'claude-sonnet-4.6' },
        });

        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.agents?.find(agent => agent.role === 'ux')).toEqual({
                role: 'ux',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
            });
        });
    });
});
