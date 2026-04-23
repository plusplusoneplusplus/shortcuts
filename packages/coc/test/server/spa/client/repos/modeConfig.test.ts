/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { cycleMode, MODE_LABELS, MODE_ICONS, MODE_BORDER_COLORS } from '../../../../../src/server/spa/client/react/repos/modeConfig';
import type { ChatMode } from '../../../../../src/server/spa/client/react/repos/modeConfig';

describe('modeConfig', () => {
    describe('cycleMode', () => {
        it('cycles through all three modes: ask → plan → autopilot → ask', () => {
            expect(cycleMode('ask')).toBe('plan');
            expect(cycleMode('plan')).toBe('autopilot');
            expect(cycleMode('autopilot')).toBe('ask');
        });

        it('full cycle returns to start', () => {
            let mode: ChatMode = 'ask';
            mode = cycleMode(mode);
            mode = cycleMode(mode);
            mode = cycleMode(mode);
            expect(mode).toBe('ask');
        });

        it('every mode is reachable from ask via cycling', () => {
            const visited = new Set<ChatMode>();
            let mode: ChatMode = 'ask';
            for (let i = 0; i < 3; i++) {
                visited.add(mode);
                mode = cycleMode(mode);
            }
            expect(visited).toEqual(new Set(['ask', 'plan', 'autopilot']));
        });
    });

    describe('MODE_LABELS', () => {
        it('has labels for all three modes', () => {
            expect(MODE_LABELS).toHaveProperty('ask');
            expect(MODE_LABELS).toHaveProperty('plan');
            expect(MODE_LABELS).toHaveProperty('autopilot');
        });
    });

    describe('MODE_ICONS', () => {
        it('has icons for all three modes', () => {
            expect(MODE_ICONS).toHaveProperty('ask');
            expect(MODE_ICONS).toHaveProperty('plan');
            expect(MODE_ICONS).toHaveProperty('autopilot');
        });
    });

    describe('MODE_BORDER_COLORS', () => {
        it('has border and ring styles for all three modes', () => {
            for (const mode of ['ask', 'plan', 'autopilot'] as ChatMode[]) {
                expect(MODE_BORDER_COLORS[mode]).toHaveProperty('border');
                expect(MODE_BORDER_COLORS[mode]).toHaveProperty('ring');
            }
        });
    });
});
