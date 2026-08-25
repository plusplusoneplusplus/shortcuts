import { describe, it, expect } from 'vitest';
import {
    CHAT_STYLES,
    CHAT_STYLE_LABELS,
    DEFAULT_CHAT_STYLE,
    isChatStyle,
    type ChatStyle,
} from '../../src/contracts/common';

describe('ChatStyle wire contract', () => {
    it('lists the four stable values with Default first', () => {
        expect(CHAT_STYLES).toEqual(['default', 'human', 'direct', 'structured']);
    });

    it('starts on default', () => {
        expect(DEFAULT_CHAT_STYLE).toBe('default');
    });

    it('labels every value', () => {
        expect(CHAT_STYLE_LABELS).toEqual({
            default: 'Default',
            human: 'Human',
            direct: 'Direct',
            structured: 'Structured',
        });
    });

    describe('isChatStyle', () => {
        it('accepts every stable value', () => {
            for (const style of CHAT_STYLES) {
                expect(isChatStyle(style)).toBe(true);
            }
        });

        it("accepts 'default' as a first-class value, not the absence of one", () => {
            expect(isChatStyle('default')).toBe(true);
        });

        it('rejects unknown strings and non-strings', () => {
            const rejected: unknown[] = ['', 'Human', 'HUMAN', 'concise', 'none', 'analytical', undefined, null, 0, 1, {}, [], true];
            for (const value of rejected) {
                expect(isChatStyle(value)).toBe(false);
            }
        });

        it('narrows the type', () => {
            const value: unknown = 'structured';
            if (isChatStyle(value)) {
                const style: ChatStyle = value;
                expect(style).toBe('structured');
            } else {
                throw new Error('expected structured to be a valid style');
            }
        });
    });
});
