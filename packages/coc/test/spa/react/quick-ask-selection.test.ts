import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deriveContext,
    isSelectableText,
    getQuickAskSelection,
    MIN_SELECTION_CHARS,
} from '../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection';

describe('isSelectableText', () => {
    it('rejects empty/whitespace and too-short selections', () => {
        expect(isSelectableText('')).toBe(false);
        expect(isSelectableText('   ')).toBe(false);
        expect(isSelectableText('a')).toBe(MIN_SELECTION_CHARS <= 1);
        expect(isSelectableText('ab')).toBe(true);
    });
});

describe('deriveContext', () => {
    const full = 'The Daly formula measures disability-adjusted life years.';

    it('captures text before and after the selection', () => {
        const { contextBefore, contextAfter } = deriveContext(full, 'Daly formula');
        expect(contextBefore).toBe('The ');
        expect(contextAfter).toBe(' measures disability-adjusted life years.');
    });

    it('bounds context to maxChars on each side', () => {
        const { contextBefore, contextAfter } = deriveContext(full, 'Daly formula', 4);
        expect(contextBefore).toBe('The ');
        expect(contextAfter).toBe(' mea');
    });

    it('returns empty context when the selection is not found', () => {
        expect(deriveContext(full, 'nonexistent')).toEqual({ contextBefore: '', contextAfter: '' });
    });
});

describe('getQuickAskSelection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    function mockSelection(sel: Partial<Selection> | null) {
        vi.spyOn(window, 'getSelection').mockReturnValue(sel as Selection | null);
    }

    function makeContainer(text: string): HTMLElement {
        const el = document.createElement('div');
        el.textContent = text;
        document.body.appendChild(el);
        return el;
    }

    it('returns null when there is no selection', () => {
        mockSelection(null);
        expect(getQuickAskSelection(makeContainer('hi there'), 0)).toBeNull();
    });

    it('returns null for a collapsed selection', () => {
        mockSelection({ isCollapsed: true, rangeCount: 1 });
        expect(getQuickAskSelection(makeContainer('hi there'), 0)).toBeNull();
    });

    it('returns null when the selection is outside the container', () => {
        const container = makeContainer('The Daly formula.');
        const outside = document.createElement('p');
        outside.textContent = 'elsewhere';
        document.body.appendChild(outside);
        mockSelection({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'elsewhere',
            getRangeAt: () => ({
                commonAncestorContainer: outside,
                getBoundingClientRect: () => ({ top: 10, left: 10, bottom: 20, right: 40, width: 30, height: 10 }),
            }) as unknown as Range,
        });
        expect(getQuickAskSelection(container, 0)).toBeNull();
    });

    it('returns a captured selection with context and rect when valid', () => {
        const container = makeContainer('The Daly formula measures years.');
        mockSelection({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'Daly formula',
            getRangeAt: () => ({
                commonAncestorContainer: container,
                getBoundingClientRect: () => ({ top: 100, left: 50, bottom: 118, right: 140, width: 90, height: 18 }),
            }) as unknown as Range,
        });
        const result = getQuickAskSelection(container, 3);
        expect(result).not.toBeNull();
        expect(result!.turnIndex).toBe(3);
        expect(result!.selectedText).toBe('Daly formula');
        expect(result!.contextBefore).toBe('The ');
        expect(result!.contextAfter.startsWith(' measures')).toBe(true);
        expect(result!.rect.top).toBe(100);
        expect(result!.rect.left).toBe(50);
    });

    it('returns null when the selection rect is empty', () => {
        const container = makeContainer('The Daly formula.');
        mockSelection({
            isCollapsed: false,
            rangeCount: 1,
            toString: () => 'Daly formula',
            getRangeAt: () => ({
                commonAncestorContainer: container,
                getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
            }) as unknown as Range,
        });
        expect(getQuickAskSelection(container, 0)).toBeNull();
    });
});
