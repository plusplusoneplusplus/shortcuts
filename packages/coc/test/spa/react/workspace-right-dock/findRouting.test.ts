import { describe, expect, it } from 'vitest';
import {
    findFilterOwner,
    findFilterShortcut,
    type FindFilterOwnerContext,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/findRouting';

function key(over: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>> = {}) {
    return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'f', ...over };
}

function ctx(over: Partial<FindFilterOwnerContext> = {}): FindFilterOwnerContext {
    return {
        panelOpen: true,
        explorerNavigatorVisible: true,
        focusInNavigatorColumn: true,
        filterPresent: true,
        ...over,
    };
}

describe('findFilterShortcut', () => {
    it('matches Ctrl+F and Cmd+F, in either case', () => {
        expect(findFilterShortcut(key({ ctrlKey: true }))).toBe('filter');
        expect(findFilterShortcut(key({ metaKey: true }))).toBe('filter');
        expect(findFilterShortcut(key({ ctrlKey: true, key: 'F' }))).toBe('filter');
    });

    it('ignores modified find shortcuts, a bare F, and other keys', () => {
        expect(findFilterShortcut(key({ ctrlKey: true, shiftKey: true }))).toBeNull();
        expect(findFilterShortcut(key({ ctrlKey: true, altKey: true }))).toBeNull();
        expect(findFilterShortcut(key())).toBeNull();
        expect(findFilterShortcut(key({ ctrlKey: true, key: 'p' }))).toBeNull();
    });
});

describe('findFilterOwner', () => {
    it('focuses the filter when every ownership condition holds', () => {
        expect(findFilterOwner(ctx())).toBe('filter');
    });

    it.each([
        ['the panel is closed', { panelOpen: false }],
        ['the Explorer navigator is hidden', { explorerNavigatorVisible: false }],
        ['focus is outside the navigator column', { focusInNavigatorColumn: false }],
        ['the filter is absent', { filterPresent: false }],
    ] satisfies [string, Partial<FindFilterOwnerContext>][])('ignores the shortcut when %s', (_name, over) => {
        expect(findFilterOwner(ctx(over))).toBe('ignore');
    });
});
