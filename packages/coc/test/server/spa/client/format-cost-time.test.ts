import { describe, it, expect } from 'vitest';
import { formatCostTime } from '../../../../src/server/spa/client/react/chat/ConversationTurnBubble';

describe('formatCostTime', () => {
    it('formats sub-second durations as milliseconds', () => {
        expect(formatCostTime(0)).toBe('0ms');
        expect(formatCostTime(1)).toBe('1ms');
        expect(formatCostTime(500)).toBe('500ms');
        expect(formatCostTime(999)).toBe('999ms');
    });

    it('rounds sub-second durations to nearest integer', () => {
        expect(formatCostTime(123.4)).toBe('123ms');
        expect(formatCostTime(999.5)).toBe('1000ms');
    });

    it('formats durations under 60s with one decimal', () => {
        expect(formatCostTime(1000)).toBe('1.0s');
        expect(formatCostTime(1500)).toBe('1.5s');
        expect(formatCostTime(12345)).toBe('12.3s');
        expect(formatCostTime(59900)).toBe('59.9s');
    });

    it('formats durations >= 60s as minutes and seconds', () => {
        expect(formatCostTime(60000)).toBe('1m 0s');
        expect(formatCostTime(75000)).toBe('1m 15s');
        expect(formatCostTime(135000)).toBe('2m 15s');
        expect(formatCostTime(600000)).toBe('10m 0s');
        expect(formatCostTime(605000)).toBe('10m 5s');
    });
});
