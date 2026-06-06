/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { cycleMode, DEFAULT_CHAT_MODES, MODE_LABELS, MODE_ICONS, MODE_BORDER_COLORS, MODE_TEXT_COLORS, MODE_TOOLTIPS, getVisibleChatModes, normalizeChatMode, WORKFLOW_REGISTRY } from '../../../../../src/server/spa/client/react/repos/modeConfig';
import type { ChatMode } from '../../../../../src/server/spa/client/react/repos/modeConfig';

describe('modeConfig', () => {
    describe('WORKFLOW_REGISTRY', () => {
        it('is the single source for supported chat modes and default visible modes', () => {
            expect(WORKFLOW_REGISTRY.map(entry => entry.mode)).toEqual(['ask', 'autopilot', 'ralph', 'for-each']);
            expect(DEFAULT_CHAT_MODES).toEqual(['ask', 'autopilot']);
        });

        it('derives labels, icons, accents, and tooltips from registry entries', () => {
            for (const entry of WORKFLOW_REGISTRY) {
                expect(MODE_LABELS[entry.mode]).toBe(`${entry.icon} ${entry.label}`);
                expect(MODE_ICONS[entry.mode]).toBe(entry.icon);
                expect(MODE_BORDER_COLORS[entry.mode]).toEqual({ border: entry.border, ring: entry.ring });
                expect(MODE_TEXT_COLORS[entry.mode]).toBe(entry.text);
                expect(MODE_TOOLTIPS[entry.mode]).toBe(entry.tooltip);
            }
        });
    });

    describe('getVisibleChatModes', () => {
        it('derives New Chat primary modes from registry surface and category metadata', () => {
            expect(getVisibleChatModes({
                surface: 'new-chat',
                category: 'primary',
                featureFlags: {},
            })).toEqual(['ask', 'autopilot']);
        });

        it('gates New Chat workflow modes by registry feature flags', () => {
            expect(getVisibleChatModes({
                surface: 'new-chat',
                category: 'workflow',
                featureFlags: {},
            })).toEqual([]);
            expect(getVisibleChatModes({
                surface: 'new-chat',
                category: 'workflow',
                featureFlags: { ralph: true },
            })).toEqual(['ralph']);
            expect(getVisibleChatModes({
                surface: 'new-chat',
                category: 'workflow',
                featureFlags: { 'for-each': true },
            })).toEqual(['for-each']);
            expect(getVisibleChatModes({
                surface: 'new-chat',
                category: 'workflow',
                featureFlags: { ralph: true, 'for-each': true },
            })).toEqual(['ralph', 'for-each']);
        });

        it('keeps workflow modes hidden from follow-up composers unless explicitly allowed', () => {
            expect(getVisibleChatModes({
                surface: 'follow-up',
                category: 'workflow',
                featureFlags: { ralph: true, 'for-each': true },
            })).toEqual([]);
            expect(getVisibleChatModes({
                surface: 'follow-up',
                category: 'workflow',
                featureFlags: { ralph: true, 'for-each': true },
                allowedModes: ['ask', 'for-each'],
            })).toEqual(['for-each']);
        });

        it('still requires feature flags when follow-up composers explicitly allow workflow modes', () => {
            expect(getVisibleChatModes({
                surface: 'follow-up',
                category: 'workflow',
                featureFlags: { ralph: true },
                allowedModes: ['ask', 'for-each'],
            })).toEqual([]);
        });
    });

    describe('cycleMode', () => {
        it('cycles through visible default modes: ask → autopilot → ask', () => {
            expect(cycleMode('ask')).toBe('autopilot');
            expect(cycleMode('autopilot')).toBe('ask');
        });

        it('full cycle returns to start', () => {
            let mode: ChatMode = 'ask';
            mode = cycleMode(mode);
            mode = cycleMode(mode);
            expect(mode).toBe('ask');
        });

        it('every mode is reachable from ask via cycling', () => {
            const visited = new Set<ChatMode>();
            let mode: ChatMode = 'ask';
            for (let i = 0; i < 2; i++) {
                visited.add(mode);
                mode = cycleMode(mode);
            }
            expect(visited).toEqual(new Set(['ask', 'autopilot']));
        });

        it('cycles within allowedModes when provided', () => {
            const allowed: ChatMode[] = ['ask', 'autopilot'];
            expect(cycleMode('ask', allowed)).toBe('autopilot');
            expect(cycleMode('autopilot', allowed)).toBe('ask');
        });

        it('cycles through currently visible modes including Ralph', () => {
            const allowed: ChatMode[] = ['ask', 'autopilot', 'ralph'];
            expect(cycleMode('ask', allowed)).toBe('autopilot');
            expect(cycleMode('autopilot', allowed)).toBe('ralph');
            expect(cycleMode('ralph', allowed)).toBe('ask');
        });

        it('cycles through currently visible modes including For Each', () => {
            const allowed: ChatMode[] = ['ask', 'autopilot', 'ralph', 'for-each'];
            expect(cycleMode('ask', allowed)).toBe('autopilot');
            expect(cycleMode('autopilot', allowed)).toBe('ralph');
            expect(cycleMode('ralph', allowed)).toBe('for-each');
            expect(cycleMode('for-each', allowed)).toBe('ask');
        });

        it('handles single-mode allowedModes', () => {
            expect(cycleMode('ask', ['ask'])).toBe('ask');
        });
    });

    describe('MODE_LABELS', () => {
        it('has labels for active modes only', () => {
            expect(MODE_LABELS).toHaveProperty('ask');
            expect(MODE_LABELS).toHaveProperty('autopilot');
            expect(MODE_LABELS).toHaveProperty('ralph');
            expect(MODE_LABELS).toHaveProperty('for-each');
            expect(MODE_LABELS['for-each']).toContain('For Each');
            expect(MODE_LABELS).not.toHaveProperty('plan');
        });
    });

    describe('MODE_ICONS', () => {
        it('has icons for active modes only', () => {
            expect(MODE_ICONS).toHaveProperty('ask');
            expect(MODE_ICONS).toHaveProperty('autopilot');
            expect(MODE_ICONS).toHaveProperty('ralph');
            expect(MODE_ICONS).toHaveProperty('for-each');
            expect(MODE_ICONS).not.toHaveProperty('plan');
        });
    });

    describe('MODE_BORDER_COLORS', () => {
        it('has border and ring styles for active modes only', () => {
            for (const mode of ['ask', 'autopilot', 'ralph', 'for-each'] as ChatMode[]) {
                expect(MODE_BORDER_COLORS[mode]).toHaveProperty('border');
                expect(MODE_BORDER_COLORS[mode]).toHaveProperty('ring');
            }
            expect(MODE_BORDER_COLORS).not.toHaveProperty('plan');
        });
    });

    describe('normalizeChatMode', () => {
        it('normalizes legacy plan to ask', () => {
            expect(normalizeChatMode('plan')).toBe('ask');
        });

        it('preserves for-each as a UI mode', () => {
            expect(normalizeChatMode('for-each')).toBe('for-each');
        });
    });
});
