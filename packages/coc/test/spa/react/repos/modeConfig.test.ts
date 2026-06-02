import { describe, it, expect } from 'vitest';
import { cycleMode, MODE_ICONS, MODE_LABELS, normalizeChatMode } from '../../../../src/server/spa/client/react/repos/modeConfig.js';

describe('cycleMode', () => {
    it('ask → autopilot', () => {
        expect(cycleMode('ask')).toBe('autopilot');
    });

    it('autopilot → ask', () => {
        expect(cycleMode('autopilot')).toBe('ask');
    });
});

describe('MODE_ICONS', () => {
    it('has an icon for every mode', () => {
        expect(MODE_ICONS.ask).toBe('💡');
        expect(MODE_ICONS.autopilot).toBe('🤖');
        expect(MODE_ICONS.ralph).toBe('🔄');
    });
});

describe('MODE_LABELS', () => {
    it('has a descriptive label for every mode', () => {
        expect(MODE_LABELS.ask).toBe('💡 Ask');
        expect(MODE_LABELS.autopilot).toBe('🤖 Autopilot');
        expect(MODE_LABELS.ralph).toBe('🔄 Ralph');
    });
});

describe('normalizeChatMode', () => {
    it('normalizes legacy plan to ask', () => {
        expect(normalizeChatMode('plan')).toBe('ask');
    });
});
