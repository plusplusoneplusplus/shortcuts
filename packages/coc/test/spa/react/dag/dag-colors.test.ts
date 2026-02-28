import { describe, it, expect } from 'vitest';
import { getNodeColors, getEdgeColor, getNodeIcon } from '../../../../src/server/spa/client/react/processes/dag/dag-colors';
import type { DAGNodeState } from '../../../../src/server/spa/client/react/processes/dag/types';
import type { EdgeState } from '../../../../src/server/spa/client/react/processes/dag/dag-colors';

describe('dag-colors', () => {
    describe('getNodeColors', () => {
        it('returns correct light mode colors for running state', () => {
            const colors = getNodeColors('running', false);
            expect(colors).toEqual({ fill: '#e8f3ff', border: '#0078d4', text: '#0078d4' });
        });

        it('returns correct dark mode colors for completed state', () => {
            const colors = getNodeColors('completed', true);
            expect(colors.fill).toBe('#e6f4ea');
            expect(colors.border).toBe('#16825d');
            expect(colors.text).toBe('#89d185');
        });

        it('returns correct dark mode colors for running state', () => {
            const colors = getNodeColors('running', true);
            expect(colors.text).toBe('#3794ff');
        });

        it('returns correct dark mode colors for failed state', () => {
            const colors = getNodeColors('failed', true);
            expect(colors.text).toBe('#f48771');
        });

        it('returns correct dark mode colors for cancelled state', () => {
            const colors = getNodeColors('cancelled', true);
            expect(colors.text).toBe('#cca700');
        });

        it('falls back to border color for dark mode states without dark variant', () => {
            const colors = getNodeColors('waiting', true);
            expect(colors.text).toBe('#848484'); // same as border
        });

        it('produces valid color strings for all states', () => {
            const states: DAGNodeState[] = ['waiting', 'running', 'completed', 'failed', 'skipped', 'cancelled'];
            for (const state of states) {
                for (const isDark of [true, false]) {
                    const colors = getNodeColors(state, isDark);
                    expect(colors.fill).toMatch(/^#[0-9a-f]{6}$/i);
                    expect(colors.border).toMatch(/^#[0-9a-f]{6}$/i);
                    expect(colors.text).toMatch(/^#[0-9a-f]{6}$/i);
                }
            }
        });
    });

    describe('getEdgeColor', () => {
        it('returns #0078d4 for active in light mode', () => {
            expect(getEdgeColor('active', false)).toBe('#0078d4');
        });

        it('returns #3794ff for active in dark mode', () => {
            expect(getEdgeColor('active', true)).toBe('#3794ff');
        });

        it('returns correct colors for all edge states', () => {
            const states: EdgeState[] = ['waiting', 'active', 'completed', 'error'];
            for (const state of states) {
                for (const isDark of [true, false]) {
                    const color = getEdgeColor(state, isDark);
                    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
                }
            }
        });
    });

    describe('getNodeIcon', () => {
        it('returns 🔄 for running', () => {
            expect(getNodeIcon('running')).toBe('🔄');
        });

        it('returns ✅ for completed', () => {
            expect(getNodeIcon('completed')).toBe('✅');
        });

        it('returns ❌ for failed', () => {
            expect(getNodeIcon('failed')).toBe('❌');
        });

        it('returns ⏳ for waiting', () => {
            expect(getNodeIcon('waiting')).toBe('⏳');
        });

        it('returns ⛔ for skipped', () => {
            expect(getNodeIcon('skipped')).toBe('⛔');
        });

        it('returns 🚫 for cancelled', () => {
            expect(getNodeIcon('cancelled')).toBe('🚫');
        });
    });
});
