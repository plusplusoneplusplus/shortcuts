/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

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
                {
                    id: 'gpt-5.5',
                    name: 'GPT 5.5',
                    enabled: true,
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                    capabilities: { supports: { reasoningEffort: true } },
                },
                {
                    id: 'gpt-5.4',
                    name: 'GPT 5.4',
                    enabled: true,
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                    capabilities: { supports: { reasoningEffort: true } },
                },
            ],
            codex: [
                {
                    id: 'gpt-5.3-codex',
                    name: 'GPT 5.3 Codex',
                    enabled: true,
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                    capabilities: { supports: { reasoningEffort: true } },
                },
            ],
            claude: [
                {
                    id: 'claude-sonnet-4.6',
                    name: 'Claude Sonnet 4.6',
                    enabled: true,
                    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
                    capabilities: { supports: { reasoningEffort: true } },
                },
                {
                    id: 'claude-opus-4.7',
                    name: 'Claude Opus 4.7',
                    enabled: true,
                    supportedReasoningEfforts: ['high', 'xhigh'],
                    capabilities: { supports: { reasoningEffort: true } },
                },
            ],
        };
        return { models: modelsByProvider[provider ?? 'copilot'] ?? [], loading: false, error: null, reload: vi.fn() };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: (_workspaceId: string | undefined, _mode: string, _models: any[], provider?: string) => {
        const defaults: Record<string, string> = {
            copilot: 'gpt-5.5',
            codex: 'gpt-5.3-codex',
            claude: 'claude-sonnet-4.6',
        };
        const effectiveModel = defaults[provider ?? 'copilot'];
        return { effectiveModel, effectiveModelName: effectiveModel };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    TIER_KEYS: ['very-low', 'low', 'medium', 'high'],
    useProviderEffortTiers: (provider?: string) => {
        const tiersByProvider: Record<string, any> = {
            copilot: {
                low: { model: 'gpt-5.4', reasoningEffort: 'low', source: 'default' },
                medium: { model: 'gpt-5.5', reasoningEffort: 'high', source: 'config' },
                high: { model: 'gpt-5.5', reasoningEffort: 'high', source: 'default' },
            },
            claude: {
                low: { model: 'claude-sonnet-4.6', reasoningEffort: 'medium', source: 'default' },
                medium: { model: 'claude-sonnet-4.6', reasoningEffort: 'high', source: 'config' },
                high: { model: 'claude-opus-4.7', reasoningEffort: 'xhigh', source: 'config' },
            },
            codex: {},
        };
        return {
            tiers: tiersByProvider[provider ?? 'copilot'] ?? {},
            loading: false,
            error: null,
            saveError: null,
            saving: false,
            dirty: false,
            setTier: vi.fn(),
            clearTier: vi.fn(),
            save: vi.fn(),
            cancel: vi.fn(),
            reload: vi.fn(),
        };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts', () => ({
    useProviderReasoningEfforts: (provider?: string) => {
        const effortsByProvider: Record<string, Record<string, string>> = {
            copilot: { 'gpt-5.5': 'medium' },
            codex: { 'gpt-5.3-codex': 'medium' },
            claude: { 'claude-sonnet-4.6': 'high' },
        };
        return effortsByProvider[provider ?? 'copilot'] ?? {};
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
        defaultEffortTier: 'medium' as const,
        effortLevelsEnabled: true,
        composerUsesEffortTierMode: true,
        workspaceId: 'ws-1',
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
        expect(latest.agents?.[0]).toEqual({
            role: 'product',
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            effortTier: 'medium',
        });
        expect(screen.queryByTestId('ralph-grill-setup-agent-product-model')).toBeNull();
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

    it('preserves per-agent provider and tier selections with resolved model and effort', async () => {
        const { onChange } = renderPanel();
        const uxRow = screen.getByTestId('ralph-grill-setup-agent-ux');

        fireEvent.change(within(uxRow).getByTestId('ralph-grill-setup-agent-ux-provider'), {
            target: { value: 'claude' },
        });
        fireEvent.click(within(uxRow).getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(within(uxRow).getByTestId('effort-tier-option-high'));

        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.agents?.find(agent => agent.role === 'ux')).toEqual({
                role: 'ux',
                provider: 'claude',
                model: 'claude-opus-4.7',
                reasoningEffort: 'xhigh',
                effortTier: 'high',
            });
        });
    });

    it('keeps the inherited tier when only provider changes', async () => {
        const { onChange } = renderPanel({ defaultEffortTier: 'low' });

        fireEvent.change(screen.getByTestId('ralph-grill-setup-agent-ux-provider'), {
            target: { value: 'claude' },
        });

        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.agents?.find(agent => agent.role === 'ux')).toEqual({
                role: 'ux',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'medium',
                effortTier: 'low',
            });
        });
    });

    it('hides per-role rows when effort levels are disabled and emits inherited composer settings', async () => {
        const { onChange } = renderPanel({
            effortLevelsEnabled: false,
            defaultReasoningEffort: 'medium',
        });

        expect(screen.getByTestId('ralph-grill-setup-agents-hidden')).toBeTruthy();
        expect(screen.queryByTestId('ralph-grill-setup-agent-product')).toBeNull();
        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.agents?.[0]).toEqual({
                role: 'product',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'medium',
            });
        });
    });

    it('hides tier pills for providers without tiers and resolves provider defaults', async () => {
        const { onChange } = renderPanel();

        fireEvent.change(screen.getByTestId('ralph-grill-setup-agent-ux-provider'), {
            target: { value: 'codex' },
        });

        expect(screen.getByTestId('ralph-grill-setup-agent-ux-tier-unavailable')).toBeTruthy();
        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)![0] as RalphGrillSetup;
            expect(latest.agents?.find(agent => agent.role === 'ux')).toEqual({
                role: 'ux',
                provider: 'codex',
                model: 'gpt-5.3-codex',
                reasoningEffort: 'medium',
            });
        });
    });

    it('wraps the depth selector and all agent rows in a single bounded scroll region', () => {
        renderPanel();

        const scroll = screen.getByTestId('ralph-grill-setup-scroll');
        // Bounded max height + vertical scroll so the panel cannot push the
        // composer/main chat controls off-screen.
        expect(scroll.className).toContain('overflow-y-auto');
        expect(scroll.className).toContain('max-h-[55vh]');

        // Depth selector and the per-role provider/tier rows scroll together as one
        // combined panel (both live inside the single scroll wrapper).
        expect(within(scroll).getByTestId('ralph-grill-setup-depth-standard')).toBeTruthy();
        const agents = within(scroll).getByTestId('ralph-grill-setup-agents');
        expect(within(scroll).getByTestId('ralph-grill-setup-agent-product')).toBeTruthy();

        // Avoid separate independent scroll regions: only the wrapper scrolls.
        expect(agents.className).not.toContain('overflow-y-auto');
        expect(screen.getByTestId('ralph-grill-setup-panel').className).not.toContain('overflow-y-auto');
    });

    it('keeps the deepest role list inside the bounded scroll region', () => {
        renderPanel();

        fireEvent.click(screen.getByTestId('ralph-grill-setup-depth-deep'));

        const scroll = screen.getByTestId('ralph-grill-setup-scroll');
        expect(scroll.className).toContain('overflow-y-auto');
        expect(within(scroll).getByTestId('ralph-grill-setup-agent-provenance')).toBeTruthy();
        expect(within(scroll).getByTestId('ralph-grill-setup-agent-deduplication')).toBeTruthy();
    });

    it('exposes agent focus text via tooltip instead of an always-visible description', () => {
        renderPanel();

        const row = screen.getByTestId('ralph-grill-setup-agent-product');
        const focus = row.getAttribute('title') ?? '';
        // Focus text stays available (tooltip) for accessibility/parity...
        expect(focus.length).toBeGreaterThan(0);
        // ...but is collapsed by default rather than rendered as a separate
        // visible description block, keeping each row compact.
        expect(row.textContent ?? '').not.toContain(focus);
    });
});
