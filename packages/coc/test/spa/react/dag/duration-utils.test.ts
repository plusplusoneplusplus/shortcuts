import { describe, it, expect } from 'vitest';
import {
    durationRatio,
    ratioToStrokeWidth,
    ratioToBorderColor,
    formatPreciseDuration,
    deriveParticleParams,
} from '../../../../src/server/spa/client/react/processes/dag/duration-utils';

describe('duration-utils', () => {
    describe('durationRatio', () => {
        it('returns 0 when nodeDuration is undefined', () => {
            expect(durationRatio(undefined, 10000)).toBe(0);
        });

        it('returns 0 when totalDuration is undefined', () => {
            expect(durationRatio(2000, undefined)).toBe(0);
        });

        it('returns 0 when totalDuration is 0', () => {
            expect(durationRatio(2000, 0)).toBe(0);
        });

        it('returns correct ratio', () => {
            expect(durationRatio(2000, 10000)).toBe(0.2);
        });

        it('clamps to 1 when node > total', () => {
            expect(durationRatio(15000, 10000)).toBe(1);
        });

        it('returns 1 for equal values', () => {
            expect(durationRatio(5000, 5000)).toBe(1);
        });
    });

    describe('ratioToStrokeWidth', () => {
        it('returns 1.5 for ratio 0', () => {
            expect(ratioToStrokeWidth(0)).toBe(1.5);
        });

        it('returns 4.5 for ratio 1', () => {
            expect(ratioToStrokeWidth(1)).toBe(4.5);
        });

        it('returns 3.0 for ratio 0.5', () => {
            expect(ratioToStrokeWidth(0.5)).toBe(3.0);
        });

        it('clamps negative ratios to 1.5', () => {
            expect(ratioToStrokeWidth(-0.5)).toBe(1.5);
        });

        it('clamps ratios above 1 to 4.5', () => {
            expect(ratioToStrokeWidth(1.5)).toBe(4.5);
        });
    });

    describe('ratioToBorderColor', () => {
        it('returns base green (#16825d) for ratio 0 in light mode', () => {
            expect(ratioToBorderColor(0, false)).toBe('#16825d');
        });

        it('returns amber (#e8912d) for ratio 1 in light mode', () => {
            expect(ratioToBorderColor(1, false)).toBe('#e8912d');
        });

        it('returns an intermediate hex color for ratio 0.5 in light mode', () => {
            const color = ratioToBorderColor(0.5, false);
            expect(color).toMatch(/^#[0-9a-f]{6}$/i);
            // Midpoint of #16825d and #e8912d
            expect(color).not.toBe('#16825d');
            expect(color).not.toBe('#e8912d');
        });

        it('returns base green (#89d185) for ratio 0 in dark mode', () => {
            expect(ratioToBorderColor(0, true)).toBe('#89d185');
        });

        it('returns amber (#cca700) for ratio 1 in dark mode', () => {
            expect(ratioToBorderColor(1, true)).toBe('#cca700');
        });

        it('returns intermediate color for ratio 0.5 in dark mode', () => {
            const color = ratioToBorderColor(0.5, true);
            expect(color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(color).not.toBe('#89d185');
            expect(color).not.toBe('#cca700');
        });

        it('clamps negative ratio', () => {
            expect(ratioToBorderColor(-1, false)).toBe('#16825d');
        });

        it('clamps ratio above 1', () => {
            expect(ratioToBorderColor(2, false)).toBe('#e8912d');
        });
    });

    describe('formatPreciseDuration', () => {
        it('returns "< 1s" for ms < 1000', () => {
            expect(formatPreciseDuration(500)).toBe('< 1s');
            expect(formatPreciseDuration(0)).toBe('< 1s');
            expect(formatPreciseDuration(999)).toBe('< 1s');
        });

        it('returns "2.3s" for 2300ms', () => {
            expect(formatPreciseDuration(2300)).toBe('2.3s');
        });

        it('returns "45.1s" for 45100ms', () => {
            expect(formatPreciseDuration(45100)).toBe('45.1s');
        });

        it('returns "1.0s" for exactly 1000ms', () => {
            expect(formatPreciseDuration(1000)).toBe('1.0s');
        });

        it('returns "1m 12s" for 72000ms', () => {
            expect(formatPreciseDuration(72000)).toBe('1m 12s');
        });

        it('returns "1h 5m" for 3900000ms', () => {
            expect(formatPreciseDuration(3900000)).toBe('1h 5m');
        });

        it('returns "10m 0s" for exactly 600000ms', () => {
            expect(formatPreciseDuration(600000)).toBe('10m 0s');
        });
    });

    describe('deriveParticleParams', () => {
        it('returns defaults when completedItems is undefined', () => {
            expect(deriveParticleParams(undefined, 5000)).toEqual({ particleCount: 1, durationMs: 1500 });
        });

        it('returns defaults when elapsedMs is undefined', () => {
            expect(deriveParticleParams(10, undefined)).toEqual({ particleCount: 1, durationMs: 1500 });
        });

        it('returns defaults when elapsedMs is 0', () => {
            expect(deriveParticleParams(10, 0)).toEqual({ particleCount: 1, durationMs: 1500 });
        });

        it('returns defaults when completedItems is 0', () => {
            expect(deriveParticleParams(0, 5000)).toEqual({ particleCount: 1, durationMs: 1500 });
        });

        it('returns higher particleCount for high throughput', () => {
            // 10 items / 1s = 10 items/sec → ceil(10/2) = 5
            const result = deriveParticleParams(10, 1000);
            expect(result.particleCount).toBe(5);
        });

        it('returns lower durationMs for high throughput', () => {
            // 10 items/sec → 2000/10 = 200 → clamped to 400
            const result = deriveParticleParams(10, 1000);
            expect(result.durationMs).toBe(400);
        });

        it('clamps particleCount to max 5', () => {
            // 100 items / 1s = 100 items/sec → ceil(100/2) = 50 → clamped to 5
            const result = deriveParticleParams(100, 1000);
            expect(result.particleCount).toBe(5);
        });

        it('clamps durationMs to [400, 2000]', () => {
            // Very slow: 1 item / 60s = 0.0167 items/sec → 2000/0.0167 ≈ 119760 → clamped to 2000
            const slow = deriveParticleParams(1, 60000);
            expect(slow.durationMs).toBe(2000);

            // Very fast: 100 items / 1s = 100 items/sec → 2000/100 = 20 → clamped to 400
            const fast = deriveParticleParams(100, 1000);
            expect(fast.durationMs).toBe(400);
        });

        it('returns moderate values for moderate throughput', () => {
            // 4 items / 2s = 2 items/sec → particleCount = ceil(2/2) = 1, durationMs = 2000/2 = 1000
            const result = deriveParticleParams(4, 2000);
            expect(result.particleCount).toBe(1);
            expect(result.durationMs).toBe(1000);
        });
    });
});
