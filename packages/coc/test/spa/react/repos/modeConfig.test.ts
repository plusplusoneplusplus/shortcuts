import { describe, it, expect } from 'vitest';
import { cycleMode } from '../../../../src/server/spa/client/react/repos/modeConfig.js';

describe('cycleMode', () => {
    it('ask → autopilot', () => {
        expect(cycleMode('ask')).toBe('autopilot');
    });

    it('plan → autopilot', () => {
        expect(cycleMode('plan')).toBe('autopilot');
    });

    it('autopilot → ask', () => {
        expect(cycleMode('autopilot')).toBe('ask');
    });
});
