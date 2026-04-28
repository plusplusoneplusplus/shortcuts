import { describe, it, expect } from 'vitest';
import { cycleMode, MODE_ICONS, MODE_LABELS } from '../../../../src/server/spa/client/react/repos/modeConfig.js';

describe('cycleMode', () => {
    it('ask → plan', () => {
        expect(cycleMode('ask')).toBe('plan');
    });

    it('plan → autopilot', () => {
        expect(cycleMode('plan')).toBe('autopilot');
    });

    it('autopilot → ask', () => {
        expect(cycleMode('autopilot')).toBe('ask');
    });
});

describe('MODE_ICONS', () => {
    it('has an icon for every mode', () => {
        expect(MODE_ICONS.ask).toBe('💡');
        expect(MODE_ICONS.plan).toBe('📋');
        expect(MODE_ICONS.autopilot).toBe('🤖');
    });
});

describe('MODE_LABELS', () => {
    it('has a full label for every mode', () => {
        expect(MODE_LABELS.ask).toBe('💡');
        expect(MODE_LABELS.plan).toBe('📋');
        expect(MODE_LABELS.autopilot).toBe('🤖');
    });
});
