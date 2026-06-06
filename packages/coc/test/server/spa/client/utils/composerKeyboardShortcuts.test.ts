import { describe, expect, it } from 'vitest';
import {
    cycleChatProvider,
    cycleConfiguredEffortTier,
    cycleReasoningEffort,
    isEffortCycleShortcut,
    isProviderCycleShortcut,
} from '../../../../../src/server/spa/client/react/utils/composerKeyboardShortcuts';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import type { LocalEffortTiersMap } from '../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

describe('composerKeyboardShortcuts', () => {
    describe('cycleConfiguredEffortTier', () => {
        it('cycles through configured tiers in visible order and skips unconfigured tiers', () => {
            const tiers: LocalEffortTiersMap = {
                'very-low': { model: 'mini', reasoningEffort: 'low', source: 'config' },
                medium: { model: 'balanced', reasoningEffort: '', source: 'config' },
                high: { model: 'deep', reasoningEffort: 'high', source: 'config' },
            };

            expect(cycleConfiguredEffortTier('very-low', tiers, 1)).toEqual({ changed: true, value: 'medium' });
            expect(cycleConfiguredEffortTier('medium', tiers, -1)).toEqual({ changed: true, value: 'very-low' });
        });

        it('clamps at the ends without wrapping', () => {
            const tiers: LocalEffortTiersMap = {
                low: { model: 'fast', reasoningEffort: '', source: 'config' },
                high: { model: 'deep', reasoningEffort: 'high', source: 'config' },
            };

            expect(cycleConfiguredEffortTier('high', tiers, 1)).toEqual({ changed: false, value: 'high' });
            expect(cycleConfiguredEffortTier('low', tiers, -1)).toEqual({ changed: false, value: 'low' });
        });

        it('is a quiet no-op when there is no selectable alternative', () => {
            const tiers: LocalEffortTiersMap = {
                medium: { model: 'balanced', reasoningEffort: '', source: 'config' },
            };

            expect(cycleConfiguredEffortTier('medium', tiers, 1)).toEqual({ changed: false, value: 'medium' });
            expect(cycleConfiguredEffortTier('medium', {}, -1)).toEqual({ changed: false, value: 'medium' });
        });
    });

    describe('cycleReasoningEffort', () => {
        it('cycles through Auto and selectable reasoning-effort options in visible order', () => {
            const options = [{ value: 'low' as const }, { value: 'high' as const }];

            expect(cycleReasoningEffort(null, options, 1)).toEqual({ changed: true, value: 'low' });
            expect(cycleReasoningEffort('low', options, 1)).toEqual({ changed: true, value: 'high' });
            expect(cycleReasoningEffort('high', options, 1)).toEqual({ changed: false, value: 'high' });
        });

        it('skips unavailable reasoning-effort options and clamps at the boundary', () => {
            const options = [{ value: 'medium' as const }, { value: 'xhigh' as const }];

            expect(cycleReasoningEffort(null, options, -1)).toEqual({ changed: false, value: null });
            expect(cycleReasoningEffort('xhigh', options, -1)).toEqual({ changed: true, value: 'medium' });
        });

        it('is a quiet no-op when Auto is the only selectable option', () => {
            expect(cycleReasoningEffort(null, [], 1)).toEqual({ changed: false, value: null });
        });
    });

    describe('cycleChatProvider', () => {
        const providers: AgentProviderStatus[] = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true },
            { id: 'codex', label: 'Codex', enabled: true, available: false },
            { id: 'claude', label: 'Claude', enabled: true, available: true },
        ];

        it('skips disabled or unavailable providers', () => {
            expect(cycleChatProvider('copilot', providers, 1)).toEqual({ changed: true, value: 'claude' });
            expect(cycleChatProvider('claude', providers, -1)).toEqual({ changed: true, value: 'copilot' });
        });

        it('clamps at the boundary without wrapping', () => {
            expect(cycleChatProvider('claude', providers, 1)).toEqual({ changed: false, value: 'claude' });
            expect(cycleChatProvider('copilot', providers, -1)).toEqual({ changed: false, value: 'copilot' });
        });

        it('no-ops when no alternative provider is selectable', () => {
            expect(cycleChatProvider('copilot', [providers[0]], 1)).toEqual({ changed: false, value: 'copilot' });
        });
    });

    describe('shortcut detection', () => {
        it('recognizes only Shift+Arrow effort shortcuts', () => {
            expect(isEffortCycleShortcut({ key: 'ArrowDown', shiftKey: true })).toBe(true);
            expect(isEffortCycleShortcut({ key: 'ArrowDown' })).toBe(false);
            expect(isEffortCycleShortcut({ key: 'ArrowDown', shiftKey: true, ctrlKey: true })).toBe(false);
        });

        it('uses Ctrl on Windows/Linux and Cmd on macOS for provider shortcuts', () => {
            expect(isProviderCycleShortcut({ key: 'ArrowDown', ctrlKey: true }, 'Linux x86_64')).toBe(true);
            expect(isProviderCycleShortcut({ key: 'ArrowDown', metaKey: true }, 'Linux x86_64')).toBe(false);
            expect(isProviderCycleShortcut({ key: 'ArrowUp', metaKey: true }, 'MacIntel')).toBe(true);
            expect(isProviderCycleShortcut({ key: 'ArrowUp', ctrlKey: true }, 'MacIntel')).toBe(false);
        });
    });
});
