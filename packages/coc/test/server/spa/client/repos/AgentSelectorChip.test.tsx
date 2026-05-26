/**
 * @vitest-environment jsdom
 * Tests for AgentSelectorChip — rendering, provider selection, disabled state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSelectorChip } from '../../../../../src/server/spa/client/react/features/chat/AgentSelectorChip';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

const COPILOT: AgentProviderStatus = {
    id: 'copilot',
    label: 'Copilot',
    enabled: true,
    available: true,
    locked: true,
};

const CODEX_ENABLED: AgentProviderStatus = {
    id: 'codex',
    label: 'Codex',
    enabled: true,
    available: true,
};

const CODEX_DISABLED: AgentProviderStatus = {
    id: 'codex',
    label: 'Codex',
    enabled: false,
    available: false,
};

const CODEX_UNAVAILABLE: AgentProviderStatus = {
    id: 'codex',
    label: 'Codex',
    enabled: true,
    available: false,
    reason: 'Codex SDK is not installed.',
};

describe('AgentSelectorChip', () => {
    describe('chip button display', () => {
        it('shows Copilot when selected is copilot', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            const btn = screen.getByTestId('agent-selector-chip-btn');
            expect(btn.textContent).toContain('Copilot');
        });

        it('shows Codex when selected is codex', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="codex"
                    onChange={vi.fn()}
                />
            );
            const btn = screen.getByTestId('agent-selector-chip-btn');
            expect(btn.textContent).toContain('Codex');
        });

        it('is disabled when loading', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT]}
                    loading={true}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            const btn = screen.getByTestId('agent-selector-chip-btn');
            expect(btn).toBeDisabled();
        });

        it('is disabled when disabled prop is set', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                    disabled={true}
                />
            );
            const btn = screen.getByTestId('agent-selector-chip-btn');
            expect(btn).toBeDisabled();
        });
    });

    describe('dropdown menu', () => {
        it('opens menu on click', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            expect(screen.queryByTestId('agent-selector-menu')).toBeNull();
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            expect(screen.getByTestId('agent-selector-menu')).toBeTruthy();
        });

        it('shows both provider options in menu', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            expect(screen.getByTestId('agent-option-copilot')).toBeTruthy();
            expect(screen.getByTestId('agent-option-codex')).toBeTruthy();
        });

        it('calls onChange when a provider option is clicked', () => {
            const onChange = vi.fn();
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={onChange}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            fireEvent.click(screen.getByTestId('agent-option-codex'));
            expect(onChange).toHaveBeenCalledWith('codex');
        });

        it('closes menu after selecting a provider', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            fireEvent.click(screen.getByTestId('agent-option-codex'));
            expect(screen.queryByTestId('agent-selector-menu')).toBeNull();
        });
    });

    describe('disabled/unavailable Codex', () => {
        it('Codex option is disabled when codex.enabled=false', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_DISABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            const codexOption = screen.getByTestId('agent-option-codex');
            expect(codexOption).toBeDisabled();
        });

        it('Codex option is disabled when unavailable', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_UNAVAILABLE]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            const codexOption = screen.getByTestId('agent-option-codex');
            expect(codexOption).toBeDisabled();
        });

        it('exposes the reason via the title tooltip (no inline subtitle) for unavailable Codex', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_UNAVAILABLE]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            const codexOption = screen.getByTestId('agent-option-codex');
            // Reason lives on the tooltip, not in the inline label — keeps the
            // menu compact while preserving discoverability on hover.
            expect(codexOption.getAttribute('title')).toContain('SDK is not installed');
            expect(codexOption.textContent).not.toContain('SDK is not installed');
            expect(codexOption.textContent).not.toContain('Disabled by admin');
        });

        it('falls back to a "disabled by admin" title when no reason is supplied', () => {
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_DISABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            const codexOption = screen.getByTestId('agent-option-codex');
            expect(codexOption.getAttribute('title')).toContain('disabled by admin');
            expect(codexOption.textContent).not.toContain('Disabled by admin');
        });

        it('does not call onChange when clicking disabled Codex option', () => {
            const onChange = vi.fn();
            render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_DISABLED]}
                    loading={false}
                    selected="copilot"
                    onChange={onChange}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            const codexOption = screen.getByTestId('agent-option-codex');
            // Clicking a disabled button does not fire onChange
            fireEvent.click(codexOption);
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('selected indicator', () => {
        it('checkmark is visible for selected provider in menu', () => {
            const { container } = render(
                <AgentSelectorChip
                    providers={[COPILOT, CODEX_ENABLED]}
                    loading={false}
                    selected="codex"
                    onChange={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            // The codex option should have aria-selected=true
            const codexOption = screen.getByTestId('agent-option-codex');
            expect(codexOption.getAttribute('aria-selected')).toBe('true');
            // Copilot should not be selected
            const copilotOption = screen.getByTestId('agent-option-copilot');
            expect(copilotOption.getAttribute('aria-selected')).toBe('false');
        });
    });
});
